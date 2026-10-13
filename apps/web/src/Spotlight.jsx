// The best match, shown wide: its backdrop, who made it, how well it fits, and what it's about.

import { motion } from "motion/react";
import { TmdbImage } from "./Poster.jsx";
import { ScoreBadge, matchLabel } from "./ScoreBadge.jsx";
import { metaOf } from "./PosterGrid.jsx";

export function Spotlight({ film, details, onOpen }) {
  const director = details?.director?.slice(0, 2).join(" & ");
  return (
    <motion.section
      className="spotlight"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label={`Best match: ${film.title}`}
    >
      <div className="spotlight-backdrop" aria-hidden="true">
        {details?.backdrop ? (
          <TmdbImage path={details.backdrop} size="w1280" tiny="w300" />
        ) : (
          // No backdrop: a heavily blurred poster gives the colour without a bad crop.
          <TmdbImage path={film.poster} size="w342" className="blurred" />
        )}
      </div>
      <div className="spotlight-body">
        <TmdbImage path={film.poster} className="spotlight-poster" alt={`${film.title} poster`} />
        <div className="spotlight-text">
          <span className="eyebrow">Best match · {matchLabel(film.score)}</span>
          <h2>{film.title}</h2>
          <p className="meta">
            {metaOf(film)}
            {director ? ` · ${director}` : ""}
          </p>
          {details?.overview ? <p className="overview">{details.overview}</p> : <p className="overview placeholder shimmer" />}
          <div className="spotlight-actions">
            <ScoreBadge score={film.score} large />
            <button type="button" className="button primary" onClick={() => onOpen(film.id)}>
              More about this film
            </button>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
