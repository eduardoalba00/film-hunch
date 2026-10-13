// Records real searches from a running API for the landing page (Landing.jsx) to replay: each
// search's score stream with its timing, trimmed to the films that end up on screen, their details,
// and the home page's poster wall. Run with the API up (~$0.05 of Jev per search):
//   node scripts/record-demo.mjs [api url]

import { writeFile } from "node:fs/promises";

const API = process.argv[2] ?? "http://localhost:3000";
const QUERIES = [
  "Inception, but slower and sadder",
  "a heist so clever nobody ever finds out",
  "cozy enough for a rainy Sunday, nothing violent",
];
const KEEP = 31; // the best match plus the first grid the page shows

async function record(query) {
  const res = await fetch(`${API}/api/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`${res.status} for "${query}"`);
  const started = Date.now();
  const events = [];
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      if (event && data) events.push({ t: Date.now() - started, event, data: JSON.parse(data) });
    }
  }
  const failed = events.find((e) => e.event === "error");
  if (failed) throw new Error(`"${query}": ${failed.data.message}`);
  if (events.at(-1)?.data?.cached) throw new Error(`"${query}" came from the cache, so it has no timing to replay`);

  // The films on screen at the end: same order the page uses (re-scored first, then by score).
  const s1 = new Map(), s2 = new Map(), cards = new Map();
  for (const { event, data } of events) {
    if (event !== "scores") continue;
    for (const c of data.cards) cards.set(c.id, c);
    for (const [id, s] of data.scores) (data.stage === 1 ? s1 : s2).set(id, s);
  }
  const score = (id) => s2.get(id) ?? s1.get(id) ?? 0;
  const keep = new Set([...cards.keys()].sort((a, b) => s2.has(b) - s2.has(a) || score(b) - score(a)).slice(0, KEEP));

  // Score events keep their size (it drives the "Reading n films" counter) but only kept films.
  const stream = events.map(({ t, event, data }) =>
    event === "scores"
      ? { t, event, data: { stage: data.stage, read: data.scores.length, scores: data.scores.filter(([id]) => keep.has(id)), cards: data.cards.filter((c) => keep.has(c.id)) } }
      : { t, event, data },
  );
  const details = await (await fetch(`${API}/api/films?ids=${[...keep].join(",")}`)).json();
  console.log(`"${query}": ${events.length} events over ${(events.at(-1).t / 1000).toFixed(1)}s, ${keep.size} films kept`);
  return { query, stream, details };
}

const searches = [];
for (const q of QUERIES) searches.push(await record(q));
const showcase = await (await fetch(`${API}/api/showcase`)).json();
const out = new URL("../src/demo.json", import.meta.url);
await writeFile(out, JSON.stringify({ showcase, searches }));
console.log(`wrote ${out.pathname}`);
