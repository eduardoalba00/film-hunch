// Wikidata → English Wikipedia titles, revision checks, and plot sections (fetched as wikitext,
// 50 articles per request, and converted to plain text).

import { getJSON, sleep, UA } from "./http.js";
import { plotFromWikitext } from "./wikitext.js";

const WIKIPEDIA = "https://en.wikipedia.org/w/api.php";

// Map of wikidata id → English Wikipedia title (50 ids per request).
export async function enwikiTitles(qids) {
  const titles = new Map();
  for (let i = 0; i < qids.length; i += 50) {
    const ids = qids.slice(i, i + 50);
    const r = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=sitelinks&sitefilter=enwiki&format=json`, { cache: false });
    for (const [qid, e] of Object.entries(r.entities ?? {})) {
      const t = e.sitelinks?.enwiki?.title;
      if (t) titles.set(qid, t);
    }
  }
  return titles;
}

// Runs an action=query over titles in batches of 50 (the API's limit for page content) and calls
// onPage(requestedTitle, page) for each existing page, mapping redirects back to the title asked for.
async function queryPages(titles, params, onPage, { concurrency = 2, log } = {}) {
  const batches = [];
  for (let i = 0; i < titles.length; i += 50) batches.push(titles.slice(i, i + 50));
  let next = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < batches.length) {
      const n = next++;
      const batch = batches[n];
      if (log && n && n % 500 === 0) log(`  wikipedia: ${n * 50}/${titles.length} titles (${((Date.now() - started) / 1000).toFixed(0)}s)`);
      const body = new URLSearchParams({ action: "query", redirects: "1", format: "json", formatversion: "2", ...params, titles: batch.join("|") });
      const r = await postJSON(WIKIPEDIA, body);
      const back = new Map(batch.map((t) => [t, t]));
      for (const n of r.query?.normalized ?? []) back.set(n.to, back.get(n.from) ?? n.from);
      for (const n of r.query?.redirects ?? []) back.set(n.to, back.get(n.from) ?? n.from);
      for (const p of r.query?.pages ?? []) {
        if (p.missing || p.invalid || !p.revisions?.[0]) continue;
        onPage(back.get(p.title) ?? p.title, p);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
}

// Map(title → current revision id).
export async function revisions(titles, opts) {
  const revs = new Map();
  await queryPages(titles, { prop: "revisions", rvprop: "ids" }, (title, p) => revs.set(title, p.revisions[0].revid), opts);
  return revs;
}

// Map(title → { plot, revid }); titles that don't exist are left out.
export async function plots(titles, opts) {
  const out = new Map();
  await queryPages(titles, { prop: "revisions", rvprop: "ids|content", rvslots: "main" }, (title, p) => {
    const rev = p.revisions[0];
    out.set(title, { plot: plotFromWikitext(rev.slots?.main?.content ?? ""), revid: rev.revid });
  }, opts);
  return out;
}

// POST to the action API (long title lists don't fit in a URL), retrying on throttling.
async function postJSON(url, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(60_000),
    }).catch((err) => ({ ok: false, status: 0, err, headers: new Headers() }));
    if ((res.status === 429 || res.status >= 500 || res.status === 0) && attempt < 8) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** Math.min(attempt, 5));
      continue;
    }
    if (!res.ok) throw res.err ?? new Error(`Wikipedia ${res.status}`);
    const json = await res.json();
    if (json.error) throw new Error(`Wikipedia: ${json.error.info}`);
    return json;
  }
}
