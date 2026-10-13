// Example requests under the home search, grouped in tabs. They double as a guide to the kinds of
// things people can ask.

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

export const SUGGESTIONS = {
  Moods: [
    "beautifully sad, the kind you think about for days",
    "cozy enough for a rainy Sunday, nothing violent",
    "unsettling in a quiet way, no jump scares",
    "lonely and neon-lit, in a city that never sleeps",
  ],
  Plots: [
    "a heist so clever nobody ever finds out",
    "the villain wins, and it's earned",
    "a twist that changes everything before it",
    "revenge that costs more than it's worth",
  ],
  "Like a film": [
    "Inception, but slower and sadder",
    "Alien, but on a submarine",
    "Knives Out, but on a snowed-in train",
    "Before Sunrise, but in Tokyo",
  ],
  Settings: [
    "the whole story happens in one night",
    "almost entirely inside one room",
    "stranded somewhere frozen and remote",
    "a seaside town hiding a secret",
  ],
};

// Each tab's dot takes one colour from the brand palette; Settings gets the whole gradient.
const TAB_COLOURS = {
  Moods: "#f6c38b",
  Plots: "#f0a3b7",
  "Like a film": "#b9a6f5",
  Settings: "linear-gradient(135deg, #f6c38b, #f0a3b7, #b9a6f5)",
};

const Arrow = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v7a4 4 0 0 0 4 4h10M15 11l4 4-4 4" /></svg>
);

export function Suggestions({ onPick }) {
  const tabs = Object.keys(SUGGESTIONS);
  const [tab, setTab] = useState(tabs[0]);
  return (
    <motion.div className="suggestions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7, duration: 0.8 }}>
      {/* The gradient the suggestion arrows take on hover (referenced from CSS). */}
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
        <linearGradient id="fh-gradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6c38b" />
          <stop offset="0.55" stopColor="#f0a3b7" />
          <stop offset="1" stopColor="#b9a6f5" />
        </linearGradient>
      </svg>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={t === tab} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>
            {t === tab && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
            <span className="tab-label">
              <i className="tab-dot" style={{ background: TAB_COLOURS[t] }} aria-hidden="true" />
              {t}
            </span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.ul
          key={tab}
          className="suggestion-list"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.18 }}
        >
          {SUGGESTIONS[tab].map((q) => (
            <li key={q}>
              <button type="button" onClick={() => onPick(q)}>
                <Arrow />
                <span>{q}</span>
              </button>
            </li>
          ))}
        </motion.ul>
      </AnimatePresence>
    </motion.div>
  );
}
