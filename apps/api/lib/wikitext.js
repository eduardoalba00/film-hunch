// Converts the plot section of an article's wikitext to plain text.
// Handles what film plot sections actually contain: links, references, templates, emphasis,
// HTML tags, comments and sub-headings. Templates are dropped, except a few that wrap prose.

import { clean } from "./text.js";

const PLOT_HEADINGS = /^(plot|plot summary|synopsis|premise|story|storyline|summary)$/i;

// Templates whose text belongs in the prose: {{lang|fr|text}}, {{nihongo|English|日本語|...}}, etc.
function keepTemplate(body) {
  const parts = body.split("|").map((p) => p.trim());
  const name = parts[0].toLowerCase();
  if (name === "lang" || name.startsWith("lang-")) return parts.at(-1);
  if (name === "nihongo" || name === "nihongo2") return parts[1] ?? "";
  if (name === "'" || name === "' \"" || name === "\" '") return "'";
  if (name === "sic") return parts.slice(1).filter((p) => !p.includes("=")).join(" ");
  if (name === "nowrap" || name === "nobr" || name === "small" || name === "abbr" || name === "em" || name === "i") return parts[1] ?? "";
  if (name === "ill" || name === "interlanguage link") return parts[1] ?? "";
  if (name === "convert" || name === "cvt") return `${parts[1] ?? ""} ${parts[2] ?? ""}`;
  if (name === "us$" || name === "usd") return `US$${parts[1] ?? ""}`;
  return "";
}

function stripTemplates(s) {
  // Innermost first, until none remain (templates nest).
  for (let i = 0; i < 20 && s.includes("{{"); i++) {
    const next = s.replace(/\{\{([^{}]*)\}\}/g, (_, body) => keepTemplate(body));
    if (next === s) break;
    s = next;
  }
  return s.replace(/\{\{|\}\}/g, "");
}

function stripLinks(s) {
  // Files and categories go entirely (their captions can contain nested links).
  for (let i = 0; i < 10; i++) {
    const next = s.replace(/\[\[(?:File|Image|Category):(?:[^[\]]|\[\[[^[\]]*\]\])*\]\]/gi, "");
    if (next === s) break;
    s = next;
  }
  return s
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1") // [[target|text]] → text, [[text]] → text
    .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]*)\]/g, "$1") // [http://x text] → text
    .replace(/\[(?:https?:)?\/\/[^\s\]]+\]/g, "");
}

export function wikitextToText(s) {
  s = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
    .replace(/\{\|[\s\S]*?\|\}/g, ""); // tables
  s = stripTemplates(s);
  s = stripLinks(s);
  s = s
    .replace(/^=+[^=\n]+=+\s*$/gm, "") // sub-headings
    .replace(/'{2,}/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/^[*#:;]+\s*/gm, ""); // list markers
  return clean(s).replace(/\s+([,.;:!?])/g, "$1").replace(/\(\s*\)/g, "");
}

// The plot section of an article's wikitext, as plain text ("" if it has none).
export function plotFromWikitext(wikitext) {
  const lines = wikitext.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^==\s*([^=].*?)\s*==\s*$/);
    if (m && PLOT_HEADINGS.test(m[1].replace(/'{2,}/g, "").trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^==[^=].*==\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return wikitextToText(lines.slice(start, end).join("\n"));
}
