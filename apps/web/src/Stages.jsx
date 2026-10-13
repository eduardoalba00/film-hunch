// What the search is doing, as steps that tick off: the wait is when the product shows its work.

import { AnimatePresence, motion } from "motion/react";
import { REFINE } from "./useSearch.js";

const ORDER = ["starting", "reading", "refining", "done"];

function Step({ state, children }) {
  return (
    <motion.li className={`step ${state}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      <span className="step-dot" aria-hidden="true">
        {state === "done" ? (
          <svg viewBox="0 0 16 16"><path d="m4 8.5 2.5 2.5L12 5.5" /></svg>
        ) : state === "active" ? (
          <span className="spinner" />
        ) : null}
      </span>
      <span>{children}</span>
    </motion.li>
  );
}

export function Stages({ search }) {
  const { phase, total, complete, read, refined, done, error } = search;
  if (phase === "idle") return null;
  if (error) return null; // shown by SearchError
  const at = ORDER.indexOf(phase);
  const state = (i) => (at > i ? "done" : at === i ? "active" : "waiting");

  return (
    <div className="stages" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        {phase === "done" ? (
          <motion.p key="summary" className="stages-summary" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {done.cached
              ? "Instant · from a recent search"
              : `Read ${total.toLocaleString()} films · ${(done.ms / 1000).toFixed(1)}s`}
          </motion.p>
        ) : (
          <motion.ol key="steps" className="steps" exit={{ opacity: 0, y: -4 }}>
            <Step state={state(0)}>Understanding your request</Step>
            <Step state={state(1)}>
              Reading {total ? <><b>{read.toLocaleString()}</b> / {total.toLocaleString()}</> : ""} films
              {phase === "reading" && !complete && read >= total ? " · finding lesser-known ones" : null}
            </Step>
            <Step state={state(2)}>
              Taking a closer look at the top {REFINE}{phase === "refining" ? <> · <b>{refined}</b> / {REFINE}</> : null}
            </Step>
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}
