// Applies pending Drizzle migrations from db/migrations. Run: npm run db:migrate

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../lib/db.js";

await migrate(db, { migrationsFolder: new URL("../db/migrations", import.meta.url).pathname });
console.log("Migrations applied.");
await pool.end();
