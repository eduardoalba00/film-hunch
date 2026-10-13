import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HEADLINE, Logo, NAME } from "./brand.jsx";
import { CatalogPill } from "./CatalogPill.jsx";
import { CostBadge } from "./CostBadge.jsx";
import { DetailSheet } from "./DetailSheet.jsx";
import { PosterGrid } from "./PosterGrid.jsx";
import { SearchBar } from "./SearchBar.jsx";
import { Spotlight } from "./Spotlight.jsx";
import { SearchError } from "./SearchError.jsx";
import { SiteNotice, useSiteNotice } from "./SiteNotice.jsx";
import { Stages } from "./Stages.jsx";
import { Showcase } from "./Showcase.jsx";
import { Suggestions } from "./Suggestions.jsx";
import { useFilmDetails } from "./useFilmDetails.js";
import { progressOf, useSearch } from "./useSearch.js";

const EXAMPLES = [
  "beautifully sad, the kind you think about for days",
  "Inception, but slower and sadder",
  "a heist so clever nobody ever finds out",
  "unsettling in a quiet way, no jump scares",
  "Alien, but on a submarine",
  "a seaside town hiding a secret",
  "the villain wins, and it's earned",
];
const SHOW = 30; // films shown at first
const MORE = 15; // added each time the end of the grid comes into view
const MAX = 60; // most a search shows (cached searches keep their top 60)
const EASE = [0.2, 0.8, 0.2, 1];
const SKELETONS = 12;

const initialQuery = () => new URLSearchParams(location.search).get("q")?.trim() ?? "";

export function App() {
  const [text, setText] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [openId, setOpenId] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const search = useSearch(query, attempt);
  // A search refused for a sitewide reason refreshes the banner straight away.
  const sitewide = search.error && (search.error.code === "paused" || search.error.code === "budget") ? search.error.code : "";
  const notice = useSiteNotice(sitewide);
  const { phase, ranked } = search;

  const run = (q) => {
    q = q.trim();
    if (!q) return;
    setText(q);
    setQuery(q);
    setAttempt((a) => a + 1);
    setOpenId(null);
    history.replaceState(null, "", `?q=${encodeURIComponent(q)}`);
    scrollTo({ top: 0, behavior: "smooth" });
  };
  const reset = () => {
    setText("");
    setQuery("");
    setOpenId(null);
    history.replaceState(null, "", location.pathname);
  };

  const done = phase === "done";
  const best = done ? ranked[0] : null;
  // Infinite scroll: more films appear as the end of the grid comes into view, once results settle.
  const [shown, setShown] = useState(SHOW);
  useEffect(() => setShown(SHOW), [query, attempt]);
  const start = best ? 1 : 0;
  const grid = ranked.slice(start, Math.min(start + shown, MAX));
  const hasMore = done && ranked.length > start + shown && start + shown < MAX;
  const end = useRef(null);
  useEffect(() => {
    if (!hasMore || !end.current) return;
    const observer = new IntersectionObserver((entries) => entries[0].isIntersecting && setShown((n) => n + MORE), { rootMargin: "600px 0px" });
    observer.observe(end.current);
    return () => observer.disconnect();
  }, [hasMore, shown]);

  const busy = phase === "starting" || phase === "reading" || phase === "refining";
  // The tab says what's happening: searching, then the request itself.
  useEffect(() => {
    document.title = !query ? `${NAME} · Describe a movie, any way you like` : busy ? `Searching… · ${NAME}` : `“${query}” · ${NAME}`;
  }, [query, busy]);
  const skeletons = busy ? Math.max(0, SKELETONS - grid.length) : 0;

  // Details (overview, people, backdrop) for what's on screen once the order has settled.
  const detailsOf = useFilmDetails([...(done ? ranked.slice(0, start + grid.length).map((f) => f.id) : []), ...(openId ? [openId] : [])]);
  const openFilm = openId ? ranked.find((f) => f.id === openId) : null;
  const close = useCallback(() => setOpenId(null), []);

  // The logo's spark twinkles once each time a search finishes.
  const [twinkle, setTwinkle] = useState(0);
  useEffect(() => {
    if (done) setTwinkle((t) => t + 1);
  }, [done, query, attempt]);

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className={`app ${query ? "searched" : "idle"}`}>
          <SiteNotice notice={notice} />
          <header className={`topbar${query ? " active" : ""}`}>
            <button type="button" className="brand" onClick={reset} aria-label={`${NAME} home`}>
              <Logo size={20} twinkle={query ? twinkle : 0} />
              <span>{NAME}</span>
            </button>
            {query && (
              <SearchBar value={text} onChange={setText} onSubmit={run} examples={EXAMPLES} compact />
            )}
            {query && (
              <div className="topbar-progress" aria-hidden="true">
                <motion.i
                  animate={{ scaleX: progressOf(search), opacity: busy ? 1 : 0 }}
                  transition={{ scaleX: { type: "spring", stiffness: 70, damping: 20 }, opacity: { duration: 0.6, delay: busy ? 0 : 0.3 } }}
                />
              </div>
            )}
          </header>
          {!query && (
            <>
            <section className="hero">
              <CatalogPill />
              <h1 aria-label={HEADLINE}>
                {HEADLINE.split(" ").map((word, i) => (
                  <motion.span
                    key={i}
                    aria-hidden="true"
                    style={{ "--i": i }}
                    initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ delay: 0.06 * i, duration: 0.8, ease: EASE }}
                  >
                    {word}{" "}
                  </motion.span>
                ))}
              </h1>
              <motion.p className="lede" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.8, ease: EASE }}>
                Describe a mood, a plot, or a film it's like.
              </motion.p>
              <SearchBar value={text} onChange={setText} onSubmit={run} examples={EXAMPLES} />
              <Suggestions onPick={run} />
            </section>
            <Showcase />
            </>
          )}

          {query && (
            <main className="results">
              <motion.header className="results-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
                <h2>“{query}”</h2>
                <Stages search={search} />
              </motion.header>
              <AnimatePresence>{best && <Spotlight key={best.id} film={best} details={detailsOf(best.id)} onOpen={setOpenId} />}</AnimatePresence>
              {search.error ? (
                <SearchError error={search.error} onRetry={() => setAttempt((a) => a + 1)} />
              ) : done && !ranked.length ? (
                <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <h3>Nothing fits that well</h3>
                  <p>Try describing it differently: a mood, a setting, how it ends, or a film it's like.</p>
                </motion.div>
              ) : (
                <>
                  {best && grid.length > 0 && <h3 className="section-title">More like it</h3>}
                  <PosterGrid key={query} films={grid} skeletons={skeletons} detailsOf={detailsOf} onOpen={setOpenId} revealFrom={SHOW} />
                  {hasMore && <div ref={end} className="grid-end" aria-hidden="true" />}
                </>
              )}
            </main>
          )}

          <footer>
            <span className="footer-left">
              <span>{NAME} · Ranked by Jev</span>
              <CostBadge />
            </span>
            <span title="This product uses the TMDB API but is not endorsed or certified by TMDB.">
              Film data from <a href="https://www.themoviedb.org/" rel="noopener"><img src="/tmdb.svg" alt="TMDB" /></a>, not endorsed by TMDB · Plots from{" "}
              <a href="https://en.wikipedia.org/" rel="noopener">Wikipedia</a> (CC BY-SA)
            </span>
          </footer>
        </div>
        <DetailSheet film={openFilm} details={openId ? detailsOf(openId) : null} onClose={close} />
      </LayoutGroup>
    </MotionConfig>
  );
}
