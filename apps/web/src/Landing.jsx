// The page shown instead of the app when it's built with VITE_LANDING=1: the app, replaying real
// searches recorded by scripts/record-demo.mjs (no API or database), under a banner saying
// FilmHunch is open source now. It types a request, runs it, holds the results, then types the next.

import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { HEADLINE, Logo, NAME, REPO_URL } from "./brand.jsx";
import { DetailSheet } from "./DetailSheet.jsx";
import { PosterGrid } from "./PosterGrid.jsx";
import { SearchBar } from "./SearchBar.jsx";
import { SiteNotice } from "./SiteNotice.jsx";
import { Spotlight } from "./Spotlight.jsx";
import { Stages } from "./Stages.jsx";
import { applyEvent, emptySearch, progressOf, summarize } from "./useSearch.js";
import { Showcase } from "./Showcase.jsx";
import DEMO from "./demo.json";

const SEARCHES = DEMO.searches;
const DETAILS = new Map(SEARCHES.flatMap((s) => s.details.map((d) => [d.id, d])));
const SLOW = 1.5; // replayed a little slower than they ran, so each step can be read
const HOLD_MS = 9000; // how long results stay before the next request
const EASE = [0.2, 0.8, 0.2, 1];
const NO_EXAMPLES = [""];
const ignore = () => {};
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const NOTICE = {
  kind: "open",
  title: `${NAME} is open source now`,
  message: (
    <>
      The hosted site has closed, so these are replays of real searches.{" "}
      <a href={REPO_URL}>Get the code on GitHub</a> to run it yourself.
    </>
  ),
};

// Plays a recorded search into the same state useSearch builds from the live stream.
function useReplay(recording) {
  const data = useRef(emptySearch());
  const [, setVersion] = useState(0);
  useEffect(() => {
    data.current = emptySearch();
    setVersion((v) => v + 1);
    if (!recording) return;
    const d = data.current;
    const timers = recording.stream.map(({ t, event, data: payload }) =>
      setTimeout(() => { applyEvent(d, event, payload); setVersion((v) => v + 1); }, 400 + t * SLOW),
    );
    return () => timers.forEach(clearTimeout);
  }, [recording]);
  return summarize(recording?.query ?? "", data.current);
}

export function Landing() {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(null);
  const [openId, setOpenId] = useState(null);
  const search = useReplay(recording);
  const { phase, ranked } = search;
  const query = recording?.query ?? "";

  // Types the next request into the search bar, then runs it.
  useEffect(() => {
    const next = SEARCHES[index];
    if (reducedMotion()) {
      setText(next.query);
      setRecording(next);
      return;
    }
    let n = 0, timer;
    const tick = () => {
      setText(next.query.slice(0, ++n));
      timer = n < next.query.length ? setTimeout(tick, 35 + Math.random() * 45) : setTimeout(() => setRecording(next), 600);
    };
    timer = setTimeout(() => { setText(""); timer = setTimeout(tick, 400); }, index === 0 && !recording ? 1000 : 0);
    return () => clearTimeout(timer);
  }, [index]);

  // Results stay up for a while (and while a film is open), then the next request starts.
  const done = phase === "done";
  useEffect(() => {
    if (!done || openId) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % SEARCHES.length), HOLD_MS);
    return () => clearTimeout(timer);
  }, [done, openId, recording]);

  const [twinkle, setTwinkle] = useState(0);
  useEffect(() => {
    if (done) setTwinkle((t) => t + 1);
  }, [done, recording]);

  const busy = phase === "starting" || phase === "reading" || phase === "refining";
  const best = done ? ranked[0] : null;
  const grid = ranked.slice(best ? 1 : 0, best ? 31 : 30);
  const detailsOf = (id) => (done || id === openId ? DETAILS.get(id) : undefined);
  const openFilm = openId ? ranked.find((f) => f.id === openId) : null;
  const close = useCallback(() => setOpenId(null), []);

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className={`app ${query ? "searched" : "idle"}`}>
          <SiteNotice notice={NOTICE} />
          <header className={`topbar${query ? " active" : ""}`}>
            <span className="brand"><Logo size={20} twinkle={query ? twinkle : 0} /><span>{NAME}</span></span>
            {query && <SearchBar value={text} onChange={ignore} onSubmit={ignore} examples={NO_EXAMPLES} compact />}
            {query && (
              <div className="topbar-progress" aria-hidden="true">
                <motion.i
                  animate={{ scaleX: progressOf(search), opacity: busy ? 1 : 0 }}
                  transition={{ scaleX: { type: "spring", stiffness: 70, damping: 20 }, opacity: { duration: 0.6, delay: busy ? 0 : 0.3 } }}
                />
              </div>
            )}
          </header>

          {!query ? (
            <section className="hero">
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
              <SearchBar value={text} onChange={ignore} onSubmit={ignore} examples={NO_EXAMPLES} />
            </section>
          ) : null}
          {!query && <Showcase posters={DEMO.showcase} />}
          {query && (
            <main className="results">
              <motion.header className="results-head" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
                <h2>“{query}”</h2>
                <Stages search={search} />
              </motion.header>
              <AnimatePresence>{best && <Spotlight key={best.id} film={best} details={detailsOf(best.id)} onOpen={setOpenId} />}</AnimatePresence>
              {best && grid.length > 0 && <h3 className="section-title">More like it</h3>}
              <PosterGrid key={query} films={grid} skeletons={busy ? Math.max(0, 12 - grid.length) : 0} detailsOf={detailsOf} onOpen={setOpenId} />
            </main>
          )}

          <footer>
            <span className="footer-left"><span>{NAME} · Ranked by Jev</span></span>
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
