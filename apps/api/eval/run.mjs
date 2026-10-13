// Grades the search on the full catalog: each variant's top 10 is graded by the independent judge,
// plus the share of well-known films (1,000+ votes) among them.
// Run: npm run eval
// Compare variants of the search options: VARIANTS='[{"pool":3000},{"tail":0}]' npm run eval

import { readFile } from "node:fs/promises";
import { search } from "../lib/search.js";
import { pool } from "../lib/db.js";
import { loadJudgments, saveJudgments, judgeQuery } from "./judge.mjs";

const apiKey = process.env.TYPESAFE_API_KEY;
const queries = JSON.parse(await readFile(new URL("./queries.json", import.meta.url), "utf8"));

const RUNS = { current: {} };
for (const v of process.env.VARIANTS ? JSON.parse(process.env.VARIANTS) : []) RUNS[JSON.stringify(v)] = v;

const judgments = await loadJudgments();
const totals = {};
const stats = {};
const known = {}; // share of each top 10 with 1,000+ votes
const votes = new Map();

for (const query of queries) {
  const lists = {};
  for (const [name, opts] of Object.entries(RUNS)) {
    const r = await search({ apiKey, query, ...opts });
    (stats[name] ??= []).push(r.stats);
    for (const x of r.ranked) votes.set(x.film.id, x.film.votes);
    lists[name] = r.ranked.slice(0, 10).map((x) => x.film.id);
  }
  const s = await judgeQuery(judgments, query, lists);
  await saveJudgments(judgments);
  for (const [name, v] of Object.entries(s)) (totals[name] ??= []).push(v);
  for (const [name, ids] of Object.entries(lists)) (known[name] ??= []).push(ids.filter((id) => votes.get(id) >= 1000).length / ids.length);
  console.log(`${Object.entries(s).map(([n, v]) => `${n} ${v.good}`).join(" · ")}   ${query}`);
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log("\nvariant                      quality  good/10  bad/10  known   cost     retrieve  stage1  stage2  total");
for (const [name, xs] of Object.entries(totals)) {
  const st = stats[name];
  const ms = (k) => `${(mean(st.map((x) => x[k] ?? 0)) / 1000).toFixed(2)}s`.padStart(7);
  console.log(
    `${name.padEnd(28)} ${(mean(xs.map((x) => x.score)) * 100).toFixed(1).padStart(6)}%  ${mean(xs.map((x) => x.good)).toFixed(2).padStart(6)}  ${mean(xs.map((x) => x.bad)).toFixed(2).padStart(6)}  ${(mean(known[name]) * 100).toFixed(0).padStart(4)}%` +
      `   $${mean(st.map((x) => x.cost)).toFixed(4)} ${ms("retrieveMs")}  ${ms("stage1Ms")} ${ms("stage2Ms")} ${(mean(st.map((x) => x.totalMs ?? x.retrieveMs + x.stage1Ms + x.stage2Ms)) / 1000).toFixed(2)}s`,
  );
}
await pool.end();
