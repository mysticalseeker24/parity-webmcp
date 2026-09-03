/**
 * Real-browser verification for the WebMCP surface.
 *
 * Unit tests run against a mock, so they can only prove our code is
 * self-consistent. This script proves the page works against Chrome's actual
 * WebMCP implementation: it builds nothing, serves `dist/`, drives real Chrome
 * over the DevTools Protocol, and asserts the registry round-trip.
 *
 *   npm run build && npm run verify:browser
 *
 * Chrome 149+ is required. WebMCP is enabled here with
 * `--enable-blink-features=WebMCP`, which is the command-line equivalent of
 * chrome://flags/#enable-webmcp-testing and the only way to reach it headlessly.
 *
 * This is NOT a substitute for opening the deployed URL in the ChatGPT desktop
 * app's built-in browser. ChatGPT's browser supports a subset (TOOLS.md §1) and
 * remains the judging surface. This catches the failures that are ours.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const PORT = Number(process.env.VERIFY_PORT ?? 4321);
const DIST = resolve(import.meta.dirname, "..", "dist");
const DEBUG_PORT = Number(process.env.VERIFY_CDP_PORT ?? 9333);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

const failures = [];
const check = (label, ok, detail = "") => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p));
}

/** Static file server for dist/, with the SPA fallback vercel.json declares. */
function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    let filePath = join(DIST, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(DIST) || !existsSync(filePath) || url.pathname === "/") {
      filePath = join(DIST, "index.html");
    }
    try {
      const body = await readFile(filePath);
      // Deliberately no Origin-Agent-Cluster header: setting it to ?0 disables
      // WebMCP outright (TOOLS.md §1). Mirrors what Vercel serves.
      res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

async function cdp(expression) {
  let targets;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      targets = await res.json();
      if (targets.some((t) => t.type === "page" && t.url.includes(String(PORT)))) break;
    } catch {
      /* Chrome not listening yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const page = targets?.find((t) => t.type === "page" && t.url.includes(String(PORT)));
  if (!page) throw new Error("Chrome never opened the page target");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });

  const result = await new Promise((res, rej) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      if (msg.result?.exceptionDetails) {
        rej(new Error(msg.result.exceptionDetails.exception?.description ?? "page threw"));
      } else {
        res(msg.result?.result?.value);
      }
    });
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
    setTimeout(() => rej(new Error("CDP evaluate timed out")), 20_000);
  });

  ws.close();
  return result;
}

const PROBE = `(async () => {
  // Give the app's registration effect a moment to settle.
  for (let i = 0; i < 40 && !document.querySelector('[data-testid="registry-listing"]'); i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  const mc = document.modelContext;
  const out = {
    hasDocumentModelContext: typeof mc === "object" && mc !== null,
    hasNavigatorModelContext: typeof navigator.modelContext !== "undefined",
    executeToolExists: typeof mc?.executeTool === "function",
    verdictText: document.querySelector('[aria-live="polite"]')?.textContent ?? "",
    listingText: document.querySelector('[data-testid="registry-listing"]')?.textContent ?? "",
  };
  if (!mc) return out;
  const tools = await mc.getTools();
  out.toolNames = tools.map(t => t.name);
  const tool = tools.find(t => t.name === "get_page_title");
  if (tool) {
    out.inputSchemaType = typeof tool.inputSchema;
    out.annotations = tool.annotations;
    const raw = await mc.executeTool(tool, "{}");
    out.resultType = typeof raw;
    out.result = typeof raw === "string" ? JSON.parse(raw) : raw;
    try {
      await mc.executeTool(tool, {});
      out.objectArgs = "accepted";
    } catch (e) { out.objectArgs = "rejected"; }
  }
  return out;
})()`;

const chrome = findChrome();
if (!chrome) {
  console.error("Chrome not found. Set CHROME_PATH to a Chrome 149+ binary.");
  process.exit(2);
}
if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/index.html missing. Run `npm run build` first.");
  process.exit(2);
}

console.log(`Chrome:  ${chrome}`);
console.log(`Serving: ${DIST} on http://localhost:${PORT}\n`);

const server = await serveDist();
const profile = join(process.env.TEMP ?? "/tmp", `parity-verify-${process.pid}`);
const proc = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    "--enable-blink-features=WebMCP",
    `http://localhost:${PORT}/`,
  ],
  { stdio: "ignore" },
);

try {
  const r = await cdp(PROBE);

  console.log("WebMCP surface");
  check("document.modelContext is present", r.hasDocumentModelContext);
  check("navigator.modelContext is absent (TOOLS.md §2)", !r.hasNavigatorModelContext);
  check("executeTool() exists on ModelContext", r.executeToolExists);

  console.log("\nRegistration");
  check(
    "page reports DETECTED",
    /modelContext DETECTED/.test(r.verdictText),
    JSON.stringify(r.verdictText),
  );
  check(
    "getTools() returns exactly [get_page_title]",
    JSON.stringify(r.toolNames) === '["get_page_title"]',
    JSON.stringify(r.toolNames),
  );
  check(
    "page renders the registry it read back",
    r.listingText === "get_page_title",
    JSON.stringify(r.listingText),
  );
  check("readOnlyHint survived registration", r.annotations?.readOnlyHint === true);

  console.log("\nExecution contract");
  check(
    "executeTool() returns the page title",
    r.result?.title === "Parity — WebMCP spike",
    JSON.stringify(r.result),
  );
  check(
    "inputSchema arrives as a JSON string (see PHASE1_FINDINGS)",
    r.inputSchemaType === "string",
    `got ${r.inputSchemaType}`,
  );
  check(
    "executeTool() result arrives as a JSON string",
    r.resultType === "string",
    `got ${r.resultType}`,
  );
  check("object arguments are rejected", r.objectArgs === "rejected", r.objectArgs);
} catch (error) {
  failures.push(`probe threw: ${error.message}`);
  console.error(`\n  FAIL  ${error.message}`);
} finally {
  proc.kill();
  server.close();
}

console.log(
  failures.length === 0
    ? "\nAll browser checks passed.\n"
    : `\n${failures.length} browser check(s) failed.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
