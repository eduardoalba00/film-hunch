// The running-cost ledger: daily totals per source, added to as costs happen. Recording never
// throws, so a ledger hiccup can't break a search or a sync.

import { sql } from "drizzle-orm";
import { db, schema } from "./db.js";

const { costs } = schema;

export async function addCost(source, usd) {
  if (!(usd > 0)) return;
  try {
    await db
      .insert(costs)
      .values({ day: new Date().toISOString().slice(0, 10), source, usd })
      .onConflictDoUpdate({ target: [costs.day, costs.source], set: { usd: sql`${costs.usd} + ${usd}` } });
  } catch (err) {
    console.error("cost not recorded:", err.message);
  }
}
