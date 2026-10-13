// Records pipeline runs in sync_runs, and small bits of state (like the last sync date) in sync_state.

import { eq } from "drizzle-orm";
import { db, schema } from "./db.js";

const { syncRuns, syncState } = schema;

// Runs fn(stats) inside a recorded run. stats is mutated by fn and saved as the run's result.
export async function recordRun(job, fn) {
  const [run] = await db.insert(syncRuns).values({ job }).returning({ id: syncRuns.id });
  const stats = {};
  try {
    await fn(stats);
    await db.update(syncRuns).set({ finishedAt: new Date(), ok: true, stats }).where(eq(syncRuns.id, run.id));
    return stats;
  } catch (err) {
    await db.update(syncRuns).set({ finishedAt: new Date(), ok: false, stats: { ...stats, error: String(err?.stack ?? err) } }).where(eq(syncRuns.id, run.id));
    throw err;
  }
}

export async function getState(key) {
  const [row] = await db.select().from(syncState).where(eq(syncState.key, key));
  return row?.value ?? null;
}

export async function setState(key, value) {
  await db.insert(syncState).values({ key, value }).onConflictDoUpdate({ target: syncState.key, set: { value } });
}
