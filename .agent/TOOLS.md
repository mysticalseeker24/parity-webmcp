# TOOLS.md — Verified API Surfaces & Configuration

Exact, researched detail for every external surface. This file exists to prevent the small-error cascade: wrong namespace, unsupported API, wrong model, wrong deploy header. Everything here was verified against current docs (Sep 3, 2026) — Chrome's WebMCP docs, OpenAI's Site tools docs, and the challenge Resources tab. Where a fact may have drifted, it says **verify on the page** — do that rather than assume.

---

## 1. WebMCP — the mental model

**There is no server, no transport, and nothing to deploy but a static site.** This is the single most common misconception coming from having built a stdio or Streamable-HTTP MCP server.

- The **browser is the MCP client.** Our page is the server — but a server made of JavaScript closures in a tab, not a process on a port.
- Tools are registered with the browser via `document.modelContext.registerTool(...)` when the page loads.
- The browser surfaces them under **Site tools** in the address bar (ChatGPT) and routes agent calls back into our page.
- Same tab, same DOM, same signed-in session, same cookies. No credentials leave the page, no OAuth, no API key.

Consequences to design around:

- **Tools belong to the page.** Navigate away or close the tab and they are gone. This is why Parity is a single-page app with no route changes.
- **Origin isolation is required.** WebMCP is only available in origin-isolated documents. If a document opts out via `Origin-Agent-Cluster: ?0` (which enables `document.domain`), the APIs are **disabled entirely.** Do not set that header.
- **Permissions Policy `tools`** gates both APIs, defaulting to `self` — top-level and same-origin contexts allowed, cross-origin iframes denied unless given `allow="tools"`.

### ⚠️ ChatGPT's built-in browser supports only a subset

This is the judging surface, so these limits are hard constraints, not caveats. Per OpenAI's Site tools docs:

- **The Declarative API does not work.** Tools defined through HTML form attributes (`toolname`, `tooldescription`) are **not** available as site tools. **Do not use it.**
- **Tools in iframes are not discovered** — same-origin or cross-origin. **Register in the top-level page only.**
- Requires **GPT-5.6 Sol or GPT-5.6 Terra**. **GPT-5.6 Luna has WebMCP disabled.** If tools do not appear, check the model first.
- Not available in Enterprise or Edu workspaces.
- The ChatGPT desktop app must be up to date.
- Each invocation gets a browser-side safety review before it runs; consequential actions still hit normal confirmation policies. Expect an extra confirmation step in the demo and do not mistake it for a bug.

Everything Parity does must work under those constraints. Chrome with the flag supports more (declarative, iframes) — but we target the intersection.

---

## 2. The namespace — get this right or nothing works

```ts
// ✅ CORRECT
document.modelContext.registerTool({ ... });

// ❌ WRONG — moved away from this in August 2026
navigator.modelContext.registerTool({ ... });
```

The tool-registration getter **moved from `navigator.modelContext` to `document.modelContext`** around Aug 10, 2026. Most blog posts, tutorials, and LLM training data predate that move and will silently fail. **Always feature-detect:**

```ts
if (typeof document.modelContext?.registerTool === "function") { /* register */ }
```

---

## 3. Imperative API — the surface we use

### Register

```ts
const controller = new AbortController();

await document.modelContext.registerTool(
  {
    name: "hold_slot",
    description: "Place a 10-minute hold on an appointment slot for the selected provider.",
    inputSchema: {
      type: "object",
      properties: { slot_id: { type: "string", description: "Slot id from get_availability." } },
      required: ["slot_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: async ({ slot_id }, { signal }) => {
      // returns a string or a serializable object
      return { held: true, slot_id, expires_in_s: 600 };
    },
  },
  { signal: controller.signal }
);

controller.abort(); // unregisters
```

Verified details:

- `registerTool` is **async** — `await` it.
- Unregistration is via `AbortSignal` passed as an option. **As of Chrome 153, unregistering no longer cancels in-flight executions** — safe for component/state-driven lifecycles.
- `execute` receives `(input, { signal })`. The second-argument `signal` aborts when the user or agent cancels. Pass it to any `fetch` or long-running wait. `watch_earlier_slot` must honour it.
- Return value is serialized back to the model. A string or a small plain object both work.
- `annotations` supports at least `readOnlyHint` and `untrustedContentHint`. **Honest signals only — never enforcement.** See `CONVENTIONS.md` §5.

### Discover — the API that makes our thesis literal

```ts
const tools = await document.modelContext.getTools();
// each: { name, title, description, inputSchema, annotations, origin, window }
```

