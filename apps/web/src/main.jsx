// FilmHunch: streams Jev scores for a request and animates the poster wall as they land.
// No StrictMode: in development it runs effects twice, which would start (and pay for) every search twice.
import "@fontsource-variable/geist";
import "@fontsource/instrument-serif/400.css";
import { createRoot } from "react-dom/client";
import "./style.css";

// VITE_LANDING=1 builds only the "now open source" page (Landing.jsx) in place of the app.
const page = import.meta.env.VITE_LANDING
  ? import("./Landing.jsx").then((m) => m.Landing)
  : import("./App.jsx").then((m) => m.App);
page.then((Page) => createRoot(document.getElementById("root")).render(<Page />));
