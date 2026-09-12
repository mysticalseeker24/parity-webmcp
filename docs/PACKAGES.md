# PACKAGES.md — extracting the accessibility layer

[`FUTURE.md`](./FUTURE.md) argues that the WebMCP ecosystem has runtime, transport, React bindings and type definitions, and **nothing for accessibility** — and that the pieces which make Parity's thesis true rather than merely stated are all trapped in this repo. This file is the plan for getting them out, in the order the code actually allows rather than the order the idea suggests.

It is a plan, not a commitment. §7 states the condition under which it should not be started.

---

## 1. The rule that governs the whole thing

> **A package extracted from one caller is a guess.**

Every API in this repo has been proven against exactly one app, with one state shape, one domain, one set of tools. That is enough to know the *ideas* are right. It is not enough to know the *interfaces* are.

So the sequencing rule is: **a second consumer comes before the first `npm publish`.** Not a second app necessarily — a second consumer can be a deliberately different test harness, a small demo with a different state shape, or an existing open-source WebMCP site retrofitted. But something other than Parity has to compile against each package before its API is frozen.

The cost of ignoring this is not abstract. Published APIs acquire users; users make breaking changes expensive; and the first version of an interface designed against one caller is reliably wrong in ways only a second caller reveals.

---

## 2. What is actually extractable, measured

Difficulty here is not an opinion. It is the import graph:

| Module | Lines | Imports it pulls in | Extraction difficulty |
|---|---|---|---|
| [`lib/result.ts`](../src/lib/result.ts) | 74 | **none** | Trivial |
| [`lib/schemaForm.ts`](../src/lib/schemaForm.ts) | 125 | one type (`JsonSchema`) | Easy |
| [`lib/defineTool.ts`](../src/lib/defineTool.ts) | 276 | `zod`, `BookingState`, `result` | Moderate — needs the state type genericised |
| [`lib/registry.ts`](../src/lib/registry.ts) | 346 | store, `defineTool`, `result`, `undo`, `webmcpInterop` | Hard — needs the store abstracted |
| [`lib/announcer.ts`](../src/lib/announcer.ts) | 128 | store, registry, `reasons`, `stageFocus`, `result` | Hardest — most app-coupled despite being the smallest idea |

Two things fall out of that table, and both are inconvenient for the version of this plan written from memory:

**The announcer is the most valuable idea and the hardest extraction.** It is the piece nothing else in the ecosystem has, and it is the one most tangled in Parity's store, its reason codes, and its stage vocabulary. It is last, not first.

