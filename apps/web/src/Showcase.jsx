// The home page's poster wall: two rows of well-known posters drifting slowly in opposite directions,
// desaturated and faded at the edges, so the page reads as "film" before anyone types.

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { apiUrl } from "./api.js";

const IMG = "https://image.tmdb.org/t/p/w185";

function Row({ posters, reverse }) {
  // Two copies side by side, so the loop is seamless.
  const loop = [...posters, ...posters];
  return (
    <div className={`showcase-row${reverse ? " reverse" : ""}`}>
      {loop.map((p, i) => (
        <img key={`${p.id}-${i}`} src={`${IMG}${p.poster}`} alt="" decoding="async" />
      ))}
    </div>
  );
}

// `posters` skips the API (the landing page passes recorded ones).
export function Showcase({ posters: fixed }) {
  const [posters, setPosters] = useState(fixed ?? []);
  useEffect(() => {
    if (fixed) return;
    fetch(apiUrl("/api/showcase"))
      .then((r) => (r.ok ? r.json() : []))
      .then(setPosters)
      .catch(() => {});
  }, [fixed]);
  if (posters.length < 12) return <div className="showcase" aria-hidden="true" />;
  const half = Math.ceil(posters.length / 2);
  return (
    <motion.div
      className="showcase"
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5, duration: 1.6, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <Row posters={posters.slice(0, half)} />
      <Row posters={posters.slice(half)} reverse />
    </motion.div>
  );
}
