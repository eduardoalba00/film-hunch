// Scores films against a request with Jev: films are sent in batches (one Score question per film),
// several requests in flight, results streamed via onScores.

import { jevError } from "./providers.js";

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const PRICE_PER_M = 0.042;

export class JevError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function ask(apiKey, state, questions, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state, questions }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text();
      // Out of credit or a rejected key: retrying won't help, so fail at once.
      const fatal = jevError(res.status, body);
      if (fatal) throw fatal;
      if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
        continue;
      }
      throw new JevError(`Jev returned ${res.status}: ${body.slice(0, 300)}`, res.status);
    }
    return res.json();
  }
}

const normalise = (answer) => {
  const levels = Object.keys(answer.legend).map(Number);
  return (answer.score - Math.min(...levels)) / (Math.max(...levels) - Math.min(...levels));
};

const COMPACT_LEVELS = [
  "Not what was asked for.",
  "Surface overlap only; misses the core.",
  "Partly fits.",
  "Fits nearly everything.",
  "Exactly what was described.",
];

// `instruction(id)` and `levels` can be overridden (shorter wording costs fewer tokens per film).
export async function scoreCompact({
  apiKey, query, items, batchSize = 8, concurrency = 16, signal, onScores, meter,
  instruction = (id) => `Score film_${id} against the request, respecting every part of it, including exclusions.`,
  levels = COMPACT_LEVELS,
}) {
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));
  let next = 0;
  let tokens = 0;
  const worker = async () => {
    while (next < batches.length) {
      if (signal?.aborted) return;
      const group = batches[next++];
      const state = {
        request: query,
        films: Object.fromEntries(group.map((f) => [`film_${f.id}`, f.text])),
      };
      const questions = Object.fromEntries(
        group.map((f) => [
          `f${f.id}`,
          {
            type: "score",
            instructions: instruction(f.id),
            criteria: levels,
          },
        ]),
      );
      const r = await ask(apiKey, state, questions, signal);
      tokens += r.usage?.input_tokens ?? 0;
      // A shared meter sees tokens as they're spent, so a search that fails partway still knows its cost.
      if (meter) meter.tokens += r.usage?.input_tokens ?? 0;
      onScores?.(group.map((f) => [f.id, normalise(r.answers[`f${f.id}`])]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return { tokens, requests: batches.length };
}
