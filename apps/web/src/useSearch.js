// Streams a search from /api/search and keeps the scores as they land. Scores arrive in hundreds of
// small batches, so they're collected in a ref and the component re-renders at most once a frame.

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "./api.js";

const SHOWN = 0.4; // films scoring below this are never shown
export const REFINE = 40; // films the server re-scores on full profiles

export const emptySearch = () => ({ total: 0, complete: false, read: 0, s1: new Map(), s2: new Map(), cards: new Map(), done1: false, done: null, error: null });

// Folds one event from /api/search into the search state. Shared with the landing page, which
// replays recorded events (a recorded "scores" event carries `read`: how many films it scored).
export function applyEvent(d, event, data) {
  if (event === "total") {
    // complete is false until the less-known films are found (a cached search sends no flag).
    d.total = data.films;
    d.complete = data.complete ?? true;
  } else if (event === "scores") {
    // Details arrive only for films scoring high enough to be shown.
    const { stage, scores, cards } = data;
    for (const c of cards) d.cards.set(c.id, c);
    for (const [id, s] of scores) (stage === 1 ? d.s1 : d.s2).set(id, s);
    if (stage === 1) d.read += data.read ?? scores.length;
    if (stage === 2) d.done1 = true;
  } else if (event === "done") {
    d.done = data;
    d.done1 = true;
  }
}

// Where the search is: idle → starting → reading (first pass) → refining (full profiles) → done | error.
function phaseOf(query, d) {
  if (!query) return "idle";
  if (d.error) return "error";
  if (d.done) return "done";
  if (d.done1) return "refining";
  return d.total ? "reading" : "starting";
}

// `attempt` changes when the same request is run again (e.g. after a rate limit runs out).
export function useSearch(query, attempt = 0) {
  const data = useRef(emptySearch());
  const [, setVersion] = useState(0);

  useEffect(() => {
    data.current = emptySearch();
    setVersion((v) => v + 1);
    if (!query) return;

    let frame = 0;
    const update = () => {
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; setVersion((v) => v + 1); });
    };
    const d = data.current;
    const source = new EventSource(apiUrl(`/api/search?q=${encodeURIComponent(query)}`));
    for (const event of ["total", "scores", "done"]) {
      source.addEventListener(event, (e) => {
        applyEvent(d, event, JSON.parse(e.data));
        if (event === "done") source.close();
        update();
      });
    }
    source.addEventListener("error", (e) => {
      // { code, message, retryAfter? } from the API, or a dropped connection.
      if (e.data) d.error = JSON.parse(e.data);
      else if (!d.done) d.error = { code: "failed", message: "The connection dropped. Try again." };
      source.close();
      update();
    });
    return () => {
      source.close();
      cancelAnimationFrame(frame);
    };
  }, [query, attempt]);

  return summarize(query, data.current);
}

// How far along a search is, 0..1, for the progress line under the top bar.
export function progressOf(s) {
  if (s.phase === "done" || s.phase === "error") return 1;
  if (s.phase === "refining") return 0.85 + 0.15 * (s.refined / REFINE);
  if (s.phase === "reading") return 0.05 + 0.8 * (s.read / s.total);
  return s.phase === "starting" ? 0.04 : 0;
}

// What the page shows for a search state: its phase, progress, and the films ranked so far.
export function summarize(query, d) {
  // Current best score for a film: stage 2 once it has one, otherwise stage 1.
  const scoreOf = (id) => d.s2.get(id) ?? d.s1.get(id) ?? 0;
  // Films Jev has scored that look at least partly relevant. Once the closer look starts, films it
  // re-scored come first.
  const ranked = [...d.cards.keys()]
    .filter((id) => (d.s1.has(id) || d.s2.has(id)) && scoreOf(id) >= SHOWN)
    .sort((a, b) => (d.s2.has(b) - d.s2.has(a)) * (d.done1 ? 1 : 0) || scoreOf(b) - scoreOf(a))
    .map((id) => ({ ...d.cards.get(id), score: scoreOf(id), refined: d.s2.has(id) }));
  return {
    phase: phaseOf(query, d),
    ranked,
    total: d.total,
    complete: d.complete,
    read: d.read,
    refined: Math.min(d.s2.size, REFINE),
    done: d.done,
    error: d.error,
  };
}
