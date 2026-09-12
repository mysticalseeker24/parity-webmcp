/**
 * Automated accessibility audit against a running build.
 *
 *   node scripts/a11y-audit.mjs                      # audits ./dist
 *   node scripts/a11y-audit.mjs https://example.com  # audits a deployment
 *
 * Two things, both of which are machine-checkable and neither of which is a
 * substitute for a screen-reader user:
 *
 *  1. **axe-core** over each stage of the booking flow, including the states
 *     that only exist after a tool has run — a palette dialog, a grant card, a
 *     held slot. Auditing the first paint only would miss every surface this
 *     product is actually judged on.
 *
 *  2. **The accessibility tree Chrome exposes**, read over CDP. This is the
 *     data an assistive technology receives. Asserting on it catches the class
 *     of bug where the markup looks right and the computed name is empty.
 *
 * What this does NOT do is tell you how any of it sounds, whether the reading
 * order makes sense, or whether the flow is usable. See docs/SCREEN_READER.md
 * for the part a person has to do.
 */

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const TARGET = process.argv[2] ?? null;
const PORT = Number(process.env.A11Y_PORT ?? 4733);
const DEBUG_PORT = Number(process.env.A11Y_CDP_PORT ?? 9401);
const DIST = resolve(import.meta.dirname, "..", "dist");
const BASE = TARGET ?? `http://localhost:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(label);
};

function findChrome() {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].filter(Boolean).find((p) => existsSync(p));
}

let server = null;
if (!TARGET) {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", BASE);
    let file = join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !existsSync(file) || url.pathname === "/") {
      file = join(DIST, "index.html");
    }
    try {
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => server.listen(PORT, r));
}

// Fetched here rather than injected as a <script src>, so the page's own
// network and CSP posture is unchanged by being audited.
const AXE = await (await fetch("https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js")).text();

const chrome = findChrome();
if (!chrome) {
  console.error("Chrome not found. Set CHROME_PATH.");
  process.exit(2);
}
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${DEBUG_PORT}`,
  "--enable-blink-features=WebMCP",
  "--disable-background-timer-throttling",
  "--force-prefers-reduced-motion",
  "--user-data-dir=" + join(process.env.TEMP ?? "/tmp", "parity-a11y-ud"),
  BASE,
], { stdio: "ignore" });

let ws;
let nextId = 0;
const pending = new Map();

async function connect() {
  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      if (targets.some((t) => t.type === "page")) break;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const page = targets?.find((t) => t.type === "page");
  if (!page) throw new Error("Chrome never opened a page target");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  ws.addEventListener("error", () => {});
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
}

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++nextId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => pending.has(id) && (pending.delete(id), rej(new Error(`${method} timed out`))), 30_000);
  });

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) {
    throw new Error(r.result.exceptionDetails.exception?.description ?? "page threw");
  }
  return r.result?.result?.value;
}

/** axe over the current DOM state, restricted to the rules we claim to meet. */
async function axeHere(label) {
  const result = await evaluate(`(async () => {
    const r = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      resultTypes: ["violations"],
    });
    return r.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
      count: v.nodes.length,
      detail: v.nodes[0]?.any?.[0]?.message ?? v.nodes[0]?.failureSummary ?? null,
    }));
  })()`);
  const serious = result.filter((v) => v.impact === "critical" || v.impact === "serious");
  for (const v of serious) {
    if (v.id === "color-contrast" && v.detail) console.log(`        ${v.detail}`);
  }
  check(
    `axe: no critical or serious violations — ${label}`,
    serious.length === 0,
    serious.map((v) => `${v.id} (${v.count}) ${v.nodes[0] ?? ""}`).join("; "),
  );
  const minor = result.filter((v) => v.impact !== "critical" && v.impact !== "serious");
  if (minor.length) {
    console.log(`        note (${label}): ${minor.map((v) => `${v.id}×${v.count}`).join(", ")}`);
  }
  return result;
}

const HELPERS = `
  window.__settle = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__call = async (n, a) => {
    const mc = document.modelContext;
    const t = (await mc.getTools()).find((x) => x.name === n);
    if (!t) return { MISSING: n };
    const r = await mc.executeTool(t, JSON.stringify(a ?? {}));
    return typeof r === "string" ? JSON.parse(r) : r;
  };
`;

