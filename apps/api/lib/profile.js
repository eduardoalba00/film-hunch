// Turns TMDB details (+ an optional Wikipedia plot) into a film row: metadata, the compact card
// Jev reads in stage 1, the full profile it reads in stage 2, and the chunks that get embedded.

import { createHash } from "node:crypto";
import { clean, clip, ending, trimMiddle, chunk } from "./text.js";

const CARD_OVERVIEW_WORDS = 45;
const CARD_ENDING_WORDS = 40;
const PROFILE_PLOT_WORDS = 800;
const CHUNK_WORDS = 160;

export function buildFilm(d, plot = "") {
  plot = clean(plot);
  const year = d.release_date ? Number(d.release_date.slice(0, 4)) : null;
  const genres = (d.genres ?? []).map((g) => g.name);
  const keywords = (d.keywords?.keywords ?? []).map((k) => k.name);
  const director = (d.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name);
  const cast = (d.credits?.cast ?? []).slice(0, 5).map((c) => c.name);
  const overview = clean(d.overview);
  const countries = (d.production_countries ?? []).map((c) => c.iso_3166_1);

  const header = [
    `${d.title} (${year ?? "n.d."})`,
    genres.join(", "),
    d.runtime ? `${d.runtime} min` : "",
    director.length ? `dir. ${director.join(", ")}` : "",
    d.original_language && d.original_language !== "en" ? `language: ${d.original_language}` : "",
  ].filter(Boolean).join(" · ");

  // Stage-1 card, ~150 tokens: enough to judge mood, genre, premise and how it ends.
  const card = [
    header,
    keywords.length ? `Keywords: ${keywords.slice(0, 8).join(", ")}` : "",
    overview ? clip(overview, CARD_OVERVIEW_WORDS) : "",
    plot ? `Ending: ${ending(plot, CARD_ENDING_WORDS)}` : "",
  ].filter(Boolean).join("\n");

  // Stage-2 profile, ~1,100 tokens.
  const profile = [
    header,
    cast.length ? `Starring ${cast.join(", ")}` : "",
    keywords.length ? `Keywords: ${keywords.slice(0, 20).join(", ")}` : "",
    d.tagline ? `Tagline: ${clean(d.tagline)}` : "",
    overview ? `Overview: ${overview}` : "",
    plot ? `Plot: ${trimMiddle(plot, PROFILE_PLOT_WORDS)}` : "",
  ].filter(Boolean).join("\n");

  // Chunks for retrieval: the card itself, then the plot in pieces so odd details
  // ("set in a lighthouse", "told backwards") can match a film.
  const chunks = [{ kind: "card", text: card }];
  if (plot) for (const text of chunk(plot, CHUNK_WORDS)) chunks.push({ kind: "plot", text: `${d.title}: ${text}` });

  return {
    id: d.id,
    imdbId: d.imdb_id || null,
    wikidataId: d.external_ids?.wikidata_id || null,
    title: d.title,
    originalTitle: d.original_title,
    year,
    releaseDate: d.release_date || null,
    runtime: d.runtime || null,
    language: d.original_language || null,
    countries,
    genres,
    keywords,
    director,
    castNames: cast,
    overview,
    tagline: clean(d.tagline) || null,
    poster: d.poster_path || null,
    backdrop: d.backdrop_path || null,
    votes: d.vote_count ?? 0,
    rating: d.vote_average ?? null,
    popularity: d.popularity ?? null,
    hasPlot: Boolean(plot),
    card,
    profile,
    chunks,
    textHash: createHash("sha1").update(card + "\n" + profile).digest("hex"),
  };
}

// The card Jev reads in its first pass, trimmed for cost: title, year and genres; 6 keywords; the
// overview to 30 words; the last 25 words of the plot. Derived from the stored card so the stored
// text (and its embeddings) never change. Scored as well as the full card in testing.
const firstWords = (s, n) => { const w = s.split(/\s+/); return w.length <= n ? s : w.slice(0, n).join(" ") + "…"; };
const lastWords = (s, n) => { const w = s.split(/\s+/); return w.length <= n ? s : "…" + w.slice(-n).join(" "); };
export function slimCard(card) {
  const lines = card.split("\n");
  const head = lines[0].split(" · ").filter((p) => !/^\d+ min$|^dir\. /.test(p)).join(" · ");
  const keywords = lines.find((l) => l.startsWith("Keywords: "));
  const ending = lines.find((l) => l.startsWith("Ending: "));
  const overview = lines.slice(1).find((l) => l !== keywords && l !== ending);
  return [
    head,
    keywords ? "Keywords: " + keywords.slice(10).split(", ").slice(0, 6).join(", ") : "",
    overview ? firstWords(overview, 30) : "",
    ending ? "Ending: " + lastWords(ending.slice(8), 25) : "",
  ].filter(Boolean).join("\n");
}
