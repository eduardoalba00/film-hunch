// Ingests a list of TMDB ids: fetch details, find each film's English Wikipedia article, fetch plots
// in batches of 50, apply the keep/reject rules, and store the result. Used by the backfill and the
// daily sync.

import { inParallel } from "./http.js";
import { details } from "./tmdb.js";
import { enwikiTitles, plots as fetchPlots } from "./wiki.js";
import { buildFilm } from "./profile.js";
import { judge } from "./rules.js";
import { upsertFilm, markRejected } from "./store.js";

// opts.cache: reuse cached TMDB responses (only useful in development).
// opts.articles: Map(tmdbId → English Wikipedia title), e.g. from Wikidata's bulk list. Without it,
// titles are looked up through each film's wikidata id.
export async function ingest(ids, { cache = false, articles = null, tmdbConcurrency = 20, log = console.log } = {}) {
  const stats = { ids: ids.length, gone: 0, indexed: 0, candidate: 0, rejected: 0, changed: 0, withPlot: 0, errors: 0 };
  const onError = (label) => (err, item) => {
    stats.errors++;
    log(`  ${label} ${item?.id ?? item}: ${err.message}`);
  };

  // details() resolves null for films TMDB deleted; other failures are kept apart so a network
  // error is never mistaken for a deletion.
  const failed = new Set();
  const ds = await inParallel(ids, tmdbConcurrency, async (id) => {
    try {
      return await details(id, { cache });
    } catch (err) {
      failed.add(id);
      onError("tmdb")(err, id);
      return null;
    }
  }, { label: "tmdb", every: 5000 });

  // English Wikipedia article per film.
  const titleOf = new Map();
  const lookup = [];
  for (const d of ds) {
    if (!d) continue;
    const known = articles?.get(d.id);
    if (known) titleOf.set(d.id, known);
    else if (d.external_ids?.wikidata_id && !articles) lookup.push(d);
  }
  if (lookup.length) {
    const byQid = await enwikiTitles([...new Set(lookup.map((d) => d.external_ids.wikidata_id))]);
    for (const d of lookup) {
      const t = byQid.get(d.external_ids.wikidata_id);
      if (t) titleOf.set(d.id, t);
    }
  }

  // Plots only for films that will be indexed.
  const wanted = ds.filter((d) => d && titleOf.has(d.id) && judge(d, { hasWiki: true }).status === "indexed");
  const plots = await fetchPlots([...new Set(wanted.map((d) => titleOf.get(d.id)))]);

  await inParallel(ds.map((d, i) => ({ d, id: ids[i] })), 8, async ({ d, id }) => {
    if (failed.has(id)) return markRejected({ id, status: "candidate", reason: "fetch failed; retry later" });
    if (!d) {
      stats.gone++;
      return markRejected({ id, status: "rejected", reason: "gone from TMDB" });
    }
    const title = titleOf.get(d.id) ?? null;
    const article = title ? plots.get(title) : null;
    // A Wikipedia title that no longer resolves doesn't count as an article.
    const verdict = judge(d, { hasWiki: Boolean(article) });
    stats[verdict.status]++;
    if (verdict.status !== "indexed") {
      return markRejected({ id: d.id, title: d.title, wikiTitle: title, votes: d.vote_count, popularity: d.popularity, status: verdict.status, reason: verdict.reason });
    }
    const film = buildFilm(d, article?.plot ?? "");
    if (film.hasPlot) stats.withPlot++;
    // The title is stored even when it didn't resolve, so the daily sync doesn't retry it every day.
    const { changed } = await upsertFilm({ ...film, wikiTitle: title, wikiRevid: article?.revid ?? null, status: "indexed", rejectReason: null });
    if (changed) stats.changed++;
  }, { label: "store", every: 5000, onError: onError("store") });

  return stats;
}