**⚠️ Verified against real Chrome (Phase 1, `PHASE1_FINDINGS.md`; matches spec issue #278):**

- **`inputSchema` arrives as a JSON *string*, not an object**, despite `webmcp-types@0.1.6` typing it as an object. Reading `.properties` off it yields `undefined` → the palette renders empty forms with no error. Always go through `readInputSchema()` in `src/lib/webmcpInterop.ts`, which accepts either shape.
- `annotations` come back **defaulted** (e.g. `untrustedContentHint: false` added), not echoed verbatim. Do not assert deep-equality against what you registered.
- `executeTool` is **missing from `webmcp-types` entirely** even though Chrome implements it. The declaration merge lives in `src/types/webmcp-augment.d.ts`.

Alphabetically ordered. Returns tools the calling document is authorized to access — by default, same-origin tools registered by this document. **Our command palette calls this**, which is why the human surface is a caller of the same registry rather than a parallel implementation.

Cross-origin retrieval requires `fromOrigins: ['https://partner.org']` **and** the hosting origin having exposed the tool via `exposedTo`. **We do not use cross-origin.** ChatGPT's browser would not discover it anyway.

### Execute

```ts
const result = await document.modelContext.executeTool(tool, '{"slot_id":"s_1030"}');
```

**Arguments are a JSON string, not an object** — passing an object fails with `UnknownError: Failed to parse input arguments` (confirmed in Chrome, Phase 1). **The return value is also a JSON string**, not the value `execute` returned; Chrome serialises it. Returns `null` when a navigation is triggered. Accepts an optional `{ signal }` for cancellation. Use `encodeToolArgs()` / `parseToolResult()` from `webmcpInterop.ts` so a future Chrome that changes either shape needs no code change. This is the palette's execution path.

Reference implementation for this pattern: Chrome's **`page-agent`** demo (`GoogleChromeLabs/webmcp-tools/tree/main/demos/page-agent`) retrieves tools and executes them inside a web-based chat interface. Read it before writing Phase 5.

### Events

```ts
document.modelContext.addEventListener("toolchange", () => { /* list changed */ });
```

### Elicitation — `requestUserInteraction()` (spec issue #165) — **VERIFY**

The spec draft describes a `requestUserInteraction()` for host-mediated user input mid-execution. It is the correct home for grant approval (see `SPEC_ISSUES.md` #288), because the host, not the page, can distinguish the human from the automating agent. **Support in Chrome 152 and in ChatGPT's browser is unverified.** In Phase 6:

```ts
const canElicit = typeof document.modelContext?.requestUserInteraction === "function";
```

If present, route the grant through it and keep the page card as fallback. If absent, page card only. Record which you observed, on which surface, in `PHASE1_FINDINGS.md` and the README. Never assume either way.

Fires when the available tool list changes. The palette listens to this so it updates in lockstep with the agent's view — that lockstep is the best beat in the demo video.

### Types

`npm i -D webmcp-types` — TypeScript typings for the imperative API. Use them; do not hand-roll `declare global`.

---

## 4. Declarative API — documented, deliberately unused

Form attributes `toolname` / `tooldescription`, optional `toolparamdescription`, `toolautosubmit`, the `SubmitEvent.agentInvoked` flag and `respondWith()`, `toolactivated` / `toolcancel` window events, and the `:tool-form-active` / `:tool-submit-active` CSS pseudo-classes.

**We do not use any of it** — ChatGPT's browser does not expose declarative tools. Mention in the README that it was evaluated and rejected for that reason; it shows the constraint was understood rather than missed.

---

## 5. Testing surfaces

| Surface | Setup | Use for |
|---|---|---|
| **ChatGPT desktop built-in browser** | Update the app. Model = GPT-5.6 Sol or Terra. Click **Site tools** in the address bar. | **The judging surface. Primary verification target.** Test here at Phase 1 and before every merge. |
| **Chrome 149+** | `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch | Local dev iteration |
| **Model Context Tool Inspector** extension | Chrome Web Store | See registered tools, invoke manually, validate JSON Schema, view structured output. Fastest debug loop. Prompts default to `gemini-3-flash-preview`. |
| **Chrome DevTools → Application → WebMCP** | Built in | Inspect and debug registered tools |
| **Chrome WebMCP evals docs** | `developer.chrome.com/docs/ai/webmcp/evals` | Read before writing `evals/adversarial.md` |

Origin trial registration is available from Chrome 149 if we wanted production-traffic tools without a flag. **Not needed** — judges use ChatGPT's browser or the flag. Skip it.

---

## 6. Character budgets (Chrome's published recommendations)

Enforce these in `defineTool` with a dev-mode assertion so a violation fails loudly at build time rather than degrading agent behaviour silently.

| Item | Limit |
|---|---|
| Tool description | 500 chars |
| Parameter description | 150 chars |
| Tool name | 30 chars |
| Parameter name | 30 chars |
| **Individual tool output** | **1.5K chars** |

The output limit is the one that will bite. `find_providers` must cap at ~5 results with trimmed fields, not return the whole fixture. Truncate with a note (`"showing 5 of 12; narrow the search"`) so the agent knows to refine rather than assuming it saw everything.

---

## 7. Zod 4 → JSON Schema

```ts
import * as z from "zod";

const schema = z.object({
  slot_id: z.string().describe("Slot id from get_availability."),
});

const inputSchema = z.toJSONSchema(schema); // native in Zod 4
type Input = z.infer<typeof schema>;
```

- `z.toJSONSchema()` is **native to Zod 4** — no `zod-to-json-schema` dependency.
- `.describe()` becomes the JSON Schema `description`. This is how parameter descriptions reach the agent, so **every field gets a `.describe()`**.
- Prefer `z.enum([...])` for controlled vocabularies — it produces a JSON Schema `enum`, which both constrains the agent and gives the palette a `<select>` for free.
- **Verify the emitted JSON Schema** for at least one representative tool with the Inspector extension. If Zod emits `$ref`s or `$schema` keys the browser dislikes, flatten them. Check this at Phase 2, not Phase 8.

---

## 8. Stack

| Layer | Choice | Notes |
|---|---|---|
| Build | Vite 6 + React 19 + TS strict | Fastest cold start |
| Schemas | Zod 4 | `z.toJSONSchema` is the whole trick |
| WebMCP types | `webmcp-types` (dev) | |
| Styling | Tailwind | No design decisions at 2am |
| State | Zustand | Registry must subscribe outside the React tree |
| Voice | Web Speech API (`webkitSpeechRecognition`) | Chrome-only, acceptable. ~40 lines. Always pair with the keyboard path — voice is never the only route to a capability. |
| Tests | Vitest | Schema round-trip + the four grant invariants only. No UI tests. |
| Hashing | `crypto.subtle.digest("SHA-256", ...)` | Native. No dependency for `argsHash`. |
| Backend | **none** | Fixture data is a typed TS module |

Do not add a dependency without a one-line justification in the PR body.

---

## 9. Deploy

**Vercel (primary).** Credits redeemed.

```
vercel --prod
```

Framework preset **Vite**, output directory `dist`, no env vars, no serverless functions. First deploy happens at **Phase 1**, not Phase 8.

**Render (fallback).** Static Site, build `npm run build`, publish `dist`. Credits redeemed.

Requirements either way:

- **HTTPS** — both provide it.
- **Do not set `Origin-Agent-Cluster: ?0`.** It disables WebMCP entirely (§1). Neither platform sets it by default; do not add it in `vercel.json`.
- SPA rewrite to `/index.html` if any client routing is added — but prefer no routing at all, since tools belong to the page.
- **One canonical submitted URL.** Do not submit a Vercel URL and keep iterating on a Render one.
- **The URL must stay live through ~Sep 23.** Confirm the Vercel project will not idle, expire, or hit a free-tier pause. This is a submission-validity issue, not an ops detail.

---

## 10. Fixture data shape

Typed TS module in `src/data/`. No backend, no fetch.

- **16 providers** across 4 specialties (rheumatology deliberately runs past `find_providers`' cap of 5, so the "showing N of M" path is exercised by real data). Each carries: `id`, `name`, `specialty`, `languages[]`, `insurance[]`, `accommodations[]`, `interpreter_lead_time_days`, `bio` (prose — treat as untrusted), `location`.
- **Slots generated deterministically** from a seed over a 14-day window, so demos are reproducible and the video can be re-shot without the data shifting. Same discipline as a deterministic reseed in a server fixture.
- **Accommodation vocabulary is a `z.enum`**, exported once, consumed by `list_accommodations`, `find_providers`, and `set_intake`. One vocabulary, three consumers.
- **Coverage rules as data, not code** — an array of `{ id, condition, effect, human_readable }` so `check_coverage` can return the rule path that produced its answer.
- **Deliberate gaps in the fixture**, because the edge cases need somewhere to fire: at least one specialty with zero fully-accessible providers (drives `explain_no_results`), one provider with a long interpreter lead time, one insurance plan with no in-network match.
- At least one provider `bio` contains a **prompt-injection string** for the adversarial eval. Comment it clearly as an intentional test fixture so Qodo and judges do not read it as a mistake.
- **No real names, addresses, phone numbers, or insurance identifiers.** See `CONVENTIONS.md` §1.
