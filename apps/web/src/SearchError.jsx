// Why a search didn't run, in plain words, with a countdown when the visitor just needs to wait
// (rate limits, a busy moment) and a way to try again.

import { motion } from "motion/react";
import { useEffect, useState } from "react";

const TITLES = {
  rate_limited: "Slow down a little",
  busy: "One moment",
  paused: "Search is paused",
  budget: "That's all for today",
  failed: "That search didn't work",
};

const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function SearchError({ error, onRetry }) {
  const [left, setLeft] = useState(error.retryAfter ?? 0);
  useEffect(() => {
    setLeft(error.retryAfter ?? 0);
    if (!error.retryAfter) return;
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [error]);
  // Paused and budget are sitewide; retrying won't help until the notice clears.
  const canRetry = error.code !== "paused" && error.code !== "budget";
  return (
    <motion.div className="search-error" role="alert" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <h3>{TITLES[error.code] ?? TITLES.failed}</h3>
      <p>{error.message}</p>
      {canRetry && (
        <button type="button" className="button primary" disabled={left > 0} onClick={onRetry}>
          {left > 0 ? `Try again in ${clock(left)}` : "Try again"}
        </button>
      )}
    </motion.div>
  );
}
