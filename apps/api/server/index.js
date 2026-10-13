// API server: search as server-sent events, film details, and the home page poster wall.
// The web app is a separate service; WEB_ORIGIN lists the origins allowed to call this API.
// Run: node --env-file=.env server/index.js

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { eq, gt, and, inArray, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.js";
import { search } from "../lib/search.js";
import { warmIfIdle } from "../lib/warm.js";
import { addCost } from "../lib/costs.js";
import { secureHeaders } from "hono/secure-headers";
import { ProviderError } from "../lib/providers.js";
import { clientIp, rateLimit, startSearch, markOutage, currentOutage, runningSearches } from "../lib/guard.js";

const { films, searchCache, usage } = schema;
const PORT = Number(process.env.PORT ?? 3000);
const DAILY_BUDGET = Number(process.env.DAILY_BUDGET_USD ?? 5); // hard cap on Jev spend per day
// What a fresh search usually costs; searches still running count this against the budget, so a
// burst can't overshoot it by much.
const SEARCH_COST_ESTIMATE = Number(process.env.SEARCH_COST_ESTIMATE_USD ?? 0.05);
const CACHE_HOURS = Number(process.env.CACHE_HOURS ?? 72);
const MAX_QUERY = 300;
const SHOWN = 0.4; // the page hides films scoring below this, so their details aren't sent

const normalise = (q) => q.toLowerCase().replace(/\s+/g, " ").trim();
const today = () => new Date().toISOString().slice(0, 10);
const card = (f) => ({ id: f.id, title: f.title, year: f.year, runtime: f.runtime, genres: f.genres, poster: f.poster, votes: f.votes });

async function record({ cached, cost }) {
  await addCost("jev", cost);
  await db
    .insert(usage)
    .values({ day: today(), searches: 1, cached: cached ? 1 : 0, cost })
    .onConflictDoUpdate({
      target: usage.day,
      set: { searches: sql`${usage.searches} + 1`, cached: sql`${usage.cached} + ${cached ? 1 : 0}`, cost: sql`${usage.cost} + ${cost}` },
    });
}

async function spentToday() {
  const [row] = await db.select({ cost: usage.cost }).from(usage).where(eq(usage.day, today()));
  return row?.cost ?? 0;
}

// Comma-separated origins of the web app (e.g. https://movies.example.com). Vite's dev server is always allowed.
const ORIGINS = ["http://localhost:5173", ...(process.env.WEB_ORIGIN ?? "").split(",").map((o) => o.trim()).filter(Boolean)];

const app = new Hono();
app.use("*", secureHeaders({ crossOriginResourcePolicy: false }));
app.use("/api/*", cors({ origin: ORIGINS, allowMethods: ["GET"], maxAge: 86400 }));

const ipOf = (c) => clientIp(c, getConnInfo(c).remote.address);
const retryText = (s) => (s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`);

// The small endpoints get a generous per-IP limit; search has its own, stricter ones.
app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/search") return next();
  const limit = await rateLimit("light", ipOf(c));
  if (limit.ok) return next();
  c.header("Retry-After", String(limit.retryAfter));
  return c.json({ error: "Too many requests.", retryAfter: limit.retryAfter }, 429);
});

// Shown sitewide when search is paused: a provider ran out of credit, or today's budget is spent.
// Searches that were already cached keep working either way.
async function siteNotice() {
  const outage = await currentOutage();
  if (outage) {
    return { kind: "paused", message: "New searches are paused for a little while: FilmHunch hit a limit with one of its AI providers. Recent searches still work." };
  }
  if ((await spentToday()) + runningSearches() * SEARCH_COST_ESTIMATE >= DAILY_BUDGET) {
    return { kind: "budget", message: "FilmHunch has used today's search budget. Recent searches still work, and new ones are back tomorrow." };
  }
  return null;
}

// The page asks for this as soon as it opens, so it also starts the cache warm-up after an idle
// spell: most of it then happens while the visitor is still typing.
app.get("/api/status", async (c) => {
  warmIfIdle();
  const notice = await siteNotice();
  c.header("Cache-Control", "public, max-age=30");
  return c.json({ ok: !notice, notice });
});

app.get("/health", async (c) => {
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from films where status = 'indexed'`)).rows;
  return c.json({ ok: true, films: n });
});

