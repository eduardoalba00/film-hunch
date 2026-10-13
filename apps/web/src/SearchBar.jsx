// The search box. On the home page it's a roomy single-line field with a round send button; after a
// search it collapses to a compact line in the top bar. While empty, the placeholder types out
// example requests. Enter searches, and "/" or ⌘K focuses it from anywhere.

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const TYPE_MS = 38;
const ERASE_MS = 16;
const HOLD_MS = 1800;

function useTypewriter(lines, active) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!active || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(lines[0]);
      return;
    }
    let line = 0, chars = 0, erasing = false, timer;
    const tick = () => {
      const full = lines[line];
      if (!erasing && chars < full.length) chars++;
      else if (!erasing) { erasing = true; timer = setTimeout(tick, HOLD_MS); return; }
      else if (chars > 0) chars--;
      else { erasing = false; line = (line + 1) % lines.length; }
      setText(full.slice(0, chars));
      timer = setTimeout(tick, erasing ? ERASE_MS : TYPE_MS);
    };
    tick();
    return () => clearTimeout(timer);
  }, [lines, active]);
  return text;
}

const ArrowUp = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></svg>
);

export function SearchBar({ value, onChange, onSubmit, examples, compact }) {
  const field = useRef(null);
  const [focused, setFocused] = useState(false);
  const placeholder = useTypewriter(examples, !value && !compact);
  const ready = value.trim().length > 0;
  const submit = () => { if (ready) { onSubmit(value); field.current?.blur(); } };

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
      if ((e.key === "/" && !typing) || (e.key === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        field.current?.focus();
        field.current?.select();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!compact) field.current?.focus();
  }, [compact]);
  if (compact) {
    return (
      <form className={`search-line${focused ? " focused" : ""}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          ref={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Describe another movie…"
          autoComplete="off"
          spellCheck="false"
          aria-label="Describe the movie you want"
        />
        <button type="submit" className={`send${ready ? " ready" : ""}`} disabled={!ready} aria-label="Search"><ArrowUp /></button>
      </form>
    );
  }

  return (
    <motion.form
      className={`composer${focused ? " focused" : ""}`}
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
    >
        <input
          ref={field}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck="false"
          enterKeyHint="search"
          aria-label="Describe the movie you want"
        />
        <button type="submit" className={`send${ready ? " ready" : ""}`} disabled={!ready} aria-label="Search"><ArrowUp /></button>
    </motion.form>
  );
}
