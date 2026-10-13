// HTTP helpers shared by the backfill and the daily sync: JSON fetches with retries (honouring
// Retry-After), an optional on-disk cache so interrupted jobs resume cheaply, and a worker pool.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

// Wikipedia and Wikidata ask every client to identify itself with a way to reach whoever runs it, so
// the backfill and sync refuse to run without CONTACT_EMAIL (see requireContact). Each install sends
// only its own operator's address.
export const UA = `movie-search/1.0 (${process.env.CONTACT_EMAIL ?? "no contact set"})`;

export function requireContact() {
  if (!process.env.CONTACT_EMAIL) {
    throw new Error("Set CONTACT_EMAIL in apps/api/.env: Wikipedia and Wikidata require a contact address in the User-Agent of bulk clients.");
  }
}
const CACHE = new URL("../data/cache/", import.meta.url).pathname;
let cacheReady = null;

export class HttpError extends Error {
  constructor(status, url) {
    super(`${status} ${url}`);
    this.status = status;
  }
}

// cache: true reads and writes data/cache; false always hits the network (daily sync wants fresh data).
export async function getJSON(url, { headers = {}, cache = true, retries = 8 } = {}) {
  const file = `${CACHE}${createHash("sha1").update(url).digest("hex")}.json`;
  if (cache) {
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      // not cached yet
    }
  }
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * 2 ** Math.min(attempt, 5));
        continue;
      }
      throw err;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** Math.min(attempt, 5));
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, url);
    const json = await res.json();
    if (cache) {
      cacheReady ??= mkdir(CACHE, { recursive: true });
      await cacheReady;
      await writeFile(file, JSON.stringify(json));
    }
    return json;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs fn over items with `limit` in flight. Failed items resolve to null and are reported to
// onError; progress is logged every `every` items.
export async function inParallel(items, limit, fn, { label = "", every = 1000, onError } = {}) {
  const out = new Array(items.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        out[i] = null;
        if (onError) onError(err, items[i]);
        else console.warn(`  ${label} failed: ${err.message}`);
      }
      if (++done % every === 0 && label) {
        const rate = done / ((Date.now() - started) / 1000);
        console.log(`  ${label}: ${done}/${items.length} (${rate.toFixed(0)}/s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
