// The poster wall. Each grid slot crossfades to whichever film now ranks there as scores land, so the
// order updates live without cards flying around, and shimmering placeholders hold the space until
// enough films have arrived.

import { AnimatePresence, motion } from "motion/react";
import { TmdbImage } from "./Poster.jsx";
import { matchLabel } from "./ScoreBadge.jsx";

// The poster tilts a few degrees toward the cursor while a soft sheen follows it, like turning a
// print in the light. Set through CSS variables, so moving the mouse never re-renders the card.
const MAX_TILT = 7;
function tilt(e) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--ry", `${(x - 0.5) * 2 * MAX_TILT}deg`);
  el.style.setProperty("--rx", `${(0.5 - y) * 2 * MAX_TILT}deg`);
  el.style.setProperty("--mx", `${x * 100}%`);
  el.style.setProperty("--my", `${y * 100}%`);
}
function untilt(e) {
  const el = e.currentTarget;
  el.style.setProperty("--rx", "0deg");
  el.style.setProperty("--ry", "0deg");
}

const FADE = { duration: 0.45, ease: [0.4, 0, 0.2, 1] };

const metaOf = (film) =>
  [film.year, film.runtime ? `${film.runtime} min` : "", film.genres?.slice(0, 2).join(", ")].filter(Boolean).join(" · ");
// The card's short line: year and main genre.
const shortMeta = (film) => [film.year, film.genres?.[0]].filter(Boolean).join(" · ");
const pct = (score) => `${Math.round(score * 100)}%`;

function Card({ film, details, onOpen }) {
  return (
    <motion.button
      type="button"
      className="card"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={FADE}
      onClick={() => onOpen(film.id)}
      aria-label={`${film.title}, ${Math.round(film.score * 100)}% match`}
    >
      <div className="poster" onPointerMove={(e) => e.pointerType === "mouse" && tilt(e)} onPointerLeave={untilt}>
        <TmdbImage path={film.poster} alt="" />
        <div className="sheen" aria-hidden="true" />
        <div className="reveal">
          <span className="reveal-label">{matchLabel(film.score)}</span>
          {details?.overview && <p>{details.overview}</p>}
        </div>
      </div>
      <div className="card-text">
        <div className="title">{film.title}</div>
        <div className="card-meta">
          <span>{shortMeta(film)}</span>
          <span className={`score${film.score >= 0.85 ? " high" : ""}`}>{pct(film.score)}</span>
        </div>
      </div>
    </motion.button>
  );
}

function Skeleton({ index }) {
  return (
    <motion.div
      className="card skeleton"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: index * 0.02 } }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      aria-hidden="true"
    >
      <div className="poster shimmer" />
      <div className="line shimmer" />
      <div className="line short shimmer" />
    </motion.div>
  );
}

// Slots past `revealFrom` arrive by infinite scroll: they fade and rise in, a little staggered.
const REVEAL = { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

export function PosterGrid({ films, skeletons, detailsOf, onOpen, revealFrom = Infinity }) {
  return (
    <div className="grid">
      {/* Slots are keyed by rank, films by id: when a slot's film changes, the old card fades out
          underneath as the new one fades in, instead of the cards moving. */}
      {films.map((film, i) => (
        <motion.div
          className="slot"
          key={i}
          {...(i >= revealFrom ? REVEAL : {})}
          transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1], delay: i >= revealFrom ? ((i - revealFrom) % 15) * 0.035 : 0 }}
        >
          <AnimatePresence initial={false}>
            <Card key={film.id} film={film} details={detailsOf(film.id)} onOpen={onOpen} />
          </AnimatePresence>
        </motion.div>
      ))}
      <AnimatePresence>
        {Array.from({ length: skeletons }, (_, i) => (
          <Skeleton key={`skeleton-${i}`} index={i} />
        ))}
      </AnimatePresence>
    </div>
  );
}

export { metaOf };
