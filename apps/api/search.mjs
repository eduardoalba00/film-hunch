// Command-line search: node --env-file=.env search.mjs "psychological thriller with a sad ending"

import { search } from "./lib/search.js";
import { pool } from "./lib/db.js";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('Usage: node --env-file=.env search.mjs "your request"');
  process.exit(1);
}

const { ranked, stats } = await search({ apiKey: process.env.TYPESAFE_API_KEY, query });
console.log(`\n"${query}"\n`);
ranked.slice(0, 20).forEach(({ film, s1, s2 }, i) => {
  console.log(`${String(i + 1).padStart(2)}. ${(((s2 ?? s1) * 100).toFixed(0)).padStart(3)}%  ${film.title} (${film.year})`);
});
console.log(`\n${stats.films} films read · first pass ${stats.stage1Ms}ms · full profiles ${stats.stage2Ms}ms · total ${(stats.totalMs / 1000).toFixed(1)}s · ${stats.requests} Jev calls · $${stats.cost.toFixed(4)}`);
await pool.end();
