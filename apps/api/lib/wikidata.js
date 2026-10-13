// Every film that has both a TMDB id and an English Wikipedia article, in one query.
// Uses QLever's public Wikidata endpoint; the official query service times out on this join.

import { UA, sleep } from "./http.js";

const ENDPOINT = "https://qlever.dev/api/wikidata";
const QUERY = `PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX schema: <http://schema.org/>
SELECT ?tmdb ?article WHERE {
  ?item wdt:P4947 ?tmdb .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
}`;

// Map(tmdbId → English Wikipedia title).
export async function filmArticles() {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ query: QUERY })}`, {
      headers: { Accept: "text/csv", "User-Agent": UA },
      signal: AbortSignal.timeout(120_000),
    }).catch((err) => ({ ok: false, err }));
    if (res.ok) {
      const articles = new Map();
      for (const line of (await res.text()).split("\n").slice(1)) {
        const comma = line.indexOf(",");
        if (comma < 0) continue;
        const id = Number(line.slice(0, comma));
        const url = line.slice(comma + 1).replace(/^"|"$/g, "");
        const title = decodeURIComponent(url.replace("https://en.wikipedia.org/wiki/", "")).replace(/_/g, " ");
        // Wikidata sometimes holds several TMDB ids per film; keep the first article per id.
        if (Number.isInteger(id) && title && !articles.has(id)) articles.set(id, title);
      }
      if (articles.size < 100_000) throw new Error(`Wikidata returned only ${articles.size} films; refusing to use a partial list`);
      return articles;
    }
    if (attempt >= 4) throw res.err ?? new Error(`Wikidata query failed: ${res.status}`);
    await sleep(5000 * 2 ** attempt);
  }
}
