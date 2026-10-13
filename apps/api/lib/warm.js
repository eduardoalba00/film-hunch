// Keeps search fast on databases that suspend when idle (common on serverless Postgres): the cache
// goes with the compute, so the first searches after a quiet spell read the vector index and film
// text from storage (seconds per query). warmIfIdle() reloads everything a search touches (~1.8 GB
// for the full catalog) in the background when traffic resumes after a gap. It only runs on a real
// request, so it never wakes the database itself.

import { sql } from "drizzle-orm";
import { db } from "./db.js";

// Serverless Postgres commonly suspends after 5 idle minutes; a slightly shorter gap errs on the side
// of warming. On an always-on database a re-warm is cheap: the pages are already cached.
const IDLE_MS = Number(process.env.WARM_AFTER_IDLE_MINUTES ?? 4) * 60_000;
// Most-needed first: the vector index serves the first step of every search.
const RELATIONS = ["chunks_embedding_idx", "films_search_idx", "films", "chunks", "chunks_film_id_n_pk", "films_pkey"];

let lastUsed = 0;
let warming = null;

export async function warm(log = console.log) {
  const started = Date.now();
  // Film text and search vectors live in the films table's TOAST relation.
  const { rows } = await db.execute(sql`select reltoastrelid::regclass::text as toast from pg_class where relname = 'films' and reltoastrelid <> 0`);
  for (const rel of [...RELATIONS, ...rows.map((r) => r.toast)]) {
    await db.execute(sql`select pg_prewarm(${rel}::regclass)`);
  }
  log(`cache warmed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

// Call on each search. Starts a warm-up (once) if the database has likely been asleep.
export function warmIfIdle(log = console.log) {
  const now = Date.now();
  const idle = now - lastUsed > IDLE_MS;
  lastUsed = now;
  if (idle && !warming) {
    warming = warm(log)
      .catch((err) => log(`cache warm-up failed: ${err.message}`))
      .finally(() => (warming = null));
  }
}
