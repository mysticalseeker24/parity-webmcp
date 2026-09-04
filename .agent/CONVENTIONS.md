# CONVENTIONS.md — Coding, Accessibility & Tool-Authoring Standards

Non-negotiable rules for all code in `parity-webmcp`. Qodo reviews against many of these (see `QODO.md` and `best_practices.md`), so following them here means fewer review cycles. Two audiences read this: Claude Code (follow it) and Qodo (enforces it).

A note on the stakes that is also the pitch: this is an accessibility product. Code that ships a keyboard trap, an unlabelled control, or a live region that does not fire damages the entire thesis. A booking app that an agent can drive but a screen-reader user cannot is the exact failure Parity exists to name. Hold a higher bar here than on an ordinary hackathon project.

---

## 1. Secrets

There should be **no secrets in this project at all.** No backend, no API keys, no auth, no database. If you find yourself needing a secret, stop — the architecture has drifted.

1. **Never commit a secret**, ever. Hackathon disqualifier and credibility killer.
2. `.env` is gitignored before the first commit. If an `.env.example` becomes necessary, keys named, values blank.
3. Fixture data is synthetic. **No real patient names, real clinic addresses, real phone numbers, or real insurance IDs** — not even plausible-looking ones scraped from a real directory. Invent everything. This is a medical-adjacent demo; a real-looking record in a public repo is a privacy problem regardless of whether it is real.
4. No secret on camera. Scrub the browser profile and any personal data before recording.

---

## 2. Language, runtime, style

- **TypeScript strict everywhere.** `"strict": true`, `noUncheckedIndexedAccess`, no implicit or explicit `any`. If you reach for `any`, the type is wrong.
- **Node 22+**, npm. React 19, Vite 6+.
- Prettier + ESLint, run before every commit. Configs minimal and standard.
- **Prefer explicit over clever.** Judges — including the creator of MCP-B and a Chrome Distinguished Engineer — will read `defineTool.ts` and `registry.ts`. Optimize for legibility, not brevity.
- No dead code, no commented-out blocks left in. If unused, delete it.
- Files stay small. If a module passes ~200 lines, it is doing two jobs.
- Named exports over default exports, except React page components.

---

## 3. The single-source-of-truth rule (the most important rule here)

**Every tool is authored through `defineTool`. Never call `document.modelContext.registerTool` directly outside `registry.ts`.**

One `defineTool` spec fans out to six consumers:

1. WebMCP registration — `inputSchema: z.toJSONSchema(spec.schema)`, plus `annotations`
2. The human command palette — a form generated from the same schema
3. The voice grammar — `voiceAliases` plus enum values read off the schema
4. Runtime validation — `spec.schema.parse(input)` inside execute, whoever the caller is
5. The `aria-live` announcement — via `spec.announce(input, result)`
6. The audit log and undo stack — with an `actor` field

Rules that follow:

- **One Zod schema per tool.** It is the only description of that tool's input that exists. Never hand-write a JSON Schema. Never write a second TypeScript interface describing the same shape — derive it with `z.infer`.
- **Never write a human-only command** that does not exist as a tool. If a human can do it, an agent can, and vice versa. Asymmetry is the bug.
- **The palette must call `getTools()` and `executeTool()`**, not the local registry object, whenever `document.modelContext` is available. Reading the local registry is the fallback path only. This is what makes "one registry, two callers" literally true rather than a marketing line — and it is the thing worth showing a judge in the code.
- **Never register imperatively from a component or event handler.** Registration is a pure function of store state: `liveTools = allTools.filter(t => t.available(state))`, diffed by the registry on subscribe.

---

## 4. Tool authoring

- **One tool, one job.** Chrome's guidance: overlapping tools make the agent pick wrong. If two tools could plausibly serve the same request, merge them or make the boundary explicit in both descriptions.
- **Name for what happens.** `hold_slot` holds. `confirm_booking` commits. Distinguish execution from initiation — if a tool opens a form rather than doing the thing, say so in the name and description.
- **Positive descriptions.** Describe what the tool does and when to use it. Do not write "do not use this for X" — limitations should be implicit in a well-written description.
- **Accept raw user input.** Do not ask the agent to compute. `"10:30 to 11:00"` is an acceptable string; asking the model for elapsed minutes is not.
- **Natural language over IDs in the schema surface.** `accommodation: "wheelchair_accessible"` from a documented enum, never `accommodation_id: 3`.
- **Explain the why in descriptions**, not just the what. It helps the agent choose well.
- **Return enough to verify.** A result the agent cannot check is a result it will hallucinate around. Return the resulting state, not just `"ok"`.
- **Validate strictly in code, loosely in schema.** Schema constraints are helpful but not guaranteed. Put real validation in `execute` and return descriptive errors naming the offending field so the model can self-correct and retry.

---

## 5. Enforcement is structural, never advisory

- **`readOnlyHint` and `untrustedContentHint` are honest signals to the agent. They are never a security control.** The MCP specification warns that clients must treat tool annotations as untrusted; OpenAI's own WebMCP docs state that a tool's claim it only reads data is not proof of what it does. Annotate truthfully *and* enforce independently.
- **Two enforcement mechanisms, both structural:**
  1. **State-machine registration.** If a tool is not legal in the current state, it is not registered, so it cannot be called. Not "returns an error" — does not exist.
  2. **The grant gate.** No code path from `confirm_booking` to a committed booking without a valid, unexpired, argument-matched, approved grant.
