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
  // After the socket has served its purpose, a late error event (Chrome being
  // torn down) must not become an unhandled rejection and a nonzero exit on an
  // otherwise passing run.
  ws.addEventListener("error", () => {});

  const result = await new Promise((res, rej) => {
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== 1) return;
      if (process.env.VERIFY_DEBUG) console.error("[cdp]", JSON.stringify(msg, null, 2));
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

const PROBE = `(async () => { try {
  function listMembers(obj) {
    var names = [];
    var proto = Object.getPrototypeOf(obj);
    if (proto) names = Object.getOwnPropertyNames(proto);
    var out = [];
    for (var i = 0; i < names.length; i++) {
      if (names[i] !== "constructor") out.push(names[i]);
    }
    return out.sort();
  }
  // Give the app's registration effect a moment to settle.
  // Wait for the detection effect to have committed, not merely for the app to
  // have rendered — the badge says "checking" for the first paint.
  const settled = () => {
    const badge = document.querySelector('[data-testid="detection"]');
    return badge && !/checking/i.test(badge.textContent || "");
  };
  for (let i = 0; i < 60 && !settled(); i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  const mc = document.modelContext;
  const out = {
    hasDocumentModelContext: typeof mc === "object" && mc !== null,
    hasNavigatorModelContext: typeof navigator.modelContext !== "undefined",
    executeToolExists: typeof mc?.executeTool === "function",
    // Spec issue #165. Either answer is a valid observation, so this is
    // reported rather than asserted — never assumed (TOOLS.md §3).
    requestUserInteractionExists: typeof mc?.requestUserInteraction === "function",
    modelContextKeys: mc ? listMembers(mc) : [],
    verdictText: document.querySelector('[data-testid="detection"]')?.textContent ?? "",
    listingText: document.querySelector('[data-testid="registry-listing"]')?.textContent ?? "",
  };
  if (!mc) return out;

  // Diagnostic: what does the browser actually hand an execute callback?
  // Registered from the probe, not the page, so it never ships.
  const diagController = new AbortController();
  await mc.registerTool({
    name: "probe_echo",
    description: "probe",
    inputSchema: { type: "object", properties: { x: { type: "string" } } },
    execute: function (input, options) {
      return {
        argc: arguments.length,
        inputType: typeof input,
        inputIsString: typeof input === "string",
        optionsType: typeof options,
        hasSignal: !!(options && options.signal),
      };
    },
  }, { signal: diagController.signal });
  const diag = (await mc.getTools()).find((t) => t.name === "probe_echo");
  try {
    const raw = await mc.executeTool(diag, JSON.stringify({ x: "1" }));
    out.executeCallShape = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) { out.executeCallShape = { error: String(e && e.message || e) }; }
  diagController.abort();
  // Every step is isolated so one failure reports its own message instead of
  // taking the whole probe down. Page-level errors are captured too.
  out.errors = {};
  out.pageErrors = [];
  window.addEventListener("error", (e) => out.pageErrors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => out.pageErrors.push("unhandled: " + String(e.reason)));
  const step = async (name, fn) => {
    try { return await fn(); } catch (e) { out.errors[name] = String(e && e.message || e); return undefined; }
  };
  const exec = (tool, args) => mc.executeTool(tool, args).then((raw) => (typeof raw === "string" ? JSON.parse(raw) : raw));

  const tools = await mc.getTools();
  out.toolNames = tools.map(t => t.name);
  const find = tools.find(t => t.name === "find_providers");
  const state = tools.find(t => t.name === "get_booking_state");
  if (find) {
    out.inputSchemaType = typeof find.inputSchema;
    out.annotations = find.annotations;
    const schema = typeof find.inputSchema === "string" ? JSON.parse(find.inputSchema) : find.inputSchema;
    out.specialtyEnum = schema?.properties?.specialty?.enum;
    out.findRequired = schema?.required;
  }
  if (state) {
    await step("get_booking_state", async () => {
      const raw = await mc.executeTool(state, "{}");
      out.resultType = typeof raw;
      out.result = typeof raw === "string" ? JSON.parse(raw) : raw;
    });
    try {
      await mc.executeTool(state, {});
      out.objectArgs = "accepted";
    } catch (e) { out.objectArgs = "rejected"; }
  }
  if (find) {
    // Drive a real transition through the browser and confirm the live set changed.
    out.findResult = await step("find_providers", () => exec(find, JSON.stringify({ specialty: "neurology" })));
    const select = tools.find(t => t.name === "select_provider");
    if (select) out.selectResult = await step("select_provider", () => exec(select, JSON.stringify({ provider_id: "p01" })));
    const after = await mc.getTools();
    out.afterSelect = after.map(t => t.name);
  }
  return out;
} catch (e) {
  // Without this the probe resolves undefined and the failure reads
  // "probe returned undefined", which says nothing about what broke.
  return { probeThrew: String(e && e.stack ? e.stack : e).slice(0, 600) };
} })()`;

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
  // The first evaluate occasionally lands while the page is still committing
  // its first render, and comes back undefined. One retry rather than a longer
  // fixed wait, so the common case stays fast.
  let r = await cdp(PROBE);
  if (!r || typeof r !== "object") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    r = await cdp(PROBE);
  }
  if (!r || typeof r !== "object") {
    throw new Error(`probe returned ${JSON.stringify(r)} — run with VERIFY_DEBUG=1 to see the raw CDP reply`);
  }
  if (r.probeThrew) {
    // Without this the failure reads "probe returned undefined", which says
    // nothing about what actually broke on the page.
    throw new Error(`the page threw during the probe:\n${r.probeThrew}`);
  }

  console.log("WebMCP surface");
  console.log(`  info  execute() is called with: ${JSON.stringify(r.executeCallShape)}`);
  check("document.modelContext is present", r.hasDocumentModelContext);
  check("navigator.modelContext is absent (TOOLS.md §2)", !r.hasNavigatorModelContext);
  check("executeTool() exists on ModelContext", r.executeToolExists);
  console.log(
    `  info  requestUserInteraction (#165): ${
      r.requestUserInteractionExists ? "PRESENT" : "absent"
    } — ModelContext exposes: ${r.modelContextKeys.join(", ")}`,
  );

  console.log("\nRegistration");
  check(
    "page reports WebMCP detected",
    /WebMCP: detected/.test(r.verdictText),
    JSON.stringify(r.verdictText),
  );
  // getTools() is alphabetical. Tier 2 adds check_coverage and
  // set_companion_constraint to the browsing stage.
  const BROWSING = [
    "check_coverage",
    "find_providers",
    "get_booking_state",
    "list_accommodations",
    "select_provider",
    "set_companion_constraint",
  ];
  check(
    "getTools() returns exactly the browsing-stage tools",
    JSON.stringify(r.toolNames) === JSON.stringify(BROWSING),
    JSON.stringify(r.toolNames),
  );
  check(
    "page renders the registry it read back",
    r.listingText === BROWSING.join(", "),
    JSON.stringify(r.listingText),
  );
  check("readOnlyHint survived registration", r.annotations?.readOnlyHint === true);
  check(
    "Zod enum reached the browser as a JSON Schema enum",
    Array.isArray(r.specialtyEnum) && r.specialtyEnum.includes("neurology"),
    JSON.stringify(r.specialtyEnum),
  );

  console.log("\nExecution contract");
  check(
    "results arrive in the ToolResult envelope (#282)",
    r.result?.ok === true && typeof r.result?.human_summary === "string",
    JSON.stringify(r.result).slice(0, 200),
  );
  check(
    "executeTool(get_booking_state) reports stage browsing",
    r.result?.data?.stage === "browsing",
    JSON.stringify(r.result?.data?.stage),
  );
  check(
    "live[] is grouped by tool group (#255)",
    JSON.stringify(r.result?.data?.live) ===
      JSON.stringify({
        orient: ["get_booking_state", "list_accommodations"],
        search: [
          "find_providers",
          "select_provider",
          "check_coverage",
          "set_companion_constraint",
        ],
      }),
    JSON.stringify(r.result?.data?.live),
  );
  check(
    "unavailable[] explains every non-live tool (#262)",
    Array.isArray(r.result?.data?.unavailable) &&
      r.result.data.unavailable.length === 7 &&
      r.result.data.unavailable.every((u) => u.tool && u.reason_code && u.unlock_by),
    JSON.stringify(r.result?.data?.unavailable?.map((u) => u.reason_code)),
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

  check(
    "defaulted fields are not advertised as required",
    Array.isArray(r.findRequired) && r.findRequired.length === 1 && r.findRequired[0] === "specialty",
    JSON.stringify(r.findRequired),
  );

  console.log("\nState machine through the browser");
  check(
    "find_providers via executeTool returns 3 neurologists",
    r.findResult?.data?.total === 3,
    JSON.stringify(r.findResult?.data?.total ?? r.errors?.find_providers),
  );
  check(
    "select_provider via executeTool moves to provider_selected",
    r.selectResult?.data?.stage === "provider_selected",
    JSON.stringify(r.selectResult?.data?.stage ?? r.errors?.select_provider),
  );
  check(
    "no provider bio reached the agent through the browser",
    !/SYSTEM NOTE/.test(JSON.stringify(r.findResult ?? {})),
  );
  check(
    "the live set was re-registered after the transition",
    Array.isArray(r.afterSelect) && r.afterSelect.includes("get_availability") && !r.afterSelect.includes("hold_slot"),
    JSON.stringify(r.afterSelect),
  );
  check(
    "no tool invocation threw and no page error fired",
    Object.keys(r.errors ?? {}).length === 0 && (r.pageErrors ?? []).length === 0,
    JSON.stringify({ errors: r.errors, pageErrors: r.pageErrors }),
  );
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

// Chrome and the socket are being torn down; a stray error from either must not
// turn a passing run into a nonzero exit.
process.on("unhandledRejection", () => {});
process.on("uncaughtException", () => {});
process.exitCode = failures.length === 0 ? 0 : 1;
setImmediate(() => process.exit(process.exitCode));
