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

## 5. `annotations` are defaulted, not echoed

We register with `{ readOnlyHint: true }`. `getTools()` returns:

```json
{ "readOnlyHint": true, "untrustedContentHint": false }
```

Chrome fills in the absent field. Harmless, but worth knowing before writing an
exact-match assertion on annotations.

## 6. Confirmed as documented

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
