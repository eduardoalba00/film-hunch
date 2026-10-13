// Overview, director, cast and backdrop for films on screen, fetched in one request per batch of
// new ids and kept for the session.

import { useEffect, useState } from "react";
import { apiUrl } from "./api.js";

const cache = new Map(); // film id → details
const pending = new Set();

export function useFilmDetails(ids) {
  const [, setVersion] = useState(0);
  const key = ids.join(",");

  useEffect(() => {
    const missing = ids.filter((id) => !cache.has(id) && !pending.has(id));
    if (!missing.length) return;
    let live = true;
    for (const id of missing) pending.add(id);
    fetch(apiUrl(`/api/films?ids=${missing.join(",")}`))
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        for (const row of rows) cache.set(row.id, row);
      })
      .catch(() => {})
      .finally(() => {
        for (const id of missing) pending.delete(id);
        if (live) setVersion((v) => v + 1);
      });
    return () => {
      live = false;
    };
  }, [key]);

  return (id) => cache.get(id);
}
