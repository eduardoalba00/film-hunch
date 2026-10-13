// A small pill above the home headline: how many films FilmHunch searches, with a dot in the brand
// colours. Hidden until the count arrives, so it never shows a placeholder.

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { apiUrl } from "./api.js";

export function CatalogPill() {
  const [films, setFilms] = useState(null);
  useEffect(() => {
    fetch(apiUrl("/api/stats"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.films && setFilms(d.films))
      .catch(() => {});
  }, []);
  return (
    <div className="pill-slot">
      {films && (
        <motion.div className="pill" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}>
          <span className="pill-dot" aria-hidden="true" />
          {films.toLocaleString()} films · updated daily
        </motion.div>
      )}
    </div>
  );
}
