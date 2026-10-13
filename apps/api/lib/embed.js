// OpenAI embeddings (text-embedding-3-small at 512 dimensions), batched, paced under the account's
// tokens-per-minute limit, and retried with OpenAI's own retry hints.

import { addCost } from "./costs.js";
import { openaiError } from "./providers.js";

const URL_ = "https://api.openai.com/v1/embeddings";
export const MODEL = "text-embedding-3-small";
export const DIMS = 512;
const BATCH = 256;
const TPM = Number(process.env.OPENAI_EMBED_TPM ?? 900_000); // stay a little under the 1M limit
export const PRICE_PER_M = 0.02; // USD per million tokens for text-embedding-3-small

// Sliding one-minute window of estimated tokens, shared by all callers in this process.
const spent = [];
async function pace(tokens) {
  for (;;) {
    const now = Date.now();
    while (spent.length && now - spent[0].at > 60_000) spent.shift();
    const used = spent.reduce((n, s) => n + s.tokens, 0);
    if (used + tokens <= TPM || !spent.length) {
      spent.push({ at: now, tokens });
      return;
    }
    await sleep(Math.max(100, 60_000 - (now - spent[0].at)));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const estimate = (texts) => Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 3.5);

function retryDelay(res, attempt) {
  const ms = Number(res.headers.get("retry-after-ms"));
  if (ms > 0) return ms + 250;
  const s = Number(res.headers.get("retry-after"));
  if (s > 0) return s * 1000 + 250;
  return 1000 * 2 ** Math.min(attempt, 6) + Math.random() * 1000;
}

export async function embed(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const input = texts.slice(i, i + BATCH);
    await pace(estimate(input));
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(URL_, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODEL, dimensions: DIMS, input }),
      }).catch((err) => ({ ok: false, status: 0, err, headers: new Headers() }));
      // Out of credit (a 429 with insufficient_quota) or a rejected key: retrying won't help.
      const body = res.ok || res.status === 0 ? "" : await res.text();
      const fatal = res.ok ? null : openaiError(res.status, body);
      if (fatal) throw fatal;
      if ((res.status === 429 || res.status >= 500 || res.status === 0) && attempt < 12) {
        await sleep(retryDelay(res, attempt));
        continue;
      }
      if (!res.ok) throw res.err ?? new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 300)}`);
      const json = await res.json();
      for (const d of json.data) out[i + d.index] = d.embedding;
      await addCost("openai", ((json.usage?.total_tokens ?? 0) / 1e6) * PRICE_PER_M);
      break;
    }
  }
  return out;
}