**`result` is nearly free.** Seventy-four lines, zero imports, and it answers an open spec issue ([#282](https://github.com/webmachinelearning/webmcp/issues/282)). It can be lifted in an afternoon.

---

## 3. The one change that unblocks everything

Every extractable module is parameterised by Parity's `BookingState`. That is the single coupling that matters, and it has one shape of fix:

```ts
// Today — the app's state type is baked in.
available: (state: BookingState) => boolean;

// Extracted — the consumer supplies it.
export interface ToolSpec<TState, TInput, TOutput> {
  available: (state: TState) => boolean;
  unavailableReason: (state: TState) => UnavailableReason;
  execute: (input: TInput, ctx: ExecuteContext) => ToolResult<TOutput> | Promise<ToolResult<TOutput>>;
}
```

The registry needs the same treatment plus a store interface, and the store interface should be the minimum the registry actually uses rather than Zustand's:

```ts
export interface StateSource<TState> {
  getState(): TState;
  subscribe(listener: (state: TState) => void): () => void;
}
```

Zustand satisfies that shape already; so does a hand-rolled emitter, a Redux store, or a signal. **Do this refactor inside this repo first**, before any package exists. If Parity still passes its full suite with `BookingState` supplied as a type argument rather than imported, the extraction is mechanical afterwards. If it does not, the abstraction was wrong and nothing has been published to regret.

---

## 4. The packages

All five names are unpublished on npm as of 2026-09-13 (`webmcp-announce`, `webmcp-result`, `webmcp-schema-form`, `webmcp-state-registry`, `webmcp-a11y`), as is the `@parity` scope. Unscoped names are proposed deliberately: the existing ecosystem packages live under `@mcp-b/`, and an unscoped name does not imply affiliation with a vendor or with the working group.

### 4.1 `webmcp-result` — the envelope

**What it is.** The `ToolResult` envelope: refusals fulfil with `ok: false` and a typed `kind`; only bugs throw. Answers [#282](https://github.com/webmachinelearning/webmcp/issues/282), where the open question is how an agent distinguishes "you may not" from "it broke".

```ts
export type ToolResult<T = unknown> =
  | { ok: true; data: T; human_summary: string }
  | { ok: false; kind: RefusalKind; reason: string; field?: string; next?: string };

export function ok<T>(data: T, human_summary: string): ToolResult<T>;
export function refuse(kind: RefusalKind, reason: string, opts?): ToolResult<never>;
export function isRefusal(r: ToolResult): r is Extract<ToolResult, { ok: false }>;
```

**Moves as-is.** Zero imports today.

**The one design question.** `RefusalKind` is currently Parity's closed union (`invalid_input`, `unavailable`, `grant_expired`, …). A package cannot ship a closed domain vocabulary. Either widen to `string` and lose exhaustiveness, or make it a type parameter with a recommended base set. Prefer the type parameter — exhaustive `switch` over refusal kinds is one of the genuinely nice properties here and is worth preserving for consumers who want it.

**Done when:** Parity imports it instead of `lib/result.ts`, the full suite passes unchanged, and one non-Parity consumer has declared its own `RefusalKind`.

### 4.2 `webmcp-schema-form` — schema to accessible form

**What it is.** JSON Schema (or Zod, via `z.toJSONSchema`) → a field list a UI can render, where **the accessible name is the parameter description**. Answers [#286](https://github.com/webmachinelearning/webmcp/issues/286): one string, so the label a person hears and the description an agent reads cannot drift.

```ts
export function fieldsFromSchema(schema: JsonSchema): FormField[];
export function valuesToArgs(fields: readonly FormField[], values: Record<string, unknown>): unknown;
```

**Deliberately headless.** It returns a field list, not JSX. Parity's renderer stays in Parity. This is what makes it usable from React, Vue, Lit or vanilla, and it keeps the package out of the business of styling anyone's forms.

**Must carry the interop lessons.** `readInputSchema` handling Chrome's string-encoded `inputSchema`, and the `encodeToolArgs` JSON-string argument encoding, belong here or in a sibling. They are [documented findings](../.agent/PHASE1_FINDINGS.md) that every implementer rediscovers painfully.

**Done when:** it renders a form for a tool whose schema Parity has never seen — the property the palette already has and must not lose.

### 4.3 `webmcp-state-registry` — registration as a function of state

**What it is.** `available(state)` registration, the `AbortController` lifecycle, `unavailable[]` with `reason_code` and `unlock_by`, and the [#300](https://github.com/webmachinelearning/webmcp/issues/300) guard. Answers [#255](https://github.com/webmachinelearning/webmcp/issues/255) and [#262](https://github.com/webmachinelearning/webmcp/issues/262).

```ts
export function startRegistry<TState>(
  tools: readonly DefinedTool<TState>[],
  source: StateSource<TState>,
  options?: { maxLive?: number; onChange?: (diff: ToolChange) => void },
): Registry;
```

**The valuable part is the part nobody expects.** Not `filter(t => t.available(state))` — that is four lines anyone writes. It is the accumulated correctness around it: never unregistering a tool mid-execute, publishing what the browser actually holds rather than what is legal, giving every absent tool a machine-readable reason, and the dev-time cap assertion. Those were each a bug first.

**Carries a deletion date.** The #300 guard exists because Chrome 152 is the shipping stable build; CL 8224887 fixed it in 153. The package must say so in the code, or it becomes permanent by inertia. See [the WPT case](https://github.com/web-platform-tests/wpt/pull/62642).

**Done when:** it drives Parity unchanged, and a second consumer with a different state shape registers tools through it.

### 4.4 `webmcp-announce` — the part nothing else does

**What it is.** Every tool execution emits an `aria-live` announcement derived from the tool's own `announce()`, naming the actor. WCAG 2.2 [4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), and the answer to the fact that when an agent fills a form today a screen-reader user is told **nothing**.

```ts
export function createAnnouncer(opts: {
  politeness?: "polite" | "assertive";
  actorLabel?: (actor: Actor) => string;   // i18n, and the honesty below
}): { announce(entry: AuditEntry): void; region: HTMLElement };
```

**Three things must be untangled first**, and they are why this is last:

1. **Reason codes.** `reasons.ts` is Parity's vocabulary. The package takes a lookup function; it does not ship healthcare booking strings.
2. **Stage sentences.** `stageFocus.ts` is pure Parity. Stays behind.
3. **Actor attribution.** Ships with the limitation attached, not silently. `executeTool()` carries no caller identity ([#96](https://github.com/webmachinelearning/webmcp/issues/96), [#277](https://github.com/webmachinelearning/webmcp/issues/277)), so the actor is inferred. The default `actorLabel` should be honest about that, and the README must say so rather than let consumers ship "Agent did X" as though it were known.

**Ships with wording guidance or it does harm.** A live region that announces too much is worse than one that announces nothing — it makes a page unusable with a screen reader. The package needs documented rules about what not to announce, and it must not be published before §5's real screen-reader run has happened.

### 4.5 `webmcp-a11y` — the meta-package

A single install that pulls the four and re-exports them, for the common case. Worth it only if the four actually compose cleanly, which is unknown until they exist. **Decide after 4.4, not now.**

---

## 5. The gate nobody should move

**None of this ships before [`SCREEN_READER.md`](./SCREEN_READER.md) has been run and its results recorded.**

Parity's accessibility is currently verified by markup review, axe-core over every stage, and the accessibility tree Chrome exposes. All of that establishes that a violation is not *detectable*. It does not establish that the page is usable, that announcements land at useful moments, or that the reading order makes sense.

Publishing an accessibility package whose accessibility has only been inferred would repeat, as a dependency other people take on, exactly the mistake this project exists to criticise. `webmcp-announce` is the sharp end of that: it is a package whose entire output is speech.

---

## 6. The walkthrough

Each step ends in a state that is safe to stop at.

**Step 0 — genericise in place.** No packages. Replace `BookingState` with `TState` through `defineTool` and `registry`, introduce `StateSource<TState>`, keep everything in `src/lib/`. Full suite must pass unchanged. *This is the step that tells you whether the rest is worth doing.*

**Step 1 — a second consumer, still in-repo.** A minimal second tool set with a different state shape, under `src/dev/`, driving the same registry. Not published, not shipped. It exists to break the abstraction while breaking it is free. Expect to go back to Step 0.

**Step 2 — `webmcp-result`.** Smallest, zero-dependency, publishable alone. Establishes the repo layout, build, types, release and docs conventions once, on the package where a mistake costs least.

**Step 3 — `webmcp-schema-form`.** Carries the interop findings. Parity's palette becomes its second consumer, and the "renders a tool it has never seen" test comes with it.

**Step 4 — `webmcp-state-registry`.** The bulk. Parity drives it unchanged; the second consumer from Step 1 drives it differently. The WPT case stays upstream, referenced.

**Step 5 — screen reader.** §5's gate. Fix what it finds. Do not proceed on a clean sheet you have not earned.

**Step 6 — `webmcp-announce`.** Only now.

**Step 7 — decide on `webmcp-a11y`.** By this point you know whether the four compose.

### Tooling, decided once at Step 2

- **A separate repo**, not this one. Parity is a hackathon submission with a fixed history and a video pointing at it; a package repo has a different lifecycle, different CI, and different reviewers.
- **One repo, multiple packages** (npm workspaces). They share types and are released together early on.
- **Parity depends on them via `file:` during development**, so an API mistake shows up as a failing Parity test before it shows up as a published version.
- **No framework dependency anywhere.** React lives in Parity. The packages are DOM-and-types only, or they exclude most of the ecosystem on arrival.

---

## 7. When not to do this

Stop and do something else if any of these hold:

- **Step 0 does not come out clean.** If genericising over `TState` requires contorting Parity, the abstraction is wrong and no amount of packaging fixes it.
- **The second consumer is imaginary.** If Step 1 is a shape invented to satisfy Step 1, it validates nothing. A real second caller with real requirements, or wait.
- **The screen-reader run has not happened.** §5. Not negotiable for `webmcp-announce`.
- **The spec moves underneath it.** [#282](https://github.com/webmachinelearning/webmcp/issues/282) may standardise a refusal envelope; [#255](https://github.com/webmachinelearning/webmcp/issues/255)/[#306](https://github.com/webmachinelearning/webmcp/issues/306) may standardise grouping. If either lands, the corresponding package should become a thin adapter over the standard shape or should not exist. **Publishing a competing vocabulary while the standard one is being decided is actively unhelpful** — the contribution is to the spec threads, which is already happening.

The honest summary: `webmcp-result` and `webmcp-schema-form` are worth extracting on their merits and are nearly free. `webmcp-state-registry` is worth it if a second real consumer appears. `webmcp-announce` is the one the ecosystem actually lacks, and it is the one that must not be rushed, because it is the one where getting it wrong degrades a disabled user's experience rather than a developer's.
