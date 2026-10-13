// Which TMDB entries count as real movies worth indexing.
// A film must pass every basic check and show at least one sign of notability. Rejections are
// kept with a reason so the rules can be tuned and films re-checked as they gain votes.

export const RULES = {
  minRuntime: 40, // the Academy's feature-length threshold
  minVotes: 20, // enough TMDB votes on their own
  minVotesWithImdb: 5, // fewer votes are fine with an IMDb id and a poster
};

// d: TMDB details. hasWiki: the film has an English Wikipedia article.
// Returns { status: 'indexed' | 'candidate' | 'rejected', reason }.
export function judge(d, { hasWiki = false } = {}) {
  if (!d) return { status: "rejected", reason: "gone from TMDB" };
  if (d.adult) return { status: "rejected", reason: "adult" };
  if (d.video) return { status: "rejected", reason: "video release" };
  if (d.status && d.status !== "Released") return { status: "candidate", reason: `not released (${d.status})` };
  if (!d.release_date) return { status: "candidate", reason: "no release date" };
  if (new Date(d.release_date) > new Date()) return { status: "candidate", reason: "release date in the future" };
  // Runtime is sometimes missing for real films; trust a Wikipedia article in that case.
  if (d.runtime ? d.runtime < RULES.minRuntime : !hasWiki) return { status: "rejected", reason: d.runtime ? "short film" : "no runtime" };
  if (!d.overview?.trim() && !hasWiki) return { status: "rejected", reason: "no description" };

  const votes = d.vote_count ?? 0;
  const notable =
    hasWiki ||
    votes >= RULES.minVotes ||
    (Boolean(d.imdb_id) && Boolean(d.poster_path) && votes >= RULES.minVotesWithImdb);
  // Not notable yet: keep as a candidate so a later check can promote it.
  if (!notable) return { status: "candidate", reason: "not notable yet" };
  return { status: "indexed", reason: null };
}
