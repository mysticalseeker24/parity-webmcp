import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
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
  </StrictMode>,
);
