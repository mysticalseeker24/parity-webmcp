# CLAUDE.md — parity-webmcp

This is the operating manual for Claude Code working in this repository. Read it fully before doing anything. It is short on purpose. The detail lives in `.agent/`.

---

## What this project is

**Parity** is a specialist-care booking app built for the OpenAI WebMCP Challenge. Every capability of the app is reachable three ways — the visual interface, a keyboard/voice command surface, or an AI agent — and all three drive the **same WebMCP tool registry**.

The product argument, verbatim for README and video:

> Building your website for agents is how you finally make it usable by the humans your interface locked out. It is the same work, not two projects.

The domain is deliberate. Booking specialist care is a constraint-satisfaction problem (insurance × language × physical accessibility × interpreter × paratransit window × caregiver availability × appointment length) that no booking UI lets you express at once — and the people with the most constraints are the same people most often blocked by calendar grids and custom dropdowns that have no keyboard path. One tool registry serves both.

**The one rule that governs the whole architecture: there is exactly one tool registry, and both the agent and the human command surface are callers of it.** The human palette does not read a parallel list of commands. It calls `document.modelContext.getTools()` — the same discovery API the agent uses — and executes via `document.modelContext.executeTool()`. If you ever find yourself writing a second command list, a second schema, or a second execute path for humans, stop. That duplication *is* the bug, and removing it is the entire thesis.

---

## How the connection works (read this before you assume anything)

There is **no MCP server, no transport, no deployment target beyond a static site.** This is not like a stdio or Streamable-HTTP MCP server.

1. We deploy a static SPA. No backend, no API routes, no MCP endpoint.
2. The user opens that URL in the **ChatGPT desktop app's built-in browser**, or Chrome 149+ with `chrome://flags/#enable-webmcp-testing`.
3. Our page's JS calls `document.modelContext.registerTool(...)`. Tools are now registered **with the browser**, scoped to that tab.
4. The browser surfaces them under **Site tools** in the address bar.
5. The agent, in the panel beside the page, calls a tool. The browser routes the call into our page and invokes our `execute` closure.
6. Our closure mutates app state. The UI updates in front of the user. The return value goes back to the agent.

Same tab, same DOM, same session, same cookies. The browser is the MCP client; our page is the server. See `.agent/TOOLS.md` §1 for the exact API surface and the platform limitations that follow from this.

---

## Read these before writing code

Full specifications live in `.agent/`. Load the ones relevant to the current task. Do not hold all of them in context at once.

| File | Read it when |
|---|---|
| `.agent/PROJECT_SPEC.md` | Always, first. Architecture, tool inventory, state machine, build phases, cut lines. |
| `.agent/CONVENTIONS.md` | Before writing any code. Coding, accessibility, and tool-authoring rules. Non-negotiable. |
| `.agent/TOOLS.md` | Before touching WebMCP, Zod schemas, the browser, or deploy. Exact verified API surfaces. |
| `.agent/QODO.md` | Before opening any PR. How the review gate works and what a clean PR looks like. |

When a task spans several, read `PROJECT_SPEC.md` first for the shape, then the specific file for the detail.

---

## How we work

1. **One PR per phase. Never batch.** Each phase in `PROJECT_SPEC.md` §8 is a scoped branch, reviewed by Qodo, findings resolved, then merged.
2. **Riskiest unknown first.** Phase 1 is a throwaway spike that proves tool registration works in ChatGPT's browser. Nothing else is built until that is verified with your own eyes. If registration does not work, every other line of code is worthless.
3. **Every PR leaves a working system.** No phase should leave `main` broken or the deployed URL down.
4. **State assumptions out loud.** If a spec is ambiguous, say what you are assuming and why before building on it. Do not silently guess.
5. **Explain every technical decision.** Leave a one-line rationale in the PR description for anything non-obvious.
6. **Respect the cut line.** `PROJECT_SPEC.md` §9 defines the minimum viable submission and the exact order in which features get dropped. When time runs short, cut from the bottom — never from the middle.

---

## Hard boundaries (do not cross)

- **Do not build a backend.** No API routes, no database, no auth server, no serverless functions. Fixture data is a typed TS module. A backend is the single biggest time sink available and buys nothing for this submission.
- **Do not build two of anything.** One `defineTool` factory, one Zod schema per tool, one execute path, one registry. See `CONVENTIONS.md` §3.
- **Do not use the Declarative (HTML form) API.** ChatGPT's built-in browser does not expose declarative tools. Imperative JS only.
- **Do not register tools inside an iframe.** ChatGPT's browser does not discover them, same-origin or not. Top-level page only.
- **Do not use `navigator.modelContext`.** The getter moved to `document.modelContext` in August 2026. Any training-data memory or blog post using `navigator` is stale and will silently fail.
- **Do not rely on tool annotations for enforcement.** `readOnlyHint` and `untrustedContentHint` are honest signals for the agent, never a security control. Enforcement is the grant gate plus state-machine registration. See `CONVENTIONS.md` §5.
- **Do not claim a result we have not observed.** No "100% of injection attempts blocked" unless `evals/adversarial.md` records the runs. See `CONVENTIONS.md` §9.
- **Do not commit secrets.** There should be none in this project. If one appears, something is architecturally wrong.

---

## Definition of done for any task

- TypeScript strict, no `any`, builds clean.
- Every tool authored through `defineTool` — never a bare `registerTool` call.
- One Zod schema per tool, used for registration, palette form, and runtime validation.
- Every tool execution emits an `aria-live` announcement with the correct actor.
- Character budgets respected (`TOOLS.md` §6).
- The deployed URL still works in ChatGPT's built-in browser.
- Human palette can still complete the full booking flow with keyboard only, no agent.
- PR opened, Qodo reviewed, High findings resolved or reasoned-away in thread.
