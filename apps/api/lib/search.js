// Search. Jev reads every well-known film on every search, so the films people expect can't be
// missed by retrieval; a shortlist from the rest of the catalog adds niche and recent films.
//   1. Pool: the `pool` most-voted films (kept in memory). Jev scores each one's slim card.
//   2. Tail: vector + keyword search over everything else picks `tail` more films,
//      scored the same way. Runs alongside step 1.
//   3. Jev re-scores the top `refine` on full profiles (plot up to ~800 words).
// In testing, reading every well-known card found far better matches than retrieval alone (e.g.
// Arrival and Solaris for "like Inception but slower"), at ~$0.05 and ~3 s a search.

import { sql, inArray } from "drizzle-orm";
import { db, schema } from "./db.js";
import { embed } from "./embed.js";
import { scoreCompact, PRICE_PER_M } from "./jev.js";
import { slimCard } from "./profile.js";

export const DEFAULTS = {
  pool: 5000, // films Jev reads on every search: the most-voted, plus `recent` new releases
  recent: 500, // of those, the most popular films from the last 18 months (new releases have few votes)
  tail: 300, // films added from the rest of the catalog by retrieval
  refine: 40, // films re-scored on full profiles
  chunksPerCandidate: 6, // nearest chunks pulled per wanted tail film before grouping by film
  rrfK: 60,
  tieBreak: 0.04, // weight of a popularity bonus (0..1 from log votes) added to Jev's score
};

// First-pass wording, kept short: every word is repeated for each of ~5,000 films.
const FIRST_PASS = {
  batchSize: 16,
  instruction: (id) => `Score film_${id} against the request (honour every part, including exclusions).`,
  levels: ["Not a match.", "Barely.", "Partly.", "Mostly.", "Exactly."],
};

// 0..1 from log votes: ~0 for unknown films, 0.6 at 1k votes, 1 at 100k.
const fame = (votes) => Math.min(1, Math.log10((votes ?? 0) + 1) / 5);

// Near-ties at the top are common (many films score 95-99%); a small popularity bonus orders them
// by what people are likelier to know and want, without overriding real score gaps.
const withBonus = (score, votes, weight) => score + weight * fame(votes);

const DISPLAY = (films) => ({
  id: films.id, title: films.title, year: films.year, runtime: films.runtime, genres: films.genres, poster: films.poster, votes: films.votes,
});

// The well-known pool, cached in memory (~5,000 slim cards, a few MB) and refreshed hourly so the
// daily sync's changes show up.
const POOL_TTL_MS = 60 * 60_000;
let poolCache = null;
// A new release can take months to reach the votes of an established film, so the pool reserves
// `recent` places for the most popular films released in the last 18 months (20+ votes) that the
// vote ranking leaves out. Popularity and votes are refreshed daily by the sync.
export async function wellKnown(size = DEFAULTS.pool, recent = DEFAULTS.recent) {
  const key = `${size}/${recent}`;
  if (poolCache && poolCache.key === key && Date.now() - poolCache.at < POOL_TTL_MS) return poolCache;
  const { films } = schema;
  const fields = { ...DISPLAY(films), card: films.card };
  const top = await db
    .select(fields)
    .from(films)
    .where(sql`${films.status} = 'indexed'`)
    .orderBy(sql`${films.votes} desc, ${films.id}`)
    .limit(size - recent);
  const minVotes = top.at(-1)?.votes ?? 0;
  const fresh = await db
    .select(fields)
    .from(films)
    .where(sql`${films.status} = 'indexed' and ${films.votes} < ${minVotes} and ${films.votes} >= 20
      and ${films.releaseDate} >= now() - interval '18 months'`)
    .orderBy(sql`${films.popularity} desc nulls last, ${films.id}`)
    .limit(recent);
  const byId = new Map([...top, ...fresh].map(({ card, ...film }) => [film.id, { ...film, text: slimCard(card) }]));
  poolCache = { at: Date.now(), key, byId, minVotes };
  return poolCache;
}

