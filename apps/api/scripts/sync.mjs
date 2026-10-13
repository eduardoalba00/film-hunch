// Daily sync (run it from cron). Keeps the catalog current:
//   1. films TMDB changed since the last sync, including films we don't track yet (a film added to
//      TMDB long ago with few votes can become notable later; its edits show up here)
//   1b. films released in the last 18 months: fresh votes and popularity (the changes feed doesn't
//      report them, and search keeps places for popular new releases), new ones ingested,
//      candidates that crossed the vote line re-checked
//   2. films added to TMDB since the last sync (ids above the highest id seen before)
//   3. indexed films that left TMDB's export
//   4. candidates due for a re-check (weekly, most-voted first)
//   5. films that gained a Wikipedia article (daily), and films whose article was edited: recent
//      releases daily (their plot sections are often written weeks after release), everything
//      else monthly
// All of them go through the same ingest step, then new chunks are embedded.
// A catalog seeded with --min-votes (see backfill.mjs) only grows by films past that vote line: films
// it doesn't track yet are taken from the recent-releases list, which carries vote counts.
// Run: node --env-file=.env scripts/sync.mjs

import { sql, and, eq, lt, desc, isNotNull, inArray } from "drizzle-orm";
import { db, schema, pool } from "../lib/db.js";
import { changedIds, exportIds, discoverFilms } from "../lib/tmdb.js";
import { filmArticles } from "../lib/wikidata.js";
import { revisions } from "../lib/wiki.js";
import { ingest } from "../lib/ingest.js";
import { embedPending } from "../lib/store.js";
import { recordRun, getState, setState } from "../lib/runs.js";
import { requireContact } from "../lib/http.js";

const { films } = schema;
const BATCH = 2000;
const RECHECK_DAYS = 7;
const RECHECK_LIMIT = 20_000;
const RECENT_DAYS = 548; // ~18 months, matching the search pool's new-release window
const FULL_WIKI_DAYS = 30; // how often every Wikipedia article is checked for edits
const MAX_PER_RUN = 50_000; // anything beyond this waits for the next run
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const day = 86_400_000;

async function tmdbChanges(since, until) {
  const ids = new Set();
  // The changes feed accepts windows of up to 14 days.
  for (let start = since; start < until; start = new Date(start.getTime() + 14 * day)) {
    const end = new Date(Math.min(until.getTime(), start.getTime() + 14 * day));
    for (const id of await changedIds(start, end)) ids.add(id);
  }
  return ids;
}

