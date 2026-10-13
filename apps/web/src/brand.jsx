// Name and mark, in one place so they're easy to change.

import { motion } from "motion/react";

export const NAME = "FilmHunch";
export const TAGLINE = "Describe a movie. Any way you like.";
export const HEADLINE = "What do you feel like watching?";
export const REPO_URL = "https://github.com/eduardoalba00/film-hunch";

// A film frame with a spark in it: a movie, found by an idea. Monochrome; takes the text colour.
// Each new `twinkle` value makes the spark twinkle once (a search just finished).
export function Logo({ size = 28, twinkle = 0 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="currentColor" />
      <motion.path
        key={twinkle}
        d="M16 8.5c.6 3.9 3.6 6.9 7.5 7.5-3.9.6-6.9 3.6-7.5 7.5-.6-3.9-3.6-6.9-7.5-7.5 3.9-.6 6.9-3.6 7.5-7.5Z"
        style={{ fill: "var(--bg)", transformBox: "fill-box", transformOrigin: "center" }}
        initial={twinkle ? { scale: 1, rotate: 0 } : false}
        animate={twinkle ? { scale: [1, 1.35, 0.92, 1], rotate: [0, 60, 90, 90] } : {}}
        transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
      />
    </svg>
  );
}
