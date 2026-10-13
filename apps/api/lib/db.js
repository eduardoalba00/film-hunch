// Database access through Drizzle. DATABASE_URL: any Postgres with pgvector (`npm run db` starts one
// in Docker).

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema.js";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL ?? 10),
});

export const db = drizzle(pool, { schema });
export { schema };
