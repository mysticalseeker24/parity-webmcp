# FUTURE.md — where Parity goes next

Parity was built to make one argument: *building your website for agents is how you finally make it usable by the humans your interface locked out.* The submission proves it in one app. This file records what would have to happen for it to hold beyond one app — and what has already been learned that is worth giving back.

Nothing here is a claim about the submission. Everything below is unbuilt.

---

## 1. Extract the accessibility layer as packages

The WebMCP ecosystem already has runtime, transport, React bindings and type definitions. It has **nothing for accessibility.** Every part of Parity that makes the thesis true rather than merely stated is currently trapped in this repo:

| Proposed package | What it lifts out | Why it does not exist elsewhere |
|---|---|---|
| `webmcp-announce` | The `aria-live` layer: every tool execution announces itself, naming the actor, in wording taken from the tool's own `announce()` rather than a call site | When an agent fills a form today, a screen-reader user is told nothing. This is the fix, and it is generic |
| `webmcp-schema-form` | Zod (or JSON Schema) → an accessible form where the accessible name **is** the parameter description, per [#286](https://github.com/webmachinelearning/webmcp/issues/286) | The two cannot drift because there is one string. Any site with a tool registry gets a keyboard command surface for free |
| `webmcp-result` | The `ToolResult` envelope: refusals fulfil with `ok: false, kind`, only bugs throw ([#282](https://github.com/webmachinelearning/webmcp/issues/282)) | Agents currently cannot distinguish "you may not" from "it broke" |
| `webmcp-state-registry` | `available(state)` registration with `reason_code` / `unlock_by` for every non-live tool ([#255](https://github.com/webmachinelearning/webmcp/issues/255), [#262](https://github.com/webmachinelearning/webmcp/issues/262)) | Includes the skip that fixes [#300](https://github.com/webmachinelearning/webmcp/issues/300) — a bug every state-driven registry has and most have not noticed |

**The honest caveat.** Extracting a package means committing to an API surface, and the API here has been proven against exactly one app. The right order is: a second consumer first, then extraction from what the two have in common. A package extracted from one caller is a guess.

**The full plan is in [`PACKAGES.md`](./PACKAGES.md)** — ordered by measured import coupling rather than by how good each idea sounds, which reverses the obvious order: `result` is 74 lines with zero imports and nearly free, while the announcer is the thing the ecosystem lacks *and* the most app-tangled, so it goes last. It also records the gate: nothing ships before a real screen-reader run, because publishing an accessibility package whose accessibility is only inferred would repeat the mistake this project criticises.

**The `defineTool` factory is deliberately not on that list.** It is the one piece that is genuinely app-shaped — it knows about voice aliases, undo, and audit because *this* app needs them. It should stay a pattern to copy, not a dependency to take.

---

## 2. Answer the spec issues Parity has not answered yet

Parity already ships answers to, or measurements for, [#255, #262, #277, #278, #282, #286, #288, #298, #299, #300, #306](../README.md#designed-against-the-open-spec-issues). These are open and unanswered here:

- **[#298](https://github.com/webmachinelearning/webmcp/issues/298) — page-enforced write boundaries.** Enforcement by absence and argument-bound grants are contributed there, but both are per-action. A declared *budget* — "at most one booking per session, no cancellations without a fresh grant" — is a different and probably better primitive, and the natural next layer above the gate. Not built.
- **[#299](https://github.com/webmachinelearning/webmcp/issues/299) — results when the caller aborts.** Measured on both sides of the Chromium fix: 152 threads no signal so a write loop runs to completion, 153 stops it partway. Parity is not exposed to the worst of this — no tool here loops over writes — but nothing here observes the signal on 153 either, which is now a real gap rather than an impossibility. Two things the spec question leaves open once a tool *can* stop: its partial result is still discarded, and the caller's abort reason never reaches the tool, so a tool cannot say why it stopped. Whether a *committed* booking should still be delivered to a caller who walked away is the same question in our domain. It should.
- **[#303](https://github.com/webmachinelearning/webmcp/issues/303) — tool aliases.** Parity has `voiceAliases`, which is the same idea solved privately. If the spec adopts aliases, the voice grammar should be derived from the registered aliases instead of a parallel field — one less place for a vocabulary to drift.
- **[#305](https://github.com/webmachinelearning/webmcp/issues/305) — parallel completion steps.** Relevant to the #300 fix: "skip the unregistration of a tool that is currently executing" assumes the set of executing tools is well defined at sync time. If completion steps run in parallel that needs re-testing rather than assuming.
- **[#306](https://github.com/webmachinelearning/webmcp/issues/306) — namespaces / groups.** Parity already groups every tool and derives the live set from state. If the spec adds agent-side filtering, the page-side and agent-side mechanisms need to agree on what a group *is*, or sites will declare one taxonomy and agents will filter by another.

---

## 3. Accessibility: what is conformed to, and what is still owed

Parity targets **WCAG 2.2 Level AA**. Cited by criterion so the claim is checkable rather than atmospheric. What each maps to in this build is recorded in [`scripts/a11y-smoke.md`](../scripts/a11y-smoke.md).

### Addressed

| Criterion | Level | Where |
|---|---|---|
| [1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | AA | Measured, not estimated: indigo on cream 12.32:1, ink-on-peach 5.42:1, deep terracotta (error text, links) 5.31:1 on cream and 4.81:1 on the deeper panel. Peach itself is 2.27:1 and carries no text. Enforced by `npm run audit:a11y` over every stage, a rendered refusal included — it was added because the terracotta previously measured 3.09:1 while its own comment claimed 4.6:1 |
| [2.1.1 Keyboard](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html) | A | The whole booking completes by keyboard alone, twice over — through the visual UI and through the palette — asserted with real key events |
| [2.4.3 Focus Order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html) | A | Focus is restored to the opener when the palette or a grant card closes; it is never dropped to `<body>` |
| [3.3.2 Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html) | A | Every generated field's label is the tool's own parameter description; date of birth states its ISO example inline |
| [4.1.3 Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | AA | Every tool execution announces itself in a live region, naming the actor — the criterion that agentic browsing currently breaks wholesale |
| [ARIA APG — Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) | — | The calendar is one tab stop with roving `tabindex`, arrow / Home / End / PageUp / PageDown movement, Enter to hold, Escape to leave rather than trap |
| [ARIA APG — Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | — | The palette and the grant card |

### Owed

- **[2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) (AA)** — not audited. The palette is a fixed overlay; whether it ever covers a focused element behind it at small viewport heights has not been checked.
- **[3.2.2 On Input](https://www.w3.org/WAI/WCAG22/Understanding/on-input.html) (A)** — needs a decision, not a fix. When an agent changes page state, that *is* a change of context the user did not initiate. The live-region announcement is the mitigation, but the criterion was not written with a third actor in mind. This is the substance of [#277](https://github.com/webmachinelearning/webmcp/issues/277), and it deserves a written position rather than a checkbox.
- **[2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) (AA)** — trivially met today because nothing drags. It becomes real the moment a rescheduling UI is added, and the answer must be a tool call, not a drag handle with a keyboard fallback bolted on.
- **A provenance signal, or an honest downgrade.** [#277](https://github.com/webmachinelearning/webmcp/issues/277) settled that caller attribution cannot be made reliable from today's `executeTool()` surface — the page marks the call it is about to make and infers the rest. We narrowed the page-side half of that window (the mark is now set after the `getTools()` round-trip rather than before it), but the residual ambiguity is not page-solvable. If a provenance signal lands in the API, the announcement should assert the actor only when the signal says so and drop to neutral wording otherwise.
- **A real screen reader.** Everything above is verified by markup review, axe-core, and the accessibility tree Chrome exposes — all of which establish that a violation is not *detectable*, not that the page is usable. **No screen reader has been run against this build.** The protocol for closing that is written up in [`SCREEN_READER.md`](./SCREEN_READER.md), task by task, so the run produces citable verbatim strings rather than impressions. It is the single highest-value outstanding item: an accessibility product whose accessibility is only inferred is making the same promise it criticises.
- **Users.** No disabled person has used this. That is the honest ceiling on every claim in this repo.

---

## 4. Product work the thesis implies

- **The interpreter is booked, not just noted.** `interpreter_lead_time_days` is currently a fact the user is told. The thesis says it should be a second constraint-satisfaction problem solved in the same call — book the appointment and the interpreter together, or refuse both.
- **Constraints belong to the person, not the booking.** A paratransit window is a fact about someone's life, not about one appointment. It should survive the session and pre-filter the first search, rather than being restated each time.
- **Refusals should offer the relaxation.** `explain_no_results` names the constraint that eliminated the most candidates. The next step is to offer the specific alternative — "no wheelchair-accessible audiologist exists within 10 km; the nearest is 15.2 km" — as a tool the agent or the human can accept.
- **More than one specialty of the same shape.** Booking care is one constraint-satisfaction domain. Legal aid, benefits appointments and social housing viewings have the same structure and the same excluded users.

---

## 5. What is deliberately not planned

- **No backend.** The fixture is a typed module. A server would add nothing to the argument and a great deal to the maintenance.
- **No CAPTCHA, puzzle, or timing challenge on the approval path**, even though it would defeat [#288](https://github.com/webmachinelearning/webmcp/issues/288). Every anti-automation trick that would work is an accessibility failure for the exact people this product is for. The durable fix belongs in the user agent, and saying so is more useful than shipping a barrier.
- **No second command list.** If a feature ever needs a human path that is not a call into the tool registry, the feature is wrong, not the architecture.
