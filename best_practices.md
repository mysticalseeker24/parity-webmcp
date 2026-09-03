# best_practices.md — `parity-webmcp`

Standards the `/improve` reviewer enforces. Violations should be flagged under "Organization best practices". The full rationale is in `.agent/CONVENTIONS.md`.

## One source of truth per tool

- Every tool is authored through the `defineTool` factory in `src/lib/defineTool.ts`. Never call `document.modelContext.registerTool` outside `src/lib/registry.ts`.
- Exactly one Zod schema describes a tool's input. Derive TypeScript types with `z.infer`; derive JSON Schema with `z.toJSONSchema()`. Never hand-write either.
- Never write a command available to humans that is not a registered tool, or vice versa. Asymmetry between the two surfaces is a defect.
- The command palette reads `document.modelContext.getTools()` and executes via `executeTool()` when available. Reading the internal registry is the no-WebMCP fallback path only.

## Tool registration is derived, never imperative

- `liveTools = allTools.filter(t => t.available(state))`, diffed by the registry on store change. Never register or unregister from a component, event handler, or `useEffect`.
- `available(state)` predicates are pure and synchronous. No side effects, no async, no direct `Date.now()`.
- Unregister with the `AbortController` that registered the tool. Never leave an orphaned controller.

## Enforcement is structural

- `readOnlyHint` and `untrustedContentHint` are honest signals to the agent, never security controls. No correctness decision may read them.
- Gated tools re-validate the grant at execution time: exists, approved, unexpired, and `argsHash` matches the current arguments. Never trust an earlier decision.
- No tool may approve a grant. Approval is human-initiated page UI only.
- Illegal operations are prevented by *absence of registration*, not by a runtime error inside a registered tool.

## Errors are actionable by a model

- Every `execute` handles its own failures and returns a descriptive error. No unhandled rejections.
- Errors name the offending field, the constraint, and a valid example. `"dob must be ISO 8601 (YYYY-MM-DD); received '14/10/2026'"` — not `"invalid input"`.
- Never report success unless the state actually changed and the code verified it.
- Never leak an internal path or stack trace into a tool result.
- Long-running tools honour the `AbortSignal` passed as `execute`'s second argument.

## Accessibility is functional, not cosmetic

- Semantic HTML first: `<button>` for actions, `<a>` for navigation, real `<label for>` on every input.
- Every interactive element reachable and operable by keyboard, in visual order, with a visible focus indicator. No keyboard traps. Never `outline: none` without a stronger replacement.
- Every tool execution emits an `aria-live` announcement via the tool's own `announce()`, naming the actor. `polite` for reversible operations, `assertive` for grant requests and errors.
- Never convey state by colour alone.
- Respect `prefers-reduced-motion`.
- Text contrast ≥ 4.5:1; large text and UI boundaries ≥ 3:1.

## Budgets (Chrome's published WebMCP limits)

- Tool description ≤ 500 chars · parameter description ≤ 150 · tool and parameter names ≤ 30 · single tool output ≤ 1.5K chars.
- Truncate long result sets and say so in the payload (`"showing 5 of 12; narrow the search"`) so the agent refines rather than assuming completeness.
- Every Zod field carries `.describe()` — it is the only route a parameter description takes to the agent.

## TypeScript and React

- `strict: true`. No `any`, implicit or explicit. No unchecked index access.
- Named exports except React page components.
- Modules stay under ~200 lines; past that it is doing two jobs.
- Timers cleared on unmount and on state transition.
- No `localStorage` for booking state; it is an in-memory demo by design.
- No dependency added without a one-line justification in the PR body.

## Data

- Fixture data is synthetic. No real names, addresses, phone numbers, clinic names, or insurance identifiers.
- Slots are generated deterministically from a seed so demos are reproducible.
- The accommodation vocabulary is one exported `z.enum`, consumed by every tool that touches accommodations.
- Coverage rules are data, not branches, so `check_coverage` can return the rule path that produced its answer.

## Claims

- Never state a measured result that was not observed. The project's thesis is a design argument demonstrated by the running app, not a benchmark.
- WebMCP is a proposed standard — a W3C Community Group draft in a Chrome origin trial. Never describe it as ratified.
