// Match score: a ring and a percentage that count up (and re-settle) as Jev's scores land.

import { motion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

const RADIUS = 6;
const RING = 2 * Math.PI * RADIUS;

export const matchLabel = (score) => (score >= 0.85 ? "Great match" : score >= 0.7 ? "Good match" : "Partial match");

export function ScoreBadge({ score, large = false }) {
  const value = useSpring(0, { stiffness: 120, damping: 20 });
  useEffect(() => value.set(score), [score, value]);
  const pct = useTransform(value, (v) => `${Math.round(v * 100)}%`);
  const dash = useTransform(value, (v) => `${RING * v} ${RING}`);
  return (
    <div className={`badge${large ? " large" : ""}${score >= 0.85 ? " high" : ""}`} aria-label={`${Math.round(score * 100)}% match`}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <circle className="track" cx="8" cy="8" r={RADIUS} />
        <motion.circle className="fill" cx="8" cy="8" r={RADIUS} style={{ strokeDasharray: dash }} />
      </svg>
      <motion.span>{pct}</motion.span>
    </div>
  );
}