- **Re-validate at execution time.** Never trust a decision made earlier in the flow. Re-read grant state at commit; re-check slot availability at commit.
- **Never add a tool that approves a grant.** The approval channel must be one the agent cannot originate, render, or replay. If an agent can approve its own request, the gate is decoration.
- **Never claim page-side approval is sufficient.** Spec issue #288 records ChatGPT's browser clicking a page's own Approve button after calling a proposal-only tool. A page cannot tell that click from the operator's. Parity's position, stated in code comments and the README: page approval is *necessary, not sufficient*; the host's confirmation is the second layer; the audit trail records `delta_ms`, `isTrusted`, and modality so automated approvals are at least visible; the durable fix belongs in the user agent (#165). See `SPEC_ISSUES.md`.
- **Never defeat automation with an accessibility failure.** No CAPTCHAs, hidden challenges, timing puzzles, or "prove you're human" steps on the approval path. They would exclude the users this product exists for. The 1.5 s dwell is the ceiling, and it is announced.
- **Refusals fulfil, bugs throw.** A tool that *decides* not to act returns `{ ok: false, kind, reason }` (#282). Only genuine defects reject the promise.
- **Treat all provider-submitted prose in fixtures as hostile.** It is where the injection cases live. Never interpolate it into a tool description, never `eval` it, and mark tools that return it with `untrustedContentHint`.

---

## 6. Accessibility (this is the product, not a checklist)

Target WCAG 2.1 AA. Non-negotiable items:

- **Every interactive element is reachable and operable by keyboard.** Tab order follows visual order. No keyboard traps. Test the whole booking flow with the mouse unplugged before calling any phase done.
- **Visible focus indicators everywhere.** Never `outline: none` without a stronger replacement.
- **One `aria-live` region**, `role="status"` / `aria-live="polite"`, plus an `assertive` region for grant requests and errors. Announcements come from `spec.announce()` — never hand-written at the call site, or they will drift.
- **Announce agent actions.** Every tool execution announces, including agent-initiated ones, with the actor named: *"Agent selected Dr. Amara Okafor…"*. This is the second contribution of the project; if it silently stops firing, the submission loses its edge.
- **Semantic HTML first.** `<button>` for actions, `<a>` for navigation, real `<label for>` on every input, `<table>` with headers for the calendar grid. Reach for ARIA only when semantics genuinely run out.
- **The calendar grid needs a real keyboard model** — arrow keys move, Enter selects, Escape closes, and the current cell is announced. This is the control the whole product argument is built on; it must be exemplary.
- **Never rely on colour alone.** Availability, holds, and errors all need a text or icon signal too.
- **Respect `prefers-reduced-motion`.** No animation on state changes for users who opt out.
- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries.
- The command palette itself must be screen-reader-usable: labelled combobox, announced result count, `aria-activedescendant` on the listbox.

---

## 7. Error handling

- **Every `execute` is wrapped.** No unhandled rejections. A thrown error inside a tool must become a descriptive returned error, not a crash.
- **Fail loud, fail specific.** Name the field, the constraint, and what a valid value looks like. `"dob must be ISO 8601 (YYYY-MM-DD); received '14/10/2026'"` beats `"invalid input"` because the model can act on the first.
- **Never let a tool report success without doing its job.** Return success because the state actually changed and you checked it — not because the function reached its last line.
- **Timeouts on anything that can hang.** `watch_earlier_slot` must honour the `AbortSignal` passed as `execute`'s second argument.
- **Never leak an internal path or stack trace into a tool result.** The agent will surface it to the user verbatim.
- **Feature-detect before use.** `if (typeof document.modelContext?.registerTool === "function")`. Everything degrades to a working visual app when it is absent.

---

## 8. State, store, and React

- **Zustand as the single store.** The registry subscribes to it outside the React tree; components subscribe inside.
- **`available(state)` predicates are pure.** No side effects, no async, no `Date.now()` reads outside a passed clock value — the registry calls them on every store change.
- **No `localStorage` for booking state.** It is a demo; state lives in memory and resets on reload. That is a feature, not a gap — say so in the README.
- **Timers are cleaned up.** Hold expiry and grant expiry both create timers; both must clear on unmount and on state transition. Leaked timers cause a tool to unregister during the video.
- **No `useEffect` that registers tools.** See §3.

---

## 9. Claims discipline

- **Never state a result that has not been observed.** No "blocks 100% of prompt injections", no invented percentages, no "measured" anything unless `evals/adversarial.md` records the actual run.
- The thesis — that agent-readiness and accessibility are the same work — is a **design argument demonstrated by the running app**, not a benchmark. Phrase it that way everywhere.
- The agentic-a11y regression claim is an **observation about current behaviour**. It is fair to say screen-reader users are not notified when an agent mutates the page, and that Parity announces it. It is not fair to characterise any specific product's compliance.
- If the eval showed a model doing something surprising, **record it as it happened.** An honest recorded failure is stronger than a clean claim nobody can check.
- Do not overstate WebMCP's standing. It is a **W3C Community Group draft in a Chrome origin trial**, not a ratified standard. Say "proposed standard".

---

## 10. Git and PR hygiene

- Branch per phase: `pr/<phase-name>` per `PROJECT_SPEC.md` §8.
- Conventional-ish commit subjects, imperative mood, under ~72 chars.
- **Never push straight to `main`.** Every substantive change goes through a Qodo-reviewed PR (`QODO.md`).
- Every PR body states: what changed, why, and any assumption made. One-line rationale for anything non-obvious.
- **Every PR leaves `main` deployable and the live URL working.**
- Commit history must show the work happened inside the submission window (Aug 25 – Sep 3). Do not squash the whole build into one commit — the trail is evidence of eligibility.
- **After the submission deadline, stop committing to `main`.** Fork to keep building. Editing a submitted repo during judging risks eligibility.
