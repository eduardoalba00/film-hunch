// TMDB access: the daily ID export, the changes feed, and per-film details.

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { getJSON, HttpError, UA } from "./http.js";

const API = "https://api.themoviedb.org/3";
const headers = () => ({ Authorization: `Bearer ${process.env.TMDB_TOKEN}`, accept: "application/json" });

export const detailsUrl = (id) => `${API}/movie/${id}?append_to_response=keywords,external_ids,credits&language=en-US`;

// Full details for one film, or null if TMDB no longer has it.
export async function details(id, { cache = true } = {}) {
  try {
    return await getJSON(detailsUrl(id), { headers: headers(), cache });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

const exportUrl = (date) => {
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `https://files.tmdb.org/p/exports/movie_ids_${mm}_${dd}_${date.getUTCFullYear()}.json.gz`;
};

// Streams the newest available daily export (published each morning UTC; falls back a few days).
// Yields { id, popularity, video, adult }.
export async function* exportIds() {
  for (let back = 0; back < 4; back++) {
    const url = exportUrl(new Date(Date.now() - back * 86_400_000));
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) continue;
    const lines = createInterface({ input: Readable.fromWeb(res.body).pipe(createGunzip()) });
    for await (const line of lines) {
      if (!line) continue;
      const m = JSON.parse(line);
      yield { id: m.id, popularity: m.popularity ?? 0, video: Boolean(m.video), adult: Boolean(m.adult) };
    }
    return;
  }
  throw new Error("No TMDB export available for the last 4 days");
}

// Every film with at least `minVotes` votes, as { id, title, votes, popularity }. TMDB returns at most
// 500 pages (10,000 results) per query, so release-date windows are halved until each fits.
export async function discoverFilms({ minVotes = 5, from = "1870-01-01", to = new Date().toISOString().slice(0, 10), concurrency = 20, log = console.log } = {}) {
  const day = 86_400_000;
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const url = (start, end, page) =>
    `${API}/discover/movie?include_adult=false&include_video=false&vote_count.gte=${minVotes}` +
    `&primary_release_date.gte=${fmt(start)}&primary_release_date.lte=${fmt(end)}&sort_by=primary_release_date.asc&page=${page}`;

  // 1. Find windows small enough to page through completely.
  const windows = [];
  const pending = [[Date.parse(from), Date.parse(to)]];
  while (pending.length) {
    const batch = pending.splice(0, concurrency);
    const firsts = await Promise.all(batch.map(([s, e]) => getJSON(url(s, e, 1), { headers: headers(), cache: false })));
    batch.forEach(([s, e], i) => {
      const total = firsts[i].total_results ?? 0;
      if (total >= 10_000 && e - s > day) {
        const mid = s + Math.floor((e - s) / day / 2) * day;
        pending.push([s, mid], [mid + day, e]);
      } else if (total > 0) {
        windows.push({ s, e, pages: Math.min(500, firsts[i].total_pages ?? 1), first: firsts[i] });
      }
    });
  }
  const pages = windows.reduce((n, w) => n + w.pages, 0);
  log(`  ${windows.length} date windows, ${pages} pages`);

  // 2. Page through every window.
  const films = new Map();
  const add = (r) => {
    for (const m of r.results ?? []) films.set(m.id, { id: m.id, title: m.title, votes: m.vote_count, popularity: m.popularity });
  };
  windows.forEach((w) => add(w.first));
  const rest = windows.flatMap((w) => Array.from({ length: w.pages - 1 }, (_, i) => [w.s, w.e, i + 2]));
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < rest.length) {
      const [s, e, page] = rest[next++];
      add(await getJSON(url(s, e, page), { headers: headers(), cache: false }));
      if (++done % 2000 === 0) log(`  discover: ${done}/${rest.length} pages, ${films.size} films`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return [...films.values()];
}

// IDs of movies changed between two dates (TMDB allows ranges of up to 14 days).
export async function changedIds(start, end) {
  const fmt = (d) => d.toISOString().slice(0, 10);
  const ids = new Set();
  for (let page = 1; ; page++) {
    const r = await getJSON(`${API}/movie/changes?start_date=${fmt(start)}&end_date=${fmt(end)}&page=${page}`, { headers: headers(), cache: false });
    for (const c of r.results ?? []) if (!c.adult) ids.add(c.id);
    if (page >= (r.total_pages ?? 1)) break;
  }
  return [...ids];
}