try {
  await connect();
  await send("Accessibility.enable");

  // Wait for the app to have registered, not merely painted.
  await evaluate(`(async () => {
    ${HELPERS}
    for (let i = 0; i < 80; i++) {
      const b = document.querySelector('[data-testid="detection"]');
      if (b && !/checking/i.test(b.textContent || "")) return true;
      await window.__settle(100);
    }
    return false;
  })()`);
  await evaluate(AXE);

  console.log(`\nAudited: ${BASE}\n`);
  console.log("axe-core, every stage of the flow");
  await axeHere("landing");

  await evaluate(`(async () => { ${HELPERS}
    await window.__call("find_providers", { specialty: "physiotherapy" });
    await window.__settle(500); })()`);
  await axeHere("results listed");

  await evaluate(`(async () => { ${HELPERS}
    await window.__call("select_provider", { provider_id: "p10" });
    await window.__settle(900); })()`);
  await axeHere("calendar shown");

  await evaluate(`(async () => { ${HELPERS}
    const a = await window.__call("get_availability", {});
    window.__slot = a?.data?.slots?.[0]?.id;
    await window.__call("hold_slot", { slot_id: window.__slot });
    await window.__call("set_intake", { patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine" });
    await window.__settle(600); })()`);
  await axeHere("slot held, intake complete");

  // Error text is where contrast matters most and where an audit of happy-path
  // states never looks. Drive a real refusal through the form rather than
  // trusting that a fixed token covers it.
  const errored = await evaluate(`(async () => {
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const dob = document.querySelector("#dob");
    if (!dob) return { err: "no dob field" };
    set(dob, "14/10/2026");
    const form = dob.closest("form");
    form.querySelector('button[type="submit"]').click();
    await new Promise((r) => setTimeout(r, 700));
    const err = document.querySelector("#dob-error");
    return { shown: !!err, text: (err?.textContent ?? "").slice(0, 60) };
  })()`);
  check("a refusal renders an error message to audit", errored.shown === true, JSON.stringify(errored));
  await axeHere("intake refusal shown");

  await evaluate(`(async () => { ${HELPERS}
    await window.__call("set_intake", { patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine" });
    await window.__call("confirm_booking", { slot_id: window.__slot });
    await window.__settle(800); })()`);
  await axeHere("grant card raised");

  await evaluate(`(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    await new Promise((r) => setTimeout(r, 600)); })()`);
  await axeHere("command palette open");

  // --- The accessibility tree: what an assistive technology actually gets.
  console.log("\nThe accessibility tree Chrome exposes");
  const axTree = await send("Accessibility.getFullAXTree");
  const nodes = axTree.result?.nodes ?? [];
  const named = nodes.map((n) => ({
    role: n.role?.value,
    name: n.name?.value ?? "",
    ignored: n.ignored,
  })).filter((n) => !n.ignored);

  const byRole = (role) => named.filter((n) => n.role === role);
  const dialogs = [...byRole("dialog"), ...byRole("alertdialog")];
  check(
    "the open dialog has a non-empty accessible name",
    dialogs.length > 0 && dialogs.every((d) => d.name.trim() !== ""),
    JSON.stringify(dialogs.map((d) => d.name)),
  );

  const unnamedControls = named.filter(
    (n) => ["button", "textbox", "combobox", "checkbox", "link"].includes(n.role ?? "") && n.name.trim() === "",
  );
  check(
    "every exposed control has an accessible name",
    unnamedControls.length === 0,
    `${unnamedControls.length} unnamed: ${unnamedControls.slice(0, 4).map((n) => n.role).join(", ")}`,
  );

  const headings = byRole("heading");
  check("headings are exposed and named", headings.length > 0 && headings.every((h) => h.name.trim() !== ""));

  // The live region is the whole second contribution; if it is not in the tree
  // with a polite setting, nothing is announced when the agent acts.
  const liveRegion = await evaluate(`(() => {
    const el = [...document.querySelectorAll("[aria-live]")].map((e) => ({
      live: e.getAttribute("aria-live"),
      atomic: e.getAttribute("aria-atomic"),
      role: e.getAttribute("role"),
      text: (e.textContent || "").trim().slice(0, 80),
    }));
    return el;
  })()`);
  check(
    "a polite live region exists and is carrying the last announcement",
    liveRegion.some((r) => r.live === "polite") && liveRegion.some((r) => r.text.length > 0),
    JSON.stringify(liveRegion).slice(0, 220),
  );

  const gridInfo = await evaluate(`(() => {
    const table = document.querySelector("table");
    if (!table) return { present: false };
    const cells = [...table.querySelectorAll("button")];
    return {
      present: true,
      hasCaption: !!table.querySelector("caption"),
      scopedHeaders: [...table.querySelectorAll("th")].every((th) => th.hasAttribute("scope")),
      tabStops: cells.filter((b) => b.tabIndex === 0).length,
      focusable: cells.length,
    };
  })()`);
  if (gridInfo.present) {
    check("the calendar exposes a caption and scoped headers", gridInfo.hasCaption && gridInfo.scopedHeaders, JSON.stringify(gridInfo));
    check(
      "the calendar is a single tab stop (ARIA APG grid)",
      gridInfo.tabStops === 1,
      `${gridInfo.tabStops} of ${gridInfo.focusable} cells are in the tab order`,
    );
  }
} catch (error) {
  failures.push(`audit threw: ${error.message}`);
  console.error(`\n  FAIL  ${error.message}`);
} finally {
  proc.kill();
  server?.close();
}

console.log(
  failures.length === 0
    ? "\nNo automated accessibility failures. This is not a screen-reader result — see docs/SCREEN_READER.md.\n"
    : `\n${failures.length} accessibility check(s) failed.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
