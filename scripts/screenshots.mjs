/**
 * Capture the screenshots the README and Devpost page need.
 *
 * Note what this CANNOT capture: the browser's own **Site tools** panel is
 * browser chrome, not page content, so no page-driven screenshot can include
 * it. That one has to be taken by hand — see the note printed at the end.
 *
 *   node scripts/screenshots.mjs https://parity-webmcp.vercel.app/
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const URL_UNDER_TEST = process.argv[2] ?? "https://parity-webmcp.vercel.app/";
const PORT = Number(process.env.SHOT_CDP_PORT ?? 9455);
const OUT = "docs/screenshots";

const chrome = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean).find((p) => existsSync(p));

if (!chrome) {
  console.error("Chrome not found. Set CHROME_PATH.");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

/**
 * Serve ./dist when pointed at localhost, so the current build can be shot
 * without a separate terminal. A remote URL is used as-is.
 */
let staticServer = null;
if (/^https?:\/\/localhost/.test(URL_UNDER_TEST)) {
  const port = Number(new URL(URL_UNDER_TEST).port || 80);
  const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  staticServer = createServer((req, res) => {
    let file = join("dist", decodeURIComponent((req.url ?? "/").split("?")[0]));
    // A directory (including "/") is the SPA entry, not a readable file.
    if (!existsSync(file) || statSync(file).isDirectory()) file = join("dist", "index.html");
    try {
      res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((r) => staticServer.listen(port, r));
  console.log(`Serving ./dist on ${URL_UNDER_TEST}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
let nextId = 0;
const pending = new Map();

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(method))), 30_000);
  });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "threw");
  return r.result?.value;
};

const callTool = (name, args = {}) =>
  evaluate(`(async () => {
    const mc = document.modelContext;
    const t = (await mc.getTools()).find(x => x.name === ${JSON.stringify(name)});
    if (!t) return null;
    const raw = await mc.executeTool(t, ${JSON.stringify(JSON.stringify(args))});
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  })()`);

/** Screenshot one element by CSS selector, tightly cropped. */
async function shotElement(selector, file, pad = 12) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`);
  if (!box) return console.log(`  skipped ${file} — ${selector} not found`);
  await sleep(300);
  // clip is in PAGE coordinates, not viewport coordinates — getBoundingClientRect
  // is viewport-relative, so the scroll offset has to be added back or the clip
  // lands on empty page and the shot comes out blank.
  const fresh = await evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return {
      x: r.x + window.scrollX, y: r.y + window.scrollY,
      width: r.width, height: r.height,
    };
  })()`);
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, fresh.x - pad),
      y: Math.max(0, fresh.y - pad),
      width: fresh.width + pad * 2,
      height: fresh.height + pad * 2,
      scale: 2,
    },
  });
  writeFileSync(join(OUT, file), Buffer.from(data, "base64"));
  console.log(`  wrote ${OUT}/${file}`);
}

const profile = join(process.env.TEMP ?? "/tmp", `parity-shots-${process.pid}`);
const proc = spawn(chrome, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run",
  "--force-device-scale-factor=1", "--window-size=1280,1800",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  "--enable-blink-features=WebMCP", URL_UNDER_TEST,
], { stdio: "ignore" });

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    } catch { /* not up */ }
    if (!target) await sleep(250);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  ws.addEventListener("error", () => {});
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (!m.id || !pending.has(m.id)) return;
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  });
  await send("Page.enable");
  await send("Runtime.enable");

  for (let i = 0; i < 60; i++) {
    if (await evaluate(`!!document.querySelector('[data-testid="detection"]')`)) break;
    await sleep(250);
  }
  await sleep(600);

  console.log("Capturing…");

  // The loading sheet, if it is still up. It clears itself after 1.4 s and is
  // skipped entirely under prefers-reduced-motion, so this is best-effort.
  if (await evaluate(`!!document.querySelector('[data-testid="loading-screen"]')`)) {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: 1280, height: 900, scale: 1.2 },
    });
    writeFileSync(join(OUT, "loading-screen.png"), Buffer.from(data, "base64"));
    console.log(`  wrote ${OUT}/loading-screen.png`);
  }

  // Wait for the sheet to clear, then shoot the hero underneath it.
  for (let i = 0; i < 40; i++) {
    if (!(await evaluate(`!!document.querySelector('[data-testid="loading-screen"]')`))) break;
    await sleep(100);
  }
  await sleep(300);
  {
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: 1280, height: 820, scale: 1.5 },
    });
    writeFileSync(join(OUT, "hero.png"), Buffer.from(data, "base64"));
    console.log(`  wrote ${OUT}/hero.png`);
  }

  // Drive to intake_complete so the interesting states are on screen.
  await callTool("find_providers", { specialty: "neurology" });
  await callTool("select_provider", { provider_id: "p01" });
  const avail = await callTool("get_availability", {});
  const slot = avail.data.slots[0].id;
  await callTool("hold_slot", { slot_id: slot });
  await callTool("set_intake", {
    patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine",
  });
  await sleep(500);

  // Open the lockstep panel.
  await evaluate(`(() => {
    const d = [...document.querySelectorAll("details")]
      .find(x => /One registry, two callers/.test(x.textContent || ""));
    if (d) d.open = true;
  })()`);
  await sleep(400);

  const lockstep = await evaluate(`(() => {
    const d = [...document.querySelectorAll("details")]
      .find(x => /One registry, two callers/.test(x.textContent || ""));
    if (!d) return null;
    d.id = "shot-lockstep";
    return true;
  })()`);
  if (lockstep) await shotElement("#shot-lockstep", "lockstep-panel.png");

  // The grant card.
  await callTool("confirm_booking", { slot_id: slot });
  await sleep(600);
  await shotElement('[role="alertdialog"] > div', "grant-card.png");

  // Approve, then capture the audit trail with the timing evidence.
  const box = await evaluate(`(() => {
    const el = document.querySelector('[data-testid="grant-approve"]');
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width/2, y: r.y + r.height/2 };
  })()`);
  await sleep(1700);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", {
      type, x: box.x, y: box.y, button: "left", clickCount: 1, pointerType: "mouse",
    });
  }
  await sleep(800);

  await evaluate(`(() => {
    const h = [...document.querySelectorAll("h2")].find(x => /Activity trail/.test(x.textContent||""));
    const s = h && h.closest("section");
    if (s) s.id = "shot-audit";
    return !!s;
  })()`);
  await shotElement("#shot-audit", "audit-trail.png");

  // Full page, for context.
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(OUT, "full-page.png"), Buffer.from(data, "base64"));
  console.log(`  wrote ${OUT}/full-page.png`);

  console.log(`
NOT CAPTURABLE FROM HERE:
  docs/screenshots/site-tools.png — the browser's Site tools panel is browser
  chrome, not page content. Take it by hand in ChatGPT's built-in browser:
  open the deployment, click Site tools in the address bar, screenshot it, and
  save it to that path.`);
} finally {
  try { ws?.close(); } catch { /* closing */ }
  proc.kill();
  staticServer?.close();
}

process.on("unhandledRejection", () => {});
setImmediate(() => process.exit(0));
