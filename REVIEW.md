# REVIEW.md — Review instructions for `parity-webmcp`

Instructions for automated reviewers (Qodo Merge, Claude Code Review). Read `.agent/CONVENTIONS.md` for the full standard; this file calibrates severity and focus.

## What this project is

A specialist-care booking SPA built for the OpenAI WebMCP Challenge. Its architectural claim is that there is **exactly one tool registry**, and both the AI agent (via the browser's WebMCP client) and the human command palette (via `document.modelContext.getTools()` / `executeTool()`) are callers of it. It is also an accessibility product: shipping an accessibility defect refutes the thesis.

No backend, no database, no auth, no secrets. Client-side only. Fixture data is synthetic by design.

## Escalate these to High

1. **Duplicate sources of truth.** A hand-written JSON Schema, a second TS interface describing a tool input, or a human-only command list that is not a registered tool. One Zod schema per tool is the only permitted description of its input.
2. **`document.modelContext.registerTool` called outside `src/lib/registry.ts`.** All tools must be authored via the `defineTool` factory.
3. **`navigator.modelContext` used anywhere.** The namespace moved to `document.modelContext` in Aug 2026; the old one fails silently.
4. **Grant-gate bypass.** Any path from `confirm_booking` / `cancel_booking` / `reschedule_booking` to committed state that does not validate, at execution time, that the grant exists, is approved, is unexpired, and its `argsHash` matches the current arguments. Also flag any tool that could approve a grant — approval must be out-of-band, human-initiated UI only.
5. **Tool annotations used as enforcement.** `readOnlyHint` / `untrustedContentHint` are advisory signals to the agent. If a security or correctness decision reads them, that is a defect.
6. **Accessibility defects.** Missing `<label for>`, `outline: none` without a stronger replacement, keyboard traps, `<div>` acting as a button, interactive element unreachable by keyboard, live region not firing on a state change, information conveyed by colour alone, calendar grid without a full arrow-key/Enter/Escape model.
7. **A tool execution that does not emit an `aria-live` announcement.** Every execution announces, including agent-initiated ones, with the actor named.
8. **Missing or non-specific error handling in an `execute`.** Errors must name the offending field and what a valid value looks like so the model can self-correct.
9. **Unhandled promise rejections. Timers not cleared** on unmount or state transition.
10. **Any secret, real patient data, real clinic name, real address, real phone number, or real insurance identifier.**

## Medium

- `any`, implicit `any`, unchecked index access
- Character budget violations: tool description >500 chars, parameter description >150, tool/param name >30, tool output >1.5K
- `available(state)` predicates that are impure, async, or read wall-clock time directly
- Tools with overlapping purpose, or descriptions written as prohibitions ("do not use this for…") rather than positive capability statements
- Missing `.describe()` on a Zod field — parameter descriptions reach the agent only through it
- Dependencies added without justification in the PR body

## Do not escalate — these are deliberate

- **Fixture data is synthetic and thin.** Intentional.
- **A prompt-injection string appears in a provider `bio` in `src/data/`.** It is an intentional adversarial test fixture for `evals/adversarial.md`, clearly commented. Do not report it as a vulnerability or ask for its removal.
- **No backend, database, auth, persistence, or serverless functions.** Architecturally deliberate; a backend is explicitly out of scope.
- **Booking state resets on reload.** Deliberate; documented in the README.
- **No UI/component tests.** Deliberate scope decision. Tests cover schema round-trips and the four grant invariants only.
- **The Declarative (HTML form) WebMCP API is unused.** ChatGPT's built-in browser does not expose declarative tools; the imperative API is the only viable path.
- **No cross-origin `exposedTo` / `fromOrigins` usage, and no iframes.** ChatGPT's browser does not discover tools in iframes.
- **Voice input is Chrome-only** (Web Speech API). Acceptable; the keyboard path is always available as an equivalent.
- Styling, visual polish, and design-system consistency.

## Tone

Concise, actionable, ordered by severity. Prefer a concrete diff suggestion over a description of the problem. This is a time-boxed hackathon build with a hard deadline of Sep 3, 2026 — flag what is genuinely wrong, and skip stylistic preference.
