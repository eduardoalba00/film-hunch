// A poster or backdrop that fades in over a blurred tiny version of itself, so images never pop in.

import { useState } from "react";

const BASE = "https://image.tmdb.org/t/p/";

export function TmdbImage({ path, size = "w342", tiny = "w92", alt = "", className = "" }) {
  const [loaded, setLoaded] = useState(false);
  if (!path) return <div className={`img-empty ${className}`} aria-hidden="true" />;
  return (
    <div className={`img ${className}`}>
      <img className="img-tiny" src={`${BASE}${tiny}${path}`} alt="" aria-hidden="true" />
      <img
        className={`img-full${loaded ? " loaded" : ""}`}
        src={`${BASE}${size}${path}`}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
