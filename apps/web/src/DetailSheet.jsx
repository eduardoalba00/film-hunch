// A film's details in a panel that rises over the results. Esc, the close button or a click outside
// closes it.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { TmdbImage } from "./Poster.jsx";
import { ScoreBadge, matchLabel } from "./ScoreBadge.jsx";

function Body({ film, details, onClose }) {
  const close = useRef(null);
  useEffect(() => {
    close.current?.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = details ?? {};
  const facts = [
    film.year,
    film.runtime ? `${Math.floor(film.runtime / 60)}h ${film.runtime % 60}m` : "",
    film.genres?.join(", "),
    d.rating ? `★ ${d.rating.toFixed(1)}` : "",
  ].filter(Boolean);
  return (
    <motion.div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-label={film.title}
      initial={{ y: 40, opacity: 0, scale: 0.98 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 30, opacity: 0, scale: 0.98, transition: { duration: 0.18 } }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="sheet-backdrop" aria-hidden="true">
        <TmdbImage path={d.backdrop ?? film.poster} size={d.backdrop ? "w1280" : "w780"} tiny={d.backdrop ? "w300" : "w92"} />
      </div>
      <button ref={close} type="button" className="sheet-close" onClick={onClose} aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
      <div className="sheet-body">
        <TmdbImage path={film.poster} className="sheet-poster" alt={`${film.title} poster`} />
        <div className="sheet-text">
          <span className="eyebrow">{matchLabel(film.score)}</span>
          <h2>{film.title}</h2>
          <p className="meta">{facts.join(" · ")}</p>
          {d.tagline && <p className="tagline">“{d.tagline}”</p>}
          {d.overview ? <p className="overview">{d.overview}</p> : <p className="overview placeholder shimmer" />}
          <dl className="people">
            {d.director?.length > 0 && (<><dt>Director</dt><dd>{d.director.join(", ")}</dd></>)}
            {d.cast?.length > 0 && (<><dt>Cast</dt><dd>{d.cast.join(", ")}</dd></>)}
          </dl>
          <div className="sheet-actions">
            <ScoreBadge score={film.score} large />
            <a className="button" href={`https://www.themoviedb.org/movie/${film.id}`} target="_blank" rel="noopener">TMDB</a>
            {d.imdbId && <a className="button" href={`https://www.imdb.com/title/${d.imdbId}/`} target="_blank" rel="noopener">IMDb</a>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function DetailSheet({ film, details, onClose }) {
  useEffect(() => {
    document.body.classList.toggle("locked", Boolean(film));
  }, [film]);
  return (
    <AnimatePresence>
      {film && (
        <motion.div
          key="overlay"
          className="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <Body film={film} details={details} onClose={onClose} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
