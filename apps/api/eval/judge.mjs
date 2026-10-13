// Judges result quality directly instead of comparing against a noisy baseline run.
// For each query, every film any pipeline put in its top 10 is graded by an independent model
// (0 = not a match, 1 = partial, 2 = good match) from its full profile. Grades are cached in
// eval/judgments.json, so later pipeline variants only pay for films not yet judged.

import { readFile, writeFile } from "node:fs/promises";
import { inArray } from "drizzle-orm";
import { db, schema } from "../lib/db.js";

export const JUDGE_MODEL = "gpt-5.4-mini";
const JUDGMENTS = new URL("./judgments.json", import.meta.url);

export async function loadJudgments() {
  try {
    return JSON.parse(await readFile(JUDGMENTS, "utf8"));
  } catch {
    return {};
  }
}
export const saveJudgments = (j) => writeFile(JUDGMENTS, JSON.stringify(j, null, 1));

async function grade(query, films) {
  const body = {
    model: JUDGE_MODEL,
    reasoning_effort: "low",
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "grades",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            grades: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { id: { type: "integer" }, grade: { type: "integer", enum: [0, 1, 2] } },
                required: ["id", "grade"],
              },
            },
          },
          required: ["grades"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content:
          "You grade movie search results. For each film, decide how well it matches the user's request, using the film profile and your own knowledge of the film. " +
          "2 = a good match for the whole request (a person would be happy with it). 1 = partially matches (fits some of the request, misses or contradicts part of it). " +
          "0 = not a match. Respect exclusions and specifics in the request (\"nothing violent\", \"no spaceships\", \"sad ending\"). Grade every film independently.",
      },
      {
        role: "user",
        content: `Request: "${query}"\n\n${films.map((f) => `### id ${f.id}\n${f.profile}`).join("\n\n")}`,
      },
    ],
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = await res.json();
    return JSON.parse(json.choices[0].message.content).grades;
  }
}

// lists: { pipelineName: [filmId, ...] } for one query. Grades any films not yet judged.
export async function judgeQuery(judgments, query, lists) {
  judgments[query] ??= {};
  const need = [...new Set(Object.values(lists).flat())].filter((id) => judgments[query][id] == null);
  for (let i = 0; i < need.length; i += 15) {
    const ids = need.slice(i, i + 15);
    const rows = await db.select({ id: schema.films.id, profile: schema.films.profile }).from(schema.films).where(inArray(schema.films.id, ids));
    for (const g of await grade(query, rows)) if (ids.includes(g.id)) judgments[query][g.id] = g.grade;
  }
  return Object.fromEntries(
    Object.entries(lists).map(([name, ids]) => {
      const gs = ids.slice(0, 10).map((id) => judgments[query][id] ?? 0);
      return [name, { score: gs.reduce((a, b) => a + b, 0) / (2 * gs.length), good: gs.filter((g) => g === 2).length, bad: gs.filter((g) => g === 0).length }];
    }),
  );
}
