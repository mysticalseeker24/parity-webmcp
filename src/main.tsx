import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import App from "./App";
import { startRegistry } from "./lib/registry";
import { TOOLS } from "./tools";
import "./index.css";

// The registry starts before React and outside it: registration is a function
// of store state, not of what is mounted (CONVENTIONS.md §3, §8).
startRegistry(TOOLS);

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <App />
    {/*
      Vercel Analytics and Speed Insights. The `/react` entry points, not
      `/next` — this is a Vite SPA and the Next.js builds expect a router that
      does not exist here.

      Both render nothing, need no key, and no-op outside a Vercel deployment,
      so local development and the test suite are unaffected. Neither touches
      `document.modelContext`, and `npm run verify` re-checks that the tool
      registry still behaves in a real browser with them loaded.

      They collect page views and Core Web Vitals. There is nothing personal to
      collect: the fixture data is synthetic and booking state never leaves the
      tab (CONVENTIONS.md §1).
    */}
    <Analytics />
    <SpeedInsights />
  </StrictMode>,
);