async function run(stats) {
  const today = new Date();
  const since = new Date((await getState("last_sync")) ?? new Date(today.getTime() - day).toISOString().slice(0, 10));
  const minVotes = Number((await getState("catalog_min_votes")) ?? 0);
  // Work lists in priority order; the run takes from the front until MAX_PER_RUN.
  const lists = { changed: [], added: [], changedUntracked: [], recentUntracked: [], recentPromoted: [], removed: [], wikiEdited: [], wikiGained: [], wikiUnseen: [], rechecked: [] };

  log(`1. TMDB changes since ${since.toISOString().slice(0, 10)}`);
  const changed = await tmdbChanges(since, today);
  // Films we track come first. The rest go through the same notability rules (brand-new ids are also
  // picked up in step 2; duplicates are merged when the work list is built).
  const changedList = [...changed];
  const trackedChanged = new Set();
  for (let i = 0; i < changedList.length; i += 5000) {
    const rows = await db.select({ id: films.id }).from(films).where(inArray(films.id, changedList.slice(i, i + 5000)));
    for (const r of rows) trackedChanged.add(r.id);
  }
  lists.changed = [...trackedChanged];
  lists.changedUntracked = changedList.filter((id) => !trackedChanged.has(id));

  log("1b. Recent releases: votes and popularity");
  const recent = await discoverFilms({ minVotes: 5, from: new Date(today.getTime() - RECENT_DAYS * day).toISOString().slice(0, 10), log });
  const recentTracked = new Set();
  for (let i = 0; i < recent.length; i += 1000) {
    const values = sql.join(recent.slice(i, i + 1000).map((f) => sql`(${f.id}::int, ${f.votes ?? 0}::int, ${f.popularity ?? 0}::real)`), sql`, `);
    const { rows } = await db.execute(sql`
      update films set votes = v.votes, popularity = v.popularity
      from (values ${values}) as v(id, votes, popularity)
      where films.id = v.id
      returning films.id, films.status, films.votes`);
    for (const r of rows) {
      recentTracked.add(r.id);
      // Not notable when last checked, but past the vote line now: check again today.
      if (r.status === "candidate" && r.votes >= 20) lists.recentPromoted.push(r.id);
    }
  }
  lists.recentUntracked = recent.filter((f) => !recentTracked.has(f.id) && (f.votes ?? 0) >= minVotes).map((f) => f.id);
  stats.recentRefreshed = recentTracked.size;

  log("2-3. TMDB export: new films and removals");
  const maxSeen = Number((await getState("max_export_id")) ?? 0);
  let maxId = maxSeen;
  const inExport = new Set();
  const added = [];
  for await (const m of exportIds()) {
    inExport.add(m.id);
    if (m.id > maxId) maxId = m.id;
    if (maxSeen && m.id > maxSeen && !m.video) added.push(m.id);
  }
  lists.added = added;
  const indexed = await db.select({ id: films.id }).from(films).where(eq(films.status, "indexed"));
  lists.removed = indexed.filter((r) => !inExport.has(r.id)).map((r) => r.id);

  log("4. candidates due for a re-check");
  const due = await db
    .select({ id: films.id })
    .from(films)
    .where(and(eq(films.status, "candidate"), lt(films.checkedAt, new Date(today.getTime() - RECHECK_DAYS * day))))
    .orderBy(desc(films.votes))
    .limit(RECHECK_LIMIT);
  lists.rechecked = due.map((r) => r.id);

  const lastFull = await getState("wiki_full_check");
  const fullWiki = !lastFull || today.getTime() - Date.parse(lastFull) >= FULL_WIKI_DAYS * day;
  log(`5. Wikipedia: new articles and edited plots (${fullWiki ? "every article" : "recent releases"})`);
  const articles = await filmArticles();
  const withArticles = await db
    .select({ id: films.id, wikiTitle: films.wikiTitle, wikiRevid: films.wikiRevid })
    .from(films)
    .where(and(
      eq(films.status, "indexed"),
      isNotNull(films.wikiTitle),
      fullWiki ? undefined : sql`${films.releaseDate} >= now() - make_interval(days => ${RECENT_DAYS})`,
    ));
  stats.wikiChecked = withArticles.length;
  const revs = await revisions(withArticles.map((r) => r.wikiTitle), { concurrency: 2, log });
  // Edited, or the article was deleted/renamed (no revision found).
  lists.wikiEdited = withArticles.filter((r) => (revs.get(r.wikiTitle) ?? null) !== (r.wikiRevid ?? null)).map((r) => r.id);
  // Films we know (indexed or not) whose article is new or moved since we last looked.
  const tracked = await db.select({ id: films.id, wikiTitle: films.wikiTitle, status: films.status }).from(films);
  lists.wikiGained = tracked.filter((r) => articles.has(r.id) && articles.get(r.id) !== r.wikiTitle && r.status !== "rejected").map((r) => r.id);
  // Films that got an article but were never seeded (few votes, older than the backfill).
  const trackedIds = new Set(tracked.map((r) => r.id));
  lists.wikiUnseen = [...articles.keys()].filter((id) => !trackedIds.has(id));

  // Untracked films with unknown vote counts would grow a small catalog toward the full one.
  if (minVotes) lists.changedUntracked = lists.added = lists.wikiUnseen = [];

  const ids = new Set();
  const wanted = new Set();
  for (const [name, list] of Object.entries(lists)) {
    stats[name] = list.length;
    for (const id of list) {
      wanted.add(id);
      if (ids.size < MAX_PER_RUN) ids.add(id);
    }
  }
  const all = [...ids];
  stats.deferred = wanted.size - all.length; // films appear in several lists; count each once
  log(`ingesting ${all.length} films`);
  const totals = { indexed: 0, candidate: 0, rejected: 0, gone: 0, changed: 0, errors: 0 };
  for (let i = 0; i < all.length; i += BATCH) {
    const s = await ingest(all.slice(i, i + BATCH), { articles, log });
    for (const k of Object.keys(totals)) totals[k] += s[k] ?? 0;
    log(`  ${Math.min(i + BATCH, all.length)}/${all.length}`);
  }
  stats.ingest = totals;

  log("embedding new chunks");
  stats.embedded = await embedPending({ concurrency: 2, log });

  await setState("last_sync", today.toISOString().slice(0, 10));
  if (fullWiki) await setState("wiki_full_check", today.toISOString().slice(0, 10));
  await setState("max_export_id", String(maxId));
  const [{ n }] = (await db.execute(sql`select count(*)::int as n from films where status = 'indexed'`)).rows;
  stats.catalog = n;
  log(`done: catalog has ${n} films`, JSON.stringify(stats));
}

try {
  requireContact();
  await recordRun("daily", run);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
