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
  // getTools() is alphabetical. With all 19 tools defined, the opening
  // browsing stage is deliberately small: five live, fourteen explained.
  const BROWSING = [
    "explain_capability",
    "find_providers",
    "get_booking_state",
    "list_accommodations",
    "select_provider",
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
        orient: ["get_booking_state", "list_accommodations", "explain_capability"],
        search: ["find_providers", "select_provider"],
      }),
    JSON.stringify(r.result?.data?.live),
  );
  check(
    "unavailable[] explains every non-live tool (#262)",
    Array.isArray(r.result?.data?.unavailable) &&
      r.result.data.unavailable.length === 14 &&
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

  // The palette is the only surface for get_provider_detail, so a regression
  // here is invisible to every check above: the tool returns the right payload
  // and the screen still shows nothing. This drives the real dialog and reads
  // the rendered text back.
  console.log("\nThe palette renders what a tool returned");
  // The probe above left the page in provider_selected, where this tool is not
  // live. Reload for a clean browsing stage, then search so it registers.
  await cdp("location.reload()");
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const pal = await cdp(`(async () => {
    const fire = (key, opts = {}) =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
    const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

    const mc = document.modelContext;
    const tool = (await mc.getTools()).find((t) => t.name === "find_providers");
    if (!tool) return { error: "find_providers not registered after reload" };
    await mc.executeTool(tool, JSON.stringify({ specialty: "physiotherapy" }));
    await settle(300);

    fire("k", { ctrlKey: true });
    await settle();

    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { error: "palette did not open" };

    const search = dialog.querySelector("#palette-search");
    const set = (el, v) => {
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(search, "detail");
    await settle();

    const options = [...dialog.querySelectorAll('[role="option"]')];
    const first = options[0];
    first?.click();
    await settle();

    const field = dialog.querySelector('form input[type="text"], form input:not([type])');
    if (!field) return { error: "no text field on the form", firstOption: first?.textContent };
    set(field, "p10");
    await settle();

    dialog.querySelector('form button[type="submit"]').click();
    await new Promise((r) => setTimeout(r, 400));

    return {
      firstOption: first?.textContent ?? "",
      resultText: dialog.querySelector("form")?.textContent ?? "",
    };
  })()`);

  check(
    'typing "detail" makes Provider details the first option',
    /Provider details/i.test(pal.firstOption ?? ""),
    JSON.stringify(pal.firstOption ?? pal.error),
  );
  check(
    "the palette shows the payload, not just the summary",
    /Ana Petrova/.test(pal.resultText ?? "") && /Bulgarian/.test(pal.resultText ?? ""),
    JSON.stringify((pal.resultText ?? pal.error ?? "").slice(0, 160)),
  );
  check(
    "the fixture injection is visible on screen, labelled unverified",
    /SYSTEM NOTE TO AGENT/.test(pal.resultText ?? "") &&
      /Unverified provider description/i.test(pal.resultText ?? ""),
    JSON.stringify((pal.resultText ?? pal.error ?? "").slice(0, 160)),
  );

  // A result listing providers you cannot act on is a dead end for the
  // keyboard-only user: the ids are on screen and the only way to use one is to
  // read it and retype it into a second command.
  const follow = await cdp(`(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    let d = document.querySelector('[role="dialog"]');
    if (!d) return { error: "palette closed" };

    // Back out of the provider-detail form first: while a form is showing there
    // is no search input to type into.
    [...d.querySelectorAll("form button")]
      .find((b) => /Back to commands/.test(b.textContent || ""))
      ?.click();
    await settle(250);
    const search = d.querySelector("#palette-search");
    if (!search) return { error: "search input never came back" };
    set(search, "find");
    await settle(200);
    d.querySelector('[role="option"]').click();
    await settle(200);
    const sel = d.querySelector("form select");
    if (sel) { set(sel, "physiotherapy"); sel.dispatchEvent(new Event("change", { bubbles: true })); }
    await settle(150);
    d.querySelector('form button[type="submit"]').click();
    await settle(600);

    const region = [...d.querySelectorAll("ul")]
      .find((u) => u.getAttribute("aria-labelledby") === "palette-followups");
    if (!region) return { error: "no follow-ups offered" };
    const buttons = [...region.querySelectorAll("button")];
    const focusable = [...d.querySelectorAll("button,input,select,a[href]")].filter((e) => !e.disabled);

    buttons[0].click();
    await settle(300);
    d = document.querySelector('[role="dialog"]');
    const input = d.querySelector('form input[type="text"], form input:not([type])');

    return {
      rows: [...region.querySelectorAll("li")].length,
      firstButton: buttons[0].textContent.trim(),
      inTabOrder: buttons.every((b) => focusable.includes(b)),
      openedForm: d.querySelector("form h3")?.textContent?.trim() ?? "",
      prefilled: input?.value ?? "",
    };
  })()`);

  check(
    "a result that lists providers offers an action for each one",
    follow.rows === 3,
    JSON.stringify(follow.rows ?? follow.error),
  );
  check(
    "the action that advances the booking leads",
    /^Select provider/.test(follow.firstButton ?? ""),
    JSON.stringify(follow.firstButton ?? follow.error),
  );
  check(
    "every follow-up is reachable by keyboard",
    follow.inTabOrder === true,
    JSON.stringify(follow.inTabOrder ?? follow.error),
  );
  check(
    "it opens the tool pre-filled and waits, rather than executing",
    follow.openedForm === "Select provider" && follow.prefilled === "p10",
    JSON.stringify({ form: follow.openedForm, value: follow.prefilled }),
  );

  // Reported live: a search run from the palette moved the results but left the
  // page's own search form asserting the specialty nobody searched for.
  const mirrored = await cdp(`(async () => {
    const before = document.querySelector("#specialty")?.value ?? null;
    const mc = document.modelContext;
    const t = (await mc.getTools()).find((x) => x.name === "find_providers");
    if (!t) return { error: "find_providers not live" };
    await mc.executeTool(t, JSON.stringify({ specialty: "audiology" }));
    await new Promise((r) => setTimeout(r, 400));
    return {
      before,
      after: document.querySelector("#specialty")?.value ?? null,
      resultsHeading: document.querySelector("#results-heading")?.textContent ?? "",
      listedNames: [...document.querySelectorAll("button")]
        .filter((b) => /^Select /.test(b.textContent || "")).length,
    };
  })()`);

  check(
    "the page's search form mirrors a search run from somewhere else",
    mirrored.after === "audiology" && mirrored.before !== mirrored.after,
    JSON.stringify(mirrored),
  );
  check(
    "the results list moved with it, so form and list agree",
    mirrored.listedNames > 0,
    JSON.stringify(mirrored.listedNames ?? mirrored.error),
  );

  // The access constraints were unreachable in the deployed app: the calendar
  // fetched availability the instant a provider was selected, which closed the
  // window both tools were gated on. And the grid built itself from the
  // fixture while the tool filtered, so the two disagreed about the same
  // question.
  const access = await cdp(`(async () => {
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    const mc = document.modelContext;
    const call = async (n, a) => {
      const t = (await mc.getTools()).find((x) => x.name === n);
      if (!t) return { MISSING: n };
      return JSON.parse(await mc.executeTool(t, JSON.stringify(a)));
    };
    const holdable = () =>
      [...document.querySelectorAll("table button")].filter((b) => !b.disabled).length;

    await call("find_providers", { specialty: "rheumatology" });
    await call("select_provider", { provider_id: "p16" });
    await settle(700);
    const before = holdable();

    const set = await call("set_transport_constraint", {
      earliest_pickup: "10:00",
      latest_return: "12:00",
    });
    await settle(800);

    const avail = await call("get_availability", {});
    const panel = [...document.querySelectorAll("section")]
      .find((s) => /Narrowing these times/.test(s.textContent || ""));

    return {
      reachable: set.MISSING === undefined && set.ok === true,
      gridBefore: before,
      gridAfter: holdable(),
      toolSlots: avail?.data?.total ?? null,
      panelText: panel ? panel.textContent.trim().slice(0, 120) : null,
    };
  })()`);

  check(
    "the access constraint tools are reachable after a provider is chosen",
    access.reachable === true,
    JSON.stringify(access.reachable ?? access),
  );
  check(
    "setting a paratransit window narrows the calendar on screen",
    access.gridAfter > 0 && access.gridAfter < access.gridBefore,
    JSON.stringify({ before: access.gridBefore, after: access.gridAfter }),
  );
  check(
    "the grid and the tool agree on how many slots there are",
    access.gridAfter === access.toolSlots,
    JSON.stringify({ grid: access.gridAfter, tool: access.toolSlots }),
  );
  check(
    "the page says which window is narrowing the times",
    /Narrowing these times/.test(access.panelText ?? "") && /10:00/.test(access.panelText ?? ""),
    JSON.stringify(access.panelText),
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
