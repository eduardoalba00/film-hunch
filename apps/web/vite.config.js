// The FilmHunch web app. In development Vite serves it on :5173 and forwards API calls to the API
// server on :3000; in production it's a static build that calls VITE_API_URL.
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const API = `http://localhost:${process.env.API_PORT ?? 3000}`;

// Link previews and search engines need absolute URLs, so the canonical link and preview image are
// only added when the build knows its address (VITE_SITE_URL, e.g. https://movies.example.com).
function siteUrl(url) {
  const base = url?.replace(/\/+$/, "");
  return {
    name: "site-url",
    transformIndexHtml: () =>
      base
        ? [
            { tag: "link", attrs: { rel: "canonical", href: `${base}/` } },
            { tag: "meta", attrs: { property: "og:url", content: `${base}/` } },
            { tag: "meta", attrs: { property: "og:image", content: `${base}/og.png` } },
            { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
            { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
            { tag: "meta", attrs: { name: "twitter:image", content: `${base}/og.png` } },
          ]
        : [],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), siteUrl(loadEnv(mode, process.cwd(), "VITE_").VITE_SITE_URL)],
  server: { proxy: { "/api": API, "/health": API } },
}));
