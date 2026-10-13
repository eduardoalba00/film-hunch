// One-time backfill of the catalog. Resumable: every phase picks up where it stopped.
//   seed    list candidate films: every film with an English Wikipedia article (Wikidata) plus every
//           film with 5+ TMDB votes (discover), stored as unchecked candidates
//   ingest  fetch details and plots for unchecked candidates, most-voted first, and apply the rules
//   embed   embed all pending chunks, then rebuild the vector index
// Run: node --env-file=.env scripts/backfill.mjs [seed|ingest|embed|all] [--min-votes=N]
// --min-votes=N seeds only films with N+ TMDB votes (npm run seed uses 100: ~23k films instead of
// ~205k) and the daily sync then keeps to that line. Running again without it grows the catalog to
// the full size; films already ingested are kept.

import { sql, isNull, desc } from "drizzle-orm";
import { db, schema, pool } from "../lib/db.js";
import { discoverFilms, exportIds } from "../lib/tmdb.js";
import { filmArticles } from "../lib/wikidata.js";
import { ingest } from "../lib/ingest.js";
import { embedPending, dropVectorIndex, buildVectorIndex } from "../lib/store.js";
import { recordRun, getState, setState } from "../lib/runs.js";
import { requireContact } from "../lib/http.js";

const { films } = schema;
const phase = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "all";
const minVotesArg = process.argv.find((a) => a.startsWith("--min-votes="));
const minVotes = minVotesArg ? Number(minVotesArg.split("=")[1]) : 0; // 0: the full catalog
if (!Number.isInteger(minVotes) || minVotes < 0) throw new Error("--min-votes takes a whole number");
const BATCH = 2000;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function seed(stats) {
  // The sync keeps to the widest catalog ever seeded: a full seed after a small one stays full.
  const seeded = await getState("catalog_min_votes");
  if (seeded === null || minVotes < Number(seeded)) await setState("catalog_min_votes", String(minVotes));

  log("seed: Wikidata films with English articles");
  const articles = await filmArticles();
  log(`  ${articles.size} films with articles`);
  const voteLine = Math.max(5, minVotes);
  log(`seed: TMDB films with ${voteLine}+ votes`);
  const discovered = await discoverFilms({ minVotes: voteLine, log });
  log(`  ${discovered.length} films with ${voteLine}+ votes`);

  const rows = new Map();
  // A full seed also takes films known only from Wikipedia; a small one keeps to the vote line.
  if (!minVotes) for (const [id, title] of articles) rows.set(id, { id, title, wikiTitle: title });
  for (const f of discovered) {
    const wikiTitle = articles.get(f.id);
    rows.set(f.id, { ...(wikiTitle ? { wikiTitle } : {}), id: f.id, title: f.title ?? wikiTitle ?? "", votes: f.votes ?? 0, popularity: f.popularity });
  }
  const all = [...rows.values()];
  for (let i = 0; i < all.length; i += 5000) {
    await db.insert(films).values(all.slice(i, i + 5000)).onConflictDoNothing();
  }
  Object.assign(stats, { articles: articles.size, discovered: discovered.length, seeded: all.length });
  log(`seed: ${all.length} candidates stored`);
}

async function ingestAll(stats) {
  const articles = await filmArticles();
  const [{ remaining }] = (await db.execute(sql`select count(*)::int as remaining from films where checked_at is null`)).rows;
  log(`ingest: ${remaining} films to check`);
  const totals = { batches: 0, indexed: 0, candidate: 0, rejected: 0, gone: 0, withPlot: 0, errors: 0 };
  const started = Date.now();
  let done = 0;
  for (;;) {
    const ids = (await db.select({ id: films.id }).from(films).where(isNull(films.checkedAt)).orderBy(desc(films.votes), films.id).limit(BATCH)).map((r) => r.id);
    if (!ids.length) break;
    const s = await ingest(ids, { articles, log });
    for (const k of Object.keys(totals)) if (k in s) totals[k] += s[k];
    totals.batches++;
    // Films whose details failed stay unchecked; stop rather than retry them forever in one run.
    if (s.errors === ids.length) throw new Error("Every film in the batch failed; stopping");
    done += ids.length;
    const rate = done / ((Date.now() - started) / 1000);
    const eta = Math.round((remaining - done) / rate / 60);
    log(`ingest: ${done}/${remaining} (${rate.toFixed(0)}/s, ~${eta} min left) indexed ${totals.indexed}, with plot ${totals.withPlot}, candidates ${totals.candidate}, rejected ${totals.rejected}, errors ${totals.errors}`);
  }
  Object.assign(stats, { ingest: totals });
}

async function embedAll(stats) {
  log("embed: dropping vector index for the bulk load");
  await dropVectorIndex();
  const n = await embedPending({ concurrency: 4, log });
  log(`embed: ${n} chunks embedded; building vector index`);
  await buildVectorIndex();
  log("embed: index built");
  stats.embedded = n;
}

requireContact();
const startedAt = new Date();
try {
  await recordRun("backfill", async (stats) => {
    stats.phase = phase;
    if (phase === "seed" || phase === "all") await seed(stats);
    if (phase === "ingest" || phase === "all") await ingestAll(stats);
    if (phase === "embed" || phase === "all") await embedAll(stats);
    // The daily sync picks up TMDB changes from the day the backfill started, and treats ids above
    // today's highest export id as new films.
    if (phase === "all" || phase === "ingest") {
      await setState("last_sync", startedAt.toISOString().slice(0, 10));
      let maxId = 0;
      for await (const m of exportIds()) if (m.id > maxId) maxId = m.id;
      await setState("max_export_id", String(maxId));
    }
  });
  log(`done in ${Math.round((Date.now() - startedAt) / 60_000)} min`);
} finally {
  await pool.end();
}