// What running FilmHunch has cost so far, for the footer badge. Hosting doesn't report itself, so
// HOSTING_USD_PER_MONTH is spread evenly over the days since the ledger began.
const HOSTING_USD_PER_MONTH = Number(process.env.HOSTING_USD_PER_MONTH ?? 0);
let costCache = null;
app.get("/api/costs", async (c) => {
  if (!costCache || Date.now() - costCache.at > 300_000) {
    const { rows } = await db.execute(sql`select source, sum(usd)::float as usd, min(day)::text as since from costs group by source`);
    const [{ searches }] = (await db.execute(sql`select coalesce(sum(searches), 0)::int as searches from usage`)).rows;
    const by = Object.fromEntries(rows.map((r) => [r.source, r.usd]));
    const since = rows.map((r) => r.since).sort()[0] ?? new Date().toISOString().slice(0, 10);
    const days = Math.max(1, (Date.now() - Date.parse(since)) / 86_400_000);
    const breakdown = {
      search: by.jev ?? 0, // Jev reading films for each search
      embeddings: by.openai ?? 0, // OpenAI: each search's request, and new films' text
      catalog: by.catalog ?? 0, // one-time: embedding the whole catalog
      hosting: (HOSTING_USD_PER_MONTH * days) / 30.44,
    };
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    costCache = { at: Date.now(), body: { total, since, searches, breakdown } };
  }
  c.header("Cache-Control", "public, max-age=300");
  return c.json(costCache.body);
});

