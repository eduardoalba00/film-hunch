// A quiet note in the footer: what FilmHunch has cost to run so far. Opening it shows the breakdown
// and makes clear visitors are never charged; it's the cost of keeping the site up.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { apiUrl } from "./api.js";

const usd = (n) => (n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const LINES = [
  ["search", "Search ranking (Jev)"],
  ["embeddings", "Understanding requests and new films (OpenAI)"],
  ["catalog", "Building the film catalog (one-time)"],
  ["hosting", "Hosting and database"],
];

export function CostBadge() {
  const [costs, setCosts] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    fetch(apiUrl("/api/costs"))
      .then((r) => (r.ok ? r.json() : null))
      .then(setCosts)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    addEventListener("pointerdown", onDown);
    addEventListener("keydown", onKey);
    return () => { removeEventListener("pointerdown", onDown); removeEventListener("keydown", onKey); };
  }, [open]);

  if (!costs) return null;
  const since = new Date(`${costs.since}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return (
    <span className="cost" ref={box}>
      <button type="button" className="cost-badge" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="cost-dot" aria-hidden="true" />
        {usd(costs.total)} to run FilmHunch so far
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="cost-pop"
            role="dialog"
            aria-label="What FilmHunch costs to run"
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
          >
            <p className="cost-lead">
              Searching is free for you. This is what it has cost to keep FilmHunch running since {since}.
            </p>
            <dl>
              {LINES.filter(([key]) => costs.breakdown[key] > 0).map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{usd(costs.breakdown[key])}</dd>
                </div>
              ))}
              <div className="cost-total">
                <dt>Total · {costs.searches.toLocaleString()} searches</dt>
                <dd>{usd(costs.total)}</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