// Nearest films by embedding among films below `maxVotes` (the tail): best-matching chunk per film.
async function vectorFilms(queryVec, limit, maxVotes) {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local hnsw.ef_search = ${Math.min(1000, limit)}`));
    await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
    const { rows } = await tx.execute(sql`
      with near as (
        select film_id, embedding <=> ${JSON.stringify(queryVec)}::halfvec as d
        from chunks
        where embedding is not null
          and film_id in (select id from films where votes < ${maxVotes})
        order by embedding <=> ${JSON.stringify(queryVec)}::halfvec
        limit ${limit}
      )
      select film_id as id, min(d) as d from near group by film_id order by d`);
    return rows.map((r) => r.id);
  });
}

// Words that appear in most requests and match most films; they add noise, not signal.
// Stemmed the way Postgres's English config stems them (movie → movi, story → stori).
const REQUEST_STOPWORDS = ["movi", "film", "stori", "someth", "watch", "like", "want", "one", "feel", "kind", "good", "great", "make", "show"];
// One Postgres array literal (Drizzle would expand a JS array into separate parameters).
const STOPWORDS_LITERAL = `{${REQUEST_STOPWORDS.join(",")}}`;

// Tail films matching any of the query's meaningful words in their keywords, director, cast or
// profile. Titles are left out (weight A): a request for "a rainy Sunday" isn't asking for films
// with "Sunday" in the title, and that was crowding out real matches.
async function keywordFilms(query, limit, maxVotes) {
  const { rows } = await db.execute(sql`
    with q as (
      select to_tsquery('english', string_agg(quote_literal(lexeme) || ':BC', ' | ')) as tsq
      from unnest(to_tsvector('english', ${query}))
      where lexeme <> all(${STOPWORDS_LITERAL}::text[])
    )
    select f.id from films f, q
    where q.tsq is not null and f.status = 'indexed' and f.votes < ${maxVotes} and f.search_tsv @@ q.tsq
    order by ts_rank_cd(f.search_tsv, q.tsq) desc
    limit ${limit}`);
  return rows.map((r) => r.id);
}

// Reciprocal rank fusion of ranked id lists.
function fuse(lists, k) {
  const score = new Map();
  for (const list of lists) list.forEach((id, rank) => score.set(id, (score.get(id) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// The best `o.tail` films outside the pool, by meaning and by keywords.
export async function retrieveTail(query, maxVotes, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!o.tail) return [];
  const [queryVec] = await embed([query]);
  const [byVector, byKeyword] = await Promise.all([
    vectorFilms(queryVec, o.tail * o.chunksPerCandidate, maxVotes),
    keywordFilms(query, o.tail, maxVotes),
  ]);
  return fuse([byVector, byKeyword], o.rrfK).slice(0, o.tail);
}

// Card or profile text plus display fields for the given films.
async function texts(ids, field) {
  if (!ids.length) return new Map();
  const { films } = schema;
  const rows = await db.select({ ...DISPLAY(films), text: films[field] }).from(films).where(inArray(films.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

// onScores(stage, [[id, score], ...], film) streams results as they land; film(id) returns a scored
// film's display fields. onTotal(n, complete) reports how many films the first pass will read: the
// pool at once, then again with complete = true once the tail is found (slow on a cold database).
// If it fails partway, the error carries `cost`: what was already spent.
export async function search(args) {
  const meter = { tokens: 0 };
  try {
    return await runSearch({ ...args, meter });
  } catch (err) {
    err.cost = (meter.tokens / 1e6) * PRICE_PER_M;
    throw err;
  }
}

async function runSearch({ apiKey, query, signal, onScores, onTotal, meter, ...opts }) {
  const o = { ...DEFAULTS, ...opts };
  const t0 = performance.now();
  const pool = await wellKnown(o.pool, o.recent);
  const films = new Map(pool.byId);
  const film = (id) => films.get(id);
  const s1 = new Map();
  let tokens = 0;
  let requests = 0;
  const firstPass = async (items) => {
    const r = await scoreCompact({
      apiKey, query, signal, items, concurrency: 32, meter, ...FIRST_PASS,
      onScores: (scores) => {
        for (const [id, s] of scores) s1.set(id, s);
        onScores?.(1, scores, film);
      },
    });
    tokens += r.tokens;
    requests += r.requests;
  };
  onTotal?.(films.size, false);

  // The pool starts scoring at once; the tail joins when retrieval returns.
  let retrieveMs = 0;
  const tail = (async () => {
    // New releases in the pool sit below its vote line, so ask for a few extra and drop them.
    const ids = (await retrieveTail(query, pool.minVotes, { ...o, tail: o.tail + 50 })).filter((id) => !pool.byId.has(id)).slice(0, o.tail);
    const cards = await texts(ids, "card");
    retrieveMs = Math.round(performance.now() - t0);
    for (const [id, f] of cards) films.set(id, { ...f, text: slimCard(f.text) });
    onTotal?.(films.size, true);
    await firstPass([...cards.keys()].map((id) => ({ id, text: films.get(id).text })));
  })();
  await Promise.all([firstPass([...pool.byId.values()].map((f) => ({ id: f.id, text: f.text }))), tail]);
  const t1 = performance.now();

  const key1 = (id) => withBonus(s1.get(id), film(id).votes, o.tieBreak);
  const top = [...s1.keys()].sort((a, b) => key1(b) - key1(a)).slice(0, o.refine);
  const profiles = await texts(top, "profile");
  const s2 = new Map();
  const r2 = await scoreCompact({
    apiKey, query, signal, batchSize: 4, concurrency: 32, meter,
    items: top.filter((id) => profiles.has(id)).map((id) => ({ id, text: profiles.get(id).text })),
    onScores: (scores) => {
      for (const [id, s] of scores) s2.set(id, s);
      onScores?.(2, scores, film);
    },
  });
  tokens += r2.tokens;
  requests += r2.requests;
  const t2 = performance.now();

  // Refined films first (by stage-2 score), then the rest by stage 1.
  const key = (r) => withBonus(r.s2 ?? r.s1, r.film.votes, o.tieBreak);
  const ranked = [...s1.keys()]
    .map((id) => ({ film: film(id), s1: s1.get(id), s2: s2.get(id) }))
    .sort((a, b) => (b.s2 != null) - (a.s2 != null) || key(b) - key(a));
  return {
    ranked,
    stats: {
      films: films.size,
      retrieveMs,
      stage1Ms: Math.round(t1 - t0),
      stage2Ms: Math.round(t2 - t1),
      totalMs: Math.round(t2 - t0),
      requests,
      tokens,
      cost: (tokens / 1e6) * PRICE_PER_M,
    },
  };
}
