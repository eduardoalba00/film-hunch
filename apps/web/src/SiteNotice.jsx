// A thin banner across the top of every page when search is paused sitewide: an AI provider ran
// out of credit, or today's search budget is spent. Checked on load and every minute while visible.

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { apiUrl } from "./api.js";

export function useSiteNotice(refreshKey) {
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    let live = true;
    const check = () =>
      fetch(apiUrl("/api/status"))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => live && d && setNotice(d.notice))
        .catch(() => {});
    // Only while the tab is visible: each check reads the database, and a tab left open in the
    // background would otherwise keep a serverless database from ever suspending.
    let timer = 0;
    const sync = () => {
      clearInterval(timer);
      timer = 0;
      if (document.visibilityState !== "visible") return;
      check();
      timer = setInterval(check, 60_000);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { live = false; clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, [refreshKey]);
  return notice;
}

const TITLES = { paused: "Search is paused", budget: "That's all for today" };

export function SiteNotice({ notice }) {
  return (
    <AnimatePresence>
      {notice && (
        <motion.div
          className="site-notice"
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div className="site-notice-inner">
            <span className="site-notice-dot" aria-hidden="true" />
            <strong>{notice.title ?? TITLES[notice.kind] ?? "Heads up"}</strong>
            <span className="site-notice-text">{notice.message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
