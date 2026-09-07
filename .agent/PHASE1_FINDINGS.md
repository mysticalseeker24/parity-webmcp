# PHASE1_FINDINGS.md — what the browser actually does

Observed 2026-09-03 against **Chrome 152.0.7977.65** on Windows 11, running our
own production bundle (`dist/`) served over plain HTTP, driven over the DevTools
Protocol. Reproduce with `npm run build && npm run verify:browser`.

These are recorded because three of them contradict `webmcp-types@0.1.6`, and
each one would have surfaced as a confusing Phase 5 bug rather than an obvious
type error.

---

## How to enable WebMCP headlessly

`chrome://flags/#enable-webmcp-testing` has a command-line equivalent:

```
chrome --enable-blink-features=WebMCP
```

`--enable-features=WebMCP` and `--enable-features=WebMCPTesting` also work.
`--enable-blink-features=ModelContext`, `--enable-features=WebModelContext`,
`--enable-features=AIModelContext` and `--enable-features=EnableWebMCPTesting`
do **not** — they fail silently, leaving `document.modelContext` undefined,
which looks exactly like "our code is broken."

---

## 1. `RegisteredTool.inputSchema` is a JSON string, not an object

`webmcp-types` declares `inputSchema?: object`. Chrome returns:

```json
"{\"type\":\"object\",\"properties\":{},\"required\":[],\"additionalProperties\":false}"
```

**Why it matters:** the Phase 5 command palette renders a form from this schema.
Reading `schema.properties` off a string yields `undefined`, so every tool would
render an empty form — with no error, no exception, and nothing to grep for.

**Handled by:** `readInputSchema()` in `src/lib/webmcpInterop.ts`, which accepts
either shape so a future Chrome that fixes this needs no change here.

## 2. `executeTool()` resolves to a JSON string, not the returned value

Our `execute` returns `{ title: document.title }`. The caller receives:

```
typeof result === "string"   //  "{\"title\":\"Parity — WebMCP spike\"}"
```

Chrome serializes the return value on the way out. `webmcp-types` does not
declare `executeTool` at all, so nothing warns you.

**Why it matters:** the palette shows tool results to the human. Without parsing
it would render `[object Object]`-adjacent JSON noise instead of a result, and
any property access on the result would be `undefined`.

**Handled by:** `parseToolResult()` in `src/lib/webmcpInterop.ts`.

## 3. `executeTool()` arguments must be a JSON string

Confirmed rather than assumed. Passing an object throws:

```
UnknownError: Failed to parse input arguments
```

**Handled by:** `encodeToolArgs()`, so no call site passes an object by reflex.

## 4. `executeTool` is missing from `webmcp-types@0.1.6`

The package declares `registerTool`, `getTools` and `toolchange`, but not
`executeTool` — which the browser does implement (verified above) and which the
whole one-registry-two-callers thesis depends on.

**Handled by:** the declaration merge in `src/types/webmcp-augment.d.ts`. Delete
that file if a later release adds it.

## 5b. Zod 4 `toJSONSchema` defaults to `io: "output"`

Not a browser finding, but caught by the same test pass. With the default
`io`, any field carrying `.default()` is listed under `required` — because on
the *output* side it is always present. Handed to the agent as the *input*
schema, that says "you must send `time_of_day`". `defineTool` passes
`{ io: "input" }` and re-adds `additionalProperties: false`, which input mode
drops. `npm run verify:browser` asserts `find_providers` requires only
`specialty` as seen from the browser.

## 5. `annotations` are defaulted, not echoed

We register with `{ readOnlyHint: true }`. `getTools()` returns:

```json
{ "readOnlyHint": true, "untrustedContentHint": false }
```

Chrome fills in the absent field. Harmless, but worth knowing before writing an
exact-match assertion on annotations.

## 6. `execute` is called with ONE argument — no options, no `signal`

Found in Phase 2, the first time a tool destructured its second parameter.

`webmcp-types` declares `execute(input, { signal })`, and TOOLS.md §3 shows
`execute: async ({ slot_id }, { signal }) => …`. Chrome 152 calls:

```
execute(input)            // arguments.length === 1, options === undefined
```

Measured by registering a diagnostic tool from the probe
(`npm run verify:browser` prints it as `info  execute() is called with:`).

**Why it matters:** `({ slot_id }, { signal }) =>` throws `TypeError` on the
destructure before the tool body runs. The browser reports "Tool was executed
but the invocation failed" for **every** tool, with nothing in the console and
no `window.onerror`, while the same code passes against any mock that follows
the typings. This is the most expensive of the findings: it is invisible until
the real browser, and it looks like WebMCP is broken rather than the tool.

**Handled by:** `defineTool`'s registration wrapper takes `options?` and passes
`signal` through only when present. Tools never see the browser's options
object; they receive an `ExecuteContext` the factory builds.

**Consequence for Tier 3:** `watch_earlier_slot` cannot rely on the browser
supplying an `AbortSignal` in Chrome 152. It will need its own cancellation
(a tool, or a hold-expiry bound) rather than the documented `signal`.

## 7. `requestUserInteraction()` does NOT exist in Chrome 152 (spec issue #165)

Measured in Phase 6, because the grant gate would rather route approval through
the host than through the page. `npm run verify:browser` reports it every run:

```
info  requestUserInteraction (#165): absent — ModelContext exposes:
      executeTool, getTools, ontoolchange, registerTool
```

That is the **complete** `ModelContext` prototype surface in Chrome 152. There
is no host-mediated elicitation to route approval through.

**Why it matters.** #165 is the right home for grant approval, because the host
— unlike the page — can distinguish the human from the computer-use agent that
#288 records clicking a page's own Approve button. With it absent, Parity's
page card is the *only* approval channel available, which is exactly why the
README says page-side approval is **necessary, not sufficient** rather than
claiming the gate is airtight.

**Handled by:** `hostElicitationAvailable()` in `src/lib/grants.ts` feature-
detects it every time and is never assumed. If a browser does implement it, the
approval routes through it and is recorded with `channel: "host_elicitation"`;
the page card stays as the fallback. Support in ChatGPT's built-in browser is
still unverified — check it there before claiming anything either way.

## 8. Confirmed as documented

- `document.modelContext` exists; `navigator.modelContext` is `undefined`
  (TOOLS.md §2 is correct and current).
- `registerTool` is async and resolves.
- `AbortSignal` unregisters the tool.
- `origin` on a registered tool is the page origin.
- The page works over plain HTTP on `localhost` — no HTTPS needed for local dev.

---

## What this does NOT prove

Everything above is **Chrome with a flag**, not **ChatGPT's built-in browser**,
which supports a documented subset (TOOLS.md §1) and is the judging surface.
Still outstanding, and only verifiable by hand:

- [ ] Tools appear under **Site tools** in the ChatGPT desktop app's address bar
- [ ] The agent can invoke `get_page_title` and receives the title
- [ ] Screenshot captured for the submission

`npm run verify:browser` catches the failures that are ours. It cannot catch a
ChatGPT-side limitation.
