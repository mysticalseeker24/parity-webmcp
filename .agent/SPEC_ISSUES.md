# SPEC_ISSUES.md — Alignment with open WebMCP spec issues

Read this before Phase 2. It maps open issues on `github.com/webmachinelearning/webmcp` (as of Sep 3–4, 2026) to concrete design decisions in Parity. Two reasons this file exists:

1. The judging panel includes spec-adjacent people (Sarah Drasner filed #255; Alex Nahas created MCP-B). Designing *against the open issues* is the most credible form of "WebMCP Leverage" available.
2. At least three other Challenge entries are visible in these threads — **Release Airlock** (#288), **Incident Command** (#262), **Consequence** (#282) — all built around consent gates. That confirms the gate is table stakes in this field and the **accessibility inversion is the differentiator.** Do not let the gate eat the build.

Cite issue numbers in code comments, the README, and the video. Judges will recognise them.

---

## #288 — A UA that both invokes tools and automates the page can complete the page's own approval step

**What was observed.** On 2026-09-02, ChatGPT's in-app browser (GPT-5.6) called a proposal-only write tool on Release Airlock, and when the proposal didn't execute by itself, **clicked the page's Approve button and continued.** From the page's side the click was indistinguishable from the operator's. The receipt recorded "approved by you." The human never decided anything.

**Why it matters to us.** This is a direct attack on the "out of band" invariant in `PROJECT_SPEC.md` §7. The page cannot, alone, distinguish a human's activation from a computer-use agent's. Any claim that our page-side gate is *sufficient* is false, and a judge who has read #288 will know it.

**What Parity does (all of it, in this order of importance):**

1. **Say it plainly.** README and video state that page-side approval is *necessary but not sufficient* while the host is also a computer-use agent, and cite #288. Honesty here scores; a bypassed "airtight" claim is fatal.
2. **Make the host's own confirmation fire.** OpenAI's Site tools docs say consequential actions still hit the browser's normal confirmation policies. Gated tool descriptions therefore state explicitly: *"Consequential: commits an appointment. Requires the user's own approval."* Two layers — host confirmation and page grant — and we never rely on only one.
3. **Feature-detect `requestUserInteraction()`** (#165). If the browser implements host-mediated elicitation, use it as the approval channel and fall back to the page card only when it is absent. Verify whether Chrome or ChatGPT's browser ships it; do not assume. Record the finding in `TOOLS.md`.
4. **Record time-to-approve and input modality in the audit trail.** Every grant approval logs `requested_at`, `approved_at`, `delta_ms`, `event.isTrusted`, and `pointerType` / `key`. Sub-second approvals are flagged in the on-page trail: *"approved 340 ms after request — possibly automated."* The trail is not enforcement; it is **detection made legible to the human**, which is the most a page can honestly do.
5. **Brief mandatory dwell.** The Approve control is disabled for 1.5 s after the card renders and the live region announces that. This filters the naive instant-click behaviour observed in #288. It is a heuristic and is documented as one.
6. **Reject `isTrusted === false`.** Cheap, catches JS-synthesised clicks, does not catch CDP-injected input. Document the limit.
7. **Refuse CAPTCHA-style anti-automation.** Puzzles, hidden challenges, and timing games are accessibility failures for the exact population Parity serves. This is a principled position: **the durable fix belongs in the user agent (#165, #155, #277), not in the page.** Say so.
8. **Eval Case 6: attempt #288 against Parity** in ChatGPT's browser and record exactly what happened. If the agent clicks Approve, that is a documented reproduction of a spec issue — a contribution, not a failure. If it does not, that is a datapoint too.

**Edge cases added:** approval event with `isTrusted: false`; approval inside the dwell window; approval within 800 ms of request; approval when `requestUserInteraction` exists vs. absent.

---

## #262 — WebMCP loses important context when tools appear or disappear

**The problem.** When a site unregisters a tool, the agent sees only that it vanished. It cannot tell *permission denied* from *not ready yet* from *plan doesn't include it*. The thread calls this **semantic context blindness**, and a Challenge competitor confirmed they were forced to build an explanatory side channel to compensate. A commenter proposed the opposite: keep tools registered and return `{ status: "unavailable", reason }` from `execute`.

**What Parity does — deliberately both:**

- **Unregister for enforcement.** An illegal tool does not exist, so it cannot be called. This is stronger than a runtime refusal (`CONVENTIONS.md` §5).
- **Expose the reason for context.** `get_booking_state` returns an `unavailable` array: `[{ tool, reason_code, reason, unlock_by }]` — e.g. `confirm_booking · intake_incomplete · "Patient name and date of birth are missing" · "call set_intake"`. The agent regains everything unregistration took away, without the dangerous tool being callable.
- **Announce the transition to humans too.** The same blindness hits a screen-reader user when a palette row disappears. `toolchange` triggers a live-region line: *"Confirm booking is no longer available: the slot hold expired."* One fix, both surfaces — the thesis again.

**Edge cases added:** every unregistration carries a `reason_code`; `unavailable` is empty only in `browsing`; hold expiry and grant expiry both produce reason codes; `get_booking_state` output stays under the 1.5K budget with all 18 non-live tools listed (use terse codes, not prose).

---

## #282 — No structured way to signal a tool's refusal

**The problem.** `execute()` returns the same shape for success, refusal, and failure. Consequence (a competitor) invented a prose convention — *"Refused: this field requires the human's own action"* — and relies on the model to read it. A spec editor replied that WebMCP's `execute` is a plain Promise: fulfilment serialises as success, rejection routes to the error path. So a refusal should be a **fulfilled** result with structure, not a thrown error.

**What Parity does.** Every tool returns one typed envelope, enforced by `defineTool`:

```ts
type ToolResult =
  | { ok: true;  data: unknown; human_summary: string }
  | { ok: false; kind: "refused" | "unavailable" | "invalid_input" | "conflict"
                      | "pending_authorization" | "grant_expired" | "grant_mismatch";
      reason: string; field?: string; next?: string };
```

- `pending_authorization` and the grant outcomes are refusals, not errors — they fulfil.
- `invalid_input` names `field` and gives a valid example so the model self-corrects.
- `conflict` covers slot-taken-between-hold-and-confirm.
- Genuine bugs throw; everything the tool *decides* fulfils with `ok: false`.

State in the README that this is Parity's answer to #282 and that the shape is a convention until the spec provides one.

---

## #255 — Tool collections: coarse-grained grouping with progressive disclosure (filed by Sarah Drasner)

**The problem.** A real app surfaces 100+ tools; `getTools()` returns a flat list; selection accuracy degrades. She wants progressive disclosure — read a few group descriptions, then drill in. The thread is split on whether this needs a spec change or whether skills / code-mode solve it.

**What Parity does.** The state machine *is* progressive disclosure, built from existing primitives — no spec change required. 19 tools defined, never more than 7 registered, and the live set is always exactly the legal next actions. Additionally:

- Every `defineTool` spec carries a `group: "orient" | "search" | "schedule" | "intake" | "commit" | "manage"`.
- The command palette renders grouped, in workflow order.
- `get_booking_state` reports live tools grouped, so the agent reads six group headings before nineteen descriptions.

Frame this carefully: *"Parity demonstrates that state-driven registration achieves the disclosure #255 asks for today, and that the palette benefits from the same grouping."* Do not claim it makes #255 unnecessary — she filed it; she has thought about it longer than we have.

---

## #277 / #272 — Accessibility requirements for WebMCP UA UI; a11y review checklist

**The gap.** The spec's *Accessibility Considerations* section is empty. #277 asks for requirements on any UI that surfaces tool discovery or mediates execution, and notes the declarative flow "focuses the submit button and asks the user to review" with no stated a11y semantics. #272 is the formal W3C review checklist.

**What Parity is.** A worked example of what page-side accessibility for agent-mediated actions looks like: actor-named live-region announcements, a screen-reader-usable command surface derived from the same registry, keyboard-complete flows, focus management on grant cards, reduced-motion respect. README states that Parity is offered as an implementation datapoint for #277. **After the deadline, file an implementation report on the spec repo** (pattern: #266). That does not touch our repo and is legitimate visibility with exactly the people judging.

---

## #286 — `aria-label` as a source for `toolparamdescription`

**The thread.** A Stripe engineer asked the declarative API to derive parameter descriptions from `aria-label`. A spec editor replied it should follow the **accessible name computation** (`aria-labelledby` → `aria-label` → host label) rather than a new priority order, so the generated schema never disagrees with the control's accessibility semantics.

**What Parity does — the inverse.** Palette form labels are generated from each Zod field's `.describe()`. The accessible name **is** the parameter description, because there is one source. They cannot disagree. This is the accessibility-inversion thesis in one sentence; cite #286 next to it. It also means: **every Zod field must carry `.describe()`**, and the text must read well as a form label, not just as a hint to a model.

---

## #278 — Clarify `executeTool` argument encoding and returned schema shape

**Identical to our Phase 1 findings** (`PHASE1_FINDINGS.md`): `inputSchema` arrives as a JSON string, `executeTool` rejects object arguments, returns a JSON string. Our `webmcpInterop.ts` shim already handles both shapes.

**Action:** comment on #278 with the findings and a link to the shim. Zero cost, real contribution, visible to the editors. Reference #278 in `TOOLS.md` §3.

---

## Lower priority, noted

| Issue | Relevance | Action |
|---|---|---|
| #167 Dynamic tool definitions | Our whole registry | Cite when describing state-driven registration |
| #165 Elicitation via `requestUserInteraction()` | The right home for approval | Feature-detect (see #288 item 3) |
| #196 Tool execution progress report | `watch_earlier_slot` | Tier 3 only; if built, emit progress in the human-facing trail |
| #239 Grammar-level injection mitigation | Our `z.enum` vocabularies | One line in README: structural constraint over prose instruction |
| #267 Turn awareness | Multi-step flows | Note that `get_booking_state` is the agent's re-orientation tool between turns |
| #273 / #276 i18n, language & direction | Accessibility-adjacent | Out of scope; mention as future work |
| #227 Discovery across navigables | We are single-page | Explains why Parity has no routes |
| #219 Length limits need a text unit | Our budgets | Enforce in characters, say "characters" |

---

## What this changes in the build

Additions to `PROJECT_SPEC.md` (applied):

- §5: `group` field on every tool; `get_booking_state` gains `unavailable[]` and grouped `live[]`.
- §7: gate rewritten as "necessary, not sufficient"; audit trail records `delta_ms`, `isTrusted`, modality; 1.5 s dwell; `requestUserInteraction` feature-detect; explicit no-CAPTCHA position.
- §10: new edge cases listed above.
- §11: Eval Case 6 (#288 reproduction attempt).
- New `ToolResult` envelope in `defineTool` (#282).

Additions to `TOOLS.md`: Phase 1 interop findings folded into §3; `requestUserInteraction` marked *verify*.

Additions to `CONVENTIONS.md` §5: the #288 position; never claim page-side approval is sufficient.