// Catalog size for the home page, cached in memory for ten minutes.
let stats = null;
app.get("/api/stats", async (c) => {
  if (!stats || Date.now() - stats.at > 600_000) {
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from films where status = 'indexed'`)).rows;
    stats = { at: Date.now(), films: n };
  }
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ films: stats.films });
});

// Posters for the home page's poster wall: well-known films, cached in memory for a day.
let showcase = null;
app.get("/api/showcase", async (c) => {
  if (!showcase || Date.now() - showcase.at > 86_400_000) {
    const rows = await db
      .select({ id: films.id, title: films.title, poster: films.poster })
      .from(films)
      .where(and(eq(films.status, "indexed"), sql`${films.poster} is not null`, sql`${films.votes} >= 3000`))
      .orderBy(sql`random()`)
      .limit(48);
    showcase = { at: Date.now(), rows };
  }
  c.header("Cache-Control", "public, max-age=300");
  return c.json(showcase.rows);
});

// Details for films on screen: overview, people and the backdrop for the spotlight and detail view.
// The search stream only carries what the poster wall needs, since it covers thousands of films.
app.get("/api/films", async (c) => {
  const ids = (c.req.query("ids") ?? "").split(",").map(Number).filter(Number.isInteger).slice(0, 60);
  if (!ids.length) return c.json([]);
  const rows = await db
    .select({
      id: films.id, title: films.title, year: films.year, runtime: films.runtime, genres: films.genres,
      poster: films.poster, backdrop: films.backdrop, overview: films.overview, tagline: films.tagline,
      director: films.director, cast: films.castNames, rating: films.rating, votes: films.votes,
      imdbId: films.imdbId, language: films.language,
    })
    .from(films)
    .where(inArray(films.id, ids));
  c.header("Cache-Control", "public, max-age=300");
  return c.json(rows.map((r) => ({ ...r, cast: r.cast.slice(0, 6) })));
});

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
  if (q.length < 3) return c.json({ error: "Describe the movie in a few words." }, 400);
  const ip = ipOf(c);
  // "v2" marks the current pipeline, so results cached by an older one are never replayed.
  const key = `v2:${normalise(q)}`;
  warmIfIdle();

  return streamSSE(c, async (stream) => {
    const send = (event, data) => stream.writeSSE({ event, data: JSON.stringify(data) });
    // code: rate_limited | paused | budget | busy | failed. The page shows the message; retryAfter
    // (seconds) drives its countdown.
    const fail = (code, message, extra = {}) => send("error", { code, message, ...extra });
    const controller = new AbortController();
    let slot = null;
    stream.onAbort(() => {
      controller.abort();
      slot?.end();
    });

    const anyLimit = await rateLimit("search", ip);
    if (!anyLimit.ok) {
      return fail("rate_limited", `You're searching faster than FilmHunch can keep up. Try again in ${retryText(anyLimit.retryAfter)}.`, { retryAfter: anyLimit.retryAfter });
    }

    // Cached: replay the stored ranking.
    const [hit] = await db
      .select()
      .from(searchCache)
      .where(and(eq(searchCache.query, key), gt(searchCache.createdAt, new Date(Date.now() - CACHE_HOURS * 3_600_000))));
    if (hit) {
      const ids = hit.results.map((r) => r.id);
      const rows = ids.length ? await db.select().from(films).where(inArray(films.id, ids)) : [];
      await send("total", { films: ids.length });
      await send("scores", { stage: 2, scores: hit.results.map((r) => [r.id, r.s2 ?? r.s1]), cards: rows.map(card) });
      await send("done", { cached: true, cost: 0 });
      await db.update(searchCache).set({ hits: sql`${searchCache.hits} + 1` }).where(eq(searchCache.query, key));
      await record({ cached: true, cost: 0 });
      return;
    }

    const notice = await siteNotice();
    if (notice) return fail(notice.kind, notice.message);
    const freshLimit = await rateLimit("fresh", ip);
    if (!freshLimit.ok) {
      return fail("rate_limited", `You've run a lot of new searches. Try again in ${retryText(freshLimit.retryAfter)}.`, { retryAfter: freshLimit.retryAfter });
    }
    slot = startSearch(ip);
    if (!slot.ok) {
      const message = slot.reason === "yours" ? "Your last search is still finishing. Try again in a moment." : "FilmHunch is busy right now. Try again in a moment.";
      slot = null;
      return fail("busy", message, { retryAfter: 5 });
    }

    try {
      // Jev scores ~5,000 films; only those that could be shown need their display details sent.
      const sent = new Set();
      const result = await search({
        apiKey: process.env.TYPESAFE_API_KEY,
        query: q,
        signal: controller.signal,
        onTotal: (n, complete) => send("total", { films: n, complete }),
        onScores: (stage, scores, film) => {
          const cards = [];
          for (const [id, s] of scores) if (s >= SHOWN && !sent.has(id)) { sent.add(id); cards.push(card(film(id))); }
          return send("scores", { stage, scores, cards });
        },
      });
      const { stats } = result;
      // Record what was spent even if the visitor left early.
      await record({ cached: false, cost: stats.cost });
      if (controller.signal.aborted) return;
      await send("done", { cached: false, ...stats, ms: stats.totalMs });
      const top = result.ranked.slice(0, 60).map((r) => ({ id: r.film.id, s1: r.s1, s2: r.s2 ?? null }));
      await db
        .insert(searchCache)
        .values({ query: key, results: top })
        .onConflictDoUpdate({ target: searchCache.query, set: { results: top, createdAt: new Date() } });
    } catch (err) {
      controller.abort(); // stop the rest of this search's Jev calls
      if (err.cost > 0) await record({ cached: false, cost: err.cost }); // spent before it failed
      if (err instanceof ProviderError) {
        await markOutage(err.provider, err.kind);
        const notice = await siteNotice();
        return fail("paused", notice?.message ?? "New searches are paused for a little while.");
      }
      console.error("search failed", err);
      return fail("failed", "Something went wrong with that search. Try again.");
    } finally {
      slot?.end();
    }
  });
});

app.get("/", (c) => c.json({ name: "filmhunch-api", ok: true }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`FilmHunch API on http://localhost:${info.port}`);
  warmIfIdle(); // the database is likely cold right after a deploy
});
