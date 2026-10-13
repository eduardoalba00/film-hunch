// Writes films and their chunks, and fills in missing embeddings.

import { eq, isNull, sql, getTableColumns } from "drizzle-orm";
import { db, schema } from "./db.js";
import { embed } from "./embed.js";

const { films, chunks } = schema;

// Columns refreshed on every upsert (everything except the primary key and generated columns).
const UPDATE_SET = Object.fromEntries(
  Object.entries(getTableColumns(films))
    .filter(([key]) => !["id", "searchTsv", "updatedAt"].includes(key))
    .map(([key, col]) => [key, sql.raw(`excluded."${col.name}"`)]),
);

// film: output of buildFilm plus { wikiTitle, wikiRevid, status, rejectReason }.
// Chunks are only rewritten (and so re-embedded) when the film's text changed.
export async function upsertFilm(film) {
  const { chunks: pieces, ...row } = film;
  const now = new Date();
  return db.transaction(async (tx) => {
    const [prev] = await tx.select({ textHash: films.textHash, status: films.status }).from(films).where(eq(films.id, row.id)).for("update");
    await tx
      .insert(films)
      .values({ ...row, tmdbFetchedAt: now, checkedAt: now })
      .onConflictDoUpdate({ target: films.id, set: { ...UPDATE_SET, updatedAt: now } });
    const indexed = row.status === "indexed";
    const changed = prev?.textHash !== row.textHash || prev?.status !== "indexed";
    if (!indexed || changed) await tx.delete(chunks).where(eq(chunks.filmId, row.id));
    if (indexed && changed && pieces.length) {
      await tx.insert(chunks).values(pieces.map((c, n) => ({ filmId: row.id, n, kind: c.kind, text: c.text })));
    }
    return { changed: indexed && changed };
  });
}

// Records a film that is not (or no longer) indexed, keeping its vote count so later re-checks can
// prioritise films that are gaining attention. Its chunks are removed.
export async function markRejected({ id, title, wikiTitle, votes, popularity, status, reason }) {
  const now = new Date();
  const known = { ...(votes == null ? {} : { votes, popularity }), ...(wikiTitle ? { wikiTitle } : {}) };
  await db
    .insert(films)
    .values({ id, title: title ?? "", ...known, status, rejectReason: reason, checkedAt: now })
    .onConflictDoUpdate({
      target: films.id,
      set: { ...(title ? { title } : {}), ...known, status, rejectReason: reason, checkedAt: now, updatedAt: now },
    });
  await db.delete(chunks).where(eq(chunks.filmId, id));
}

// Embeds every chunk that has no embedding yet, with `concurrency` workers each taking a disjoint
// slice of films. Safe to stop and re-run.
export async function embedPending({ batch = 1024, concurrency = 1, log = console.log } = {}) {
  let total = 0;
  const started = Date.now();
  const worker = async (k) => {
    for (;;) {
      const rows = await db
        .select({ filmId: chunks.filmId, n: chunks.n, text: chunks.text })
        .from(chunks)
        .where(sql`${chunks.embedding} is null and ${chunks.filmId} % ${concurrency} = ${k}`)
        .limit(batch);
      if (!rows.length) return;
      const vectors = await embed(rows.map((r) => r.text));
      // One statement per batch: update from a VALUES list. The text is dropped once embedded.
      const values = sql.join(rows.map((r, i) => sql`(${r.filmId}::int, ${r.n}::smallint, ${JSON.stringify(vectors[i])}::halfvec)`), sql`, `);
      await db.execute(sql`
        update chunks set embedding = v.embedding, text = null
        from (values ${values}) as v(film_id, n, embedding)
        where chunks.film_id = v.film_id and chunks.n = v.n`);
      total += rows.length;
      const every = batch * concurrency * 10;
      if (total % every < rows.length) log(`  embedded ${total} chunks (${(total / ((Date.now() - started) / 1000)).toFixed(0)}/s)`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, k) => worker(k)));
  return total;
}

// Drops the vector index before a bulk embed (filling it row by row is slow) and rebuilds it after.
export async function dropVectorIndex() {
  await db.execute(sql`drop index if exists chunks_embedding_idx`);
}

export async function buildVectorIndex({ memory = "2GB" } = {}) {
  // One transaction, so the settings apply to the connection that builds the index.
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local maintenance_work_mem = '${memory}'`));
    await tx.execute(sql`set local max_parallel_maintenance_workers = 4`);
    await tx.execute(sql`create index if not exists chunks_embedding_idx on chunks using hnsw (embedding halfvec_cosine_ops)`);
  });
}
