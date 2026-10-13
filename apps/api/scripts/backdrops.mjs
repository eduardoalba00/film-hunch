// One-time: fills in TMDB backdrop images for indexed films that have none (the daily sync stores
// them for films it touches from now on). Most-voted first; films below --min-votes are skipped.
// Run: node --env-file=.env scripts/backdrops.mjs [--min-votes=100]

import { sql } from "drizzle-orm";
import { db, pool } from "../lib/db.js";
import { getJSON, inParallel, HttpError } from "../lib/http.js";

const minVotes = Number(process.argv.find((a) => a.startsWith("--min-votes="))?.split("=")[1] ?? 100);
const headers = { Authorization: `Bearer ${process.env.TMDB_TOKEN}`, accept: "application/json" };

const { rows } = await db.execute(sql`
  select id from films where status = 'indexed' and backdrop is null and votes >= ${minVotes} order by votes desc`);
console.log(`${rows.length} films need a backdrop`);

let found = 0;
const BATCH = 500;
for (let i = 0; i < rows.length; i += BATCH) {
  const ids = rows.slice(i, i + BATCH).map((r) => r.id);
  const paths = [];
  await inParallel(ids, 20, async (id) => {
    try {
      const d = await getJSON(`https://api.themoviedb.org/3/movie/${id}?language=en-US`, { headers, cache: false });
      if (d.backdrop_path) paths.push([id, d.backdrop_path]);
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
    }
  });
  if (paths.length) {
    const values = sql.join(paths.map(([id, p]) => sql`(${id}::int, ${p}::text)`), sql`, `);
    await db.execute(sql`update films set backdrop = v.p from (values ${values}) as v(id, p) where films.id = v.id`);
  }
  found += paths.length;
  console.log(`${Math.min(i + BATCH, rows.length)}/${rows.length} checked, ${found} backdrops`);
}
await pool.end();
