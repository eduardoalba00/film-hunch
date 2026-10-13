// Small text utilities for building film profiles.

export const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
export const words = (s) => s.split(/\s+/).filter(Boolean).length;

export const sentences = (s) =>
  s.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)?.map((x) => x.trim()).filter(Boolean) ?? [];

// Cuts text to about n words at a sentence boundary.
export function clip(s, n) {
  if (words(s) <= n) return s;
  let out = "";
  for (const sentence of sentences(s)) {
    if (out && words(out + " " + sentence) > n) break;
    out = out ? `${out} ${sentence}` : sentence;
  }
  // A single sentence longer than n words: cut it mid-way.
  return words(out) > n ? `${out.split(/\s+/).slice(0, n).join(" ")}…` : out;
}

// Keeps the opening and the ending of a long text within about n words, since endings answer a
// lot of questions ("sad ending", "the villain wins").
export function trimMiddle(s, n) {
  if (words(s) <= n) return s;
  const ss = sentences(s);
  const head = [];
  const tail = [];
  let budget = n;
  let i = 0;
  let j = ss.length - 1;
  while (i <= j && budget > 0) {
    const fromHead = head.length <= tail.length;
    const take = fromHead ? ss[i++] : ss[j--];
    budget -= words(take);
    (fromHead ? head : tail).push(take);
  }
  return `${head.join(" ")} […] ${tail.reverse().join(" ")}`;
}

// The last ~n words of a text, starting at a sentence boundary.
export function ending(s, n) {
  const ss = sentences(s);
  const out = [];
  let count = 0;
  for (let i = ss.length - 1; i >= 0; i--) {
    const w = words(ss[i]);
    if (out.length && count + w > n) break;
    out.unshift(ss[i]);
    count += w;
  }
  return clip(out.join(" "), n);
}

// Splits text into chunks of about n words at sentence boundaries.
export function chunk(s, n) {
  const parts = [];
  let cur = "";
  for (const sentence of sentences(s)) {
    if (cur && words(cur + " " + sentence) > n) {
      parts.push(cur);
      cur = "";
    }
    cur = cur ? `${cur} ${sentence}` : sentence;
  }
  if (cur) parts.push(cur);
  return parts;
}
