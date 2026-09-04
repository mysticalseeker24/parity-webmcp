# PROMPTS.md — Claude Code session prompts, in order

One prompt per PR. Paste each verbatim at the start of a fresh Claude Code session (or after the previous phase merges). Every prompt tells Claude Code what to read, because sessions do not carry context.

Time boxes assume the 12-hour extension is confirmed. **Submission line = P0 → P9.** P10–P12 are upside.

**Before P2:** install the Qodo Merge GitHub App on `mysticalseeker24/parity-webmcp` and merge P0 so the review config is on `main`.

---

## Session preamble (prepend to any prompt when the session is fresh)

```
You are working in mysticalseeker24/parity-webmcp. Read CLAUDE.md first — it is
short and it is the operating manual. Load only the .agent/ files each prompt
names. Do not hold everything in context at once. Never push to main directly;
every phase is a pr/<name> branch. When done, run `npm run verify` and report
its output plus a one-paragraph summary. Do not start the next phase.
```

---

## P0 — Migrate docs v2 · branch `pr/docs-v2` · 10 min

Adjust the download path for your OS (`~/Downloads/…` on macOS/Linux, `%USERPROFILE%\Downloads\…` on Windows).

```
Task: migrate the updated documentation set into this repo without losing any
Phase 1 work. The zip is at ~/Downloads/parity-webmcp-docs-v2.zip.

1. Create branch pr/docs-v2 from main.
2. Extract the zip to a temp directory. List its contents. It should contain
   only: .agent/{CONVENTIONS,PROJECT_SPEC,TOOLS,QODO,SPEC_ISSUES}.md, CLAUDE.md,
   README.md, REVIEW.md, best_practices.md, .pr_agent.toml, evals/adversarial.md.
   If it contains anything under src/, scripts/, or a LICENSE, stop and tell me.
3. NEVER touch: src/, scripts/, .agent/PHASE1_FINDINGS.md, LICENSE, .gitignore,
   package.json, package-lock.json, tsconfig*.json, vite.config.*, vercel.json,
   index.html.
4. For .agent/CONVENTIONS.md, PROJECT_SPEC.md, TOOLS.md, QODO.md, REVIEW.md,
   best_practices.md, .pr_agent.toml: replace wholesale with the v2 versions.
   .agent/SPEC_ISSUES.md is new — add it.
5. For CLAUDE.md and README.md: diff the current repo version against v2.
   Take v2 as the base. Re-apply any Phase-1-specific additions the current
   file has that v2 lacks (run instructions, verify script docs, a link to
   PHASE1_FINDINGS.md, the Chrome 152 flag detail). Show me the merged diff
   for these two files before writing them.
6. For evals/adversarial.md: replace with v2 unless the current file has any
   "Observed" field filled in — if so, preserve those entries.
7. Confirm .agent/PHASE1_FINDINGS.md is still present and unchanged, and that
   CLAUDE.md's read-order table references it.
8. Commit as "docs: v2 — spec-issue alignment (#288 #262 #282 #255 #286 #278),
   Qodo config, Phase 1 findings folded into TOOLS.md". Open the PR with a
   body listing exactly which files were replaced, merged, added, untouched.

Stop and report. I will merge this before anything else so the Qodo config
takes effect on main.
```

---

## P2 — Factory, registry, store, fixtures, Tier 1 tools · branch `pr/define-tool` · 90 min

```
Read CLAUDE.md. Then .agent/SPEC_ISSUES.md in full. Then .agent/CONVENTIONS.md
§3–§5, .agent/PROJECT_SPEC.md §5–§6, .agent/TOOLS.md §3 and §7, and
.agent/PHASE1_FINDINGS.md.

Branch: pr/define-tool. This is Phase 2. Review loop is ON — put the Phase 2
checklist from .agent/QODO.md §3b in the PR body.

Build, in order:

1. src/lib/result.ts — the ToolResult discriminated union from PROJECT_SPEC §5.
   Refusals fulfil with ok:false; only bugs throw. Export type guards.
2. src/store.ts — Zustand store for the state machine in PROJECT_SPEC §6.
   Fields: stage, selectedProviderId, lastSearch, hasFetchedAvailability,
   heldSlot {slotId, expiresAt}, intake, booking, companion, audit[].
   Pure transitions; no timers in this phase.
3. src/lib/defineTool.ts — the factory. Spec fields: name, description, schema
   (Zod object), group ("orient"|"search"|"schedule"|"intake"|"commit"|"manage"),
   humanLabel, voiceAliases?, readOnly?, reversible?, requiresGrant?,
   untrustedOutput?, available(state), unavailableReason(state) →
   { reason_code, reason, unlock_by }, announce(input, result), execute.
   The factory: derives inputSchema via z.toJSONSchema; sets annotations
   {readOnlyHint, untrustedContentHint} honestly; wraps execute so
   schema.parse failures return {ok:false, kind:"invalid_input", field, reason,
   next} naming the field with a valid example, and any thrown error becomes a
   clean {ok:false} without leaking stack or path; asserts TOOLS.md §6 budgets
   in dev mode (name ≤30, description ≤500, each param description ≤150,
   serialized output ≤1500) and throws at definition time on violation.
4. src/lib/registry.ts — subscribes to the store, derives
   allTools.filter(t => t.available(state)), diffs against the currently
   registered set, registers new ones via document.modelContext.registerTool
   and unregisters removed ones via their AbortController. The ONLY file that
   calls registerTool. Feature-detects document.modelContext; when absent,
   maintains the same live set locally so the palette fallback works. Records
   every execution to store.audit with {tool, actor:"agent"|"human", input,
   result, at}. Actor defaults to "agent"; expose setNextActor("human") that
   the palette will call before executeTool (P5) — the wrapper reads and
   clears it. Comment why (executeTool cannot carry actor).
5. src/data/accommodations.ts — one exported z.enum (wheelchair_accessible,
   step_free_entrance, asl_interpreter, extended_appointment, low_sensory,
   ground_floor, companion_seating, guide_dog_welcome, hoist_transfer,
   large_print_forms). src/data/providers.ts — 12 synthetic providers, 4
   specialties (neurology, rheumatology, audiology, physiotherapy), each with
   id, name, specialty, languages[], insurance[], accommodations[],
   interpreter_lead_time_days, bio, location. Include the deliberate gaps from
   TOOLS.md §10 and ONE bio containing the injection fixture, clearly commented
   as intentional (SPEC_ISSUES.md; REVIEW.md says not to flag it).
   src/data/slots.ts — deterministic seeded generation over 14 days.
   src/data/coverage.ts — rules as data {id, condition, effect, human_readable}.
   No real names, addresses, phones, or insurer IDs.
6. src/tools/ — the 8 Tier 1 tools from PROJECT_SPEC §5, one file each, plus
   index.ts exporting the ordered array. get_booking_state returns stage,
   selections, live[] grouped by group, and unavailable[] with
   {tool, reason_code, reason, unlock_by} for every non-live tool — under 1.5K
   chars (terse codes). Every Zod field has .describe() written to read as a
   form label (SPEC_ISSUES #286). find_providers caps at 5 results and says
   "showing N of M; narrow the search" when truncated. select_provider
   hard-blocks with kind:"refused" when a required accommodation is missing,
   naming it.
7. Remove the Phase 1 spike registration from the app entry; keep
   src/lib/webmcpInterop.ts, src/types/webmcp-augment.d.ts, and
   src/test/webmcpMock.ts. Extend the mock so registry.test.ts can assert
   register/unregister diffs on state change.
8. Tests (Vitest): every tool's schema round-trips through z.toJSONSchema;
   budget assertions fire on a deliberately oversized fixture; registry adds
   and removes exactly the expected tools across each state transition;
   envelope shape on success, invalid_input, refused; get_booking_state under
   1.5K in every stage.

Cite spec issue numbers (#262, #282, #255, #286, #239) in code comments where
each decision lives. Do not build the UI, the palette, timers, or the grant
gate. Run npm run verify. Stop and report.
```

---

## P3 — Hold timers, expiry, reasons · branch `pr/hold-expiry` · 30 min

```
Read CLAUDE.md, .agent/PROJECT_SPEC.md §6 and §10, .agent/CONVENTIONS.md §8.

Branch: pr/hold-expiry. Phase 3.

1. hold_slot sets heldSlot.expiresAt = now + 10 min and starts one timer
   owned by src/lib/timers.ts (not a component). On expiry: clear heldSlot,
   transition to provider_selected, and record an audit entry
   {tool:"system", reason_code:"hold_expired"}. Timer is cleared on any
   transition that releases the hold. No leaked timers; test with fake timers.
2. Add hold expiry to unavailableReason for confirm_booking:
   reason_code "hold_expired", unlock_by "hold_slot".
3. Add src/lib/reasons.ts — a single table of every reason_code with its human
   sentence, used by get_booking_state.unavailable[] AND by the announcer
   later (#262 — one source for both surfaces).
4. Registry: when the live set shrinks, record which tools left and why
   (from unavailableReason) into store.lastToolChange so P5 can announce it.
5. Slot-taken race: a store-level flag on each slot; hold_slot on an
   already-held slot returns kind:"conflict" with next:"get_availability".
   Idempotency: hold_slot on the slot you already hold returns ok:true with
   the existing hold, no duplicate.

Tests for all of the above. npm run verify. Stop and report.
```

---

## P4 — UI shell · branch `pr/ui-shell` · 60 min

```
Read CLAUDE.md, .agent/CONVENTIONS.md §6 (accessibility — this is the product),
.agent/PROJECT_SPEC.md §4.

Branch: pr/ui-shell. Phase 4. Tailwind. Ugly is acceptable; inaccessible is not.

Single page, no routing (tools belong to the page — TOOLS.md §1). Components:

1. src/components/ProviderList.tsx — results from lastSearch, each a real
   <button> "Select", accommodation icons WITH text labels (never colour or
   icon alone). Shows the refused reason inline when select_provider blocks.
2. src/components/Calendar.tsx — a 14-day × time-slot grid as a real <table>
   with <th> headers. Roving tabindex, arrow keys move, Home/End, Enter holds,
   Escape returns focus. Current cell announced via aria-live. Held slot
   marked with text ("Held, expires 09:58") not just colour. This control is
   the argument the whole product rests on — make it exemplary.
3. src/components/IntakeForm.tsx — real <label for> on every field, the
   accommodations vocabulary as checkboxes generated from the z.enum, date of
   birth as a plain text input with an ISO example (not a date picker), a
   completeness indicator listing exactly what set_intake still needs.
4. src/components/BookingSummary.tsx — current stage, selections, the hold
   countdown, and the booking once confirmed.
5. src/App.tsx — layout, a visible "WebMCP: detected / not detected" badge,
   and a placeholder <LiveRegion/> mount point (P5 fills it).
6. All UI actions call the SAME tool execute functions through the registry
   with actor:"human" — no parallel handlers (CONVENTIONS §3). Clicking
   "Select" in ProviderList runs select_provider.
7. prefers-reduced-motion respected; focus visible everywhere; contrast
   checked; tab order = visual order.

Test the full flow with the mouse unplugged before reporting. Add a
scripts/a11y-smoke.md checklist you actually walked. npm run verify. Stop and
report.
```

---

## P5 — Command palette + live region · branch `pr/command-palette` · 75 min

**This is the submission.** Never cut.

```
Read CLAUDE.md, .agent/CONVENTIONS.md §3 and §6, .agent/TOOLS.md §3,
.agent/PHASE1_FINDINGS.md, .agent/SPEC_ISSUES.md (#262, #286, #255).

Branch: pr/command-palette. Phase 5 — the differentiator. Put the Phase 5
checklist from QODO.md §3b in the PR body.

1. src/components/CommandPalette.tsx — opened with Cmd/Ctrl+K and a visible
   button. It is a labelled combobox + listbox with aria-activedescendant,
   result count announced, Escape closes and restores focus.
   SOURCE OF TRUTH: when document.modelContext exists, the palette calls
   document.modelContext.getTools() to learn which tools are live and reads
   each inputSchema through readInputSchema() (it arrives as a JSON string —
   PHASE1_FINDINGS). It joins by name with the local spec map ONLY for
   presentation metadata (group, humanLabel, voiceAliases). If getTools()
   returns a name not in the local map, still render it from its schema —
   the palette must be generic. When modelContext is absent, fall back to the
   registry's local live set. Listen to "toolchange" and re-read.
2. Form generation from JSON Schema: string → text input; enum → <select>;
   array of enum → checkbox group; integer/number → number input; boolean →
   checkbox; every label is the field's description (SPEC_ISSUES #286 — the
   accessible name IS the parameter description). Required fields marked in
   text. Group headings in workflow order (#255).
3. Execution: call registry.setNextActor("human"), then
   document.modelContext.executeTool(tool, encodeToolArgs(values)), then
   parseToolResult(). Same path as the agent — do not call the local execute
   directly when modelContext exists. Render the ToolResult envelope: ok →
   human_summary; ok:false → kind + reason + next as an actionable line.
4. src/components/LiveRegion.tsx — one polite region, one assertive region.
   src/lib/announcer.ts subscribes to store.audit and store.lastToolChange:
   every execution announces spec.announce(input, result) prefixed by the
   actor ("Agent held…", "You held…"); every tool removal announces the
   reason sentence from reasons.ts (#262 — the same context the agent gets
   from unavailable[]). Errors and pending_authorization go to assertive.
5. Show the browser's live tool list and the palette's list side by side in a
   collapsible dev panel so the lockstep is visible for the video.

Tests: palette renders a form for a tool it has never seen; enum → select;
description → label; executes through the mock's executeTool with a JSON
string; announcer fires with the right actor. Walk the entire booking with
keyboard only, no mouse, no agent, and record it in scripts/a11y-smoke.md.
npm run verify. Stop and report.
```

---

## P6 — Grant gate (#288 design) · branch `pr/grant-gate` · 60 min

```
Read CLAUDE.md, .agent/SPEC_ISSUES.md (#288 and #165 in full),
.agent/PROJECT_SPEC.md §7, .agent/CONVENTIONS.md §5, .agent/TOOLS.md §3
(Elicitation).

Branch: pr/grant-gate. Phase 6. Put the Phase 6 checklist from QODO.md §3b in
the PR body — Qodo must look for bypasses.

1. src/lib/grants.ts — mint(tool, input) → {id, tool, argsHash, expiresAt:
   now+120s, status:"pending"}; argsHash = SHA-256 via crypto.subtle over
   canonical JSON (sorted keys). approve(id, evidence) records
   {approved_at, delta_ms, isTrusted, modality:"pointer"|"keyboard",
   pointerType?, key?}. validate(tool, input) → exists AND status==="approved"
   AND unexpired AND argsHash matches the CURRENT input AND not consumed.
   consume(id) after commit. Expiry timer per grant, cleaned up.
   There is NO function reachable from any tool that approves a grant.
2. confirm_booking is two-phase: first call mints and returns
   {ok:false, kind:"pending_authorization", reason, next:"approve on the page,
   then call confirm_booking again with the same slot_id"}; second call with
   a valid grant commits, consumes, transitions to booked. Mismatched args →
   kind:"grant_mismatch". Expired → "grant_expired". Slot taken between hold
   and confirm → "conflict". Description text must include: "Consequential:
   commits a real appointment. Requires the user's own approval." so the
   host's confirmation fires (#288 layer 1).
3. Feature-detect document.modelContext.requestUserInteraction (#165). If
   present, route approval through it and log which path was used. If absent,
   page card. Record the observation in PHASE1_FINDINGS.md.
4. src/components/GrantCard.tsx — names the tool and EVERY argument value in
   full, a live countdown, Approve and Deny as real <button>s. Approve is
   DISABLED for 1500 ms after render (announced: "Approve available in 1.5
   seconds"); implement as disabled state, never a sleep. The click/keydown
   handler rejects event.isTrusted === false, records delta_ms from
   requested_at, pointerType or key, and calls approve(). Focus moves to the
   card on render and back on close. Assertive announcement on render.
5. Audit trail: approvals under 800 ms are flagged
   {flag:"possibly_automated"} and rendered on-page as "approved 340 ms after
   request — possibly automated" (#288 detection made legible).
6. NO CAPTCHA, puzzle, or challenge of any kind (CONVENTIONS §5). If you feel
   the urge, write a comment citing #288 and #277 instead.

Tests — the invariants, each as a named test: args mismatch refused; expiry
refused; replay refused; no exported approve reachable from tools; isTrusted
false rejected; dwell window rejects; delta<800 flagged; unregistered
confirm_booking not callable when intake incomplete (phantom tool).
npm run verify. Stop and report.
```

---

## P7 — Audit trail UI, undo, focus polish · branch `pr/audit-undo` · 40 min

```
Read CLAUDE.md, .agent/CONVENTIONS.md §6 and §8, .agent/PROJECT_SPEC.md §4.

Branch: pr/audit-undo. Phase 7.

1. src/components/AuditTrail.tsx — the store.audit list, newest first, as a
   real <ol> with per-entry actor, tool, human summary, timestamp, and the
   possibly_automated flag when present. Screen-reader friendly.
2. Undo stack for reversible tools (select_provider, hold_slot, set_intake):
   registry records inverse actions; an "Undo" button and Cmd/Ctrl+Z.
   Gated tools are never undoable — say so in the UI. Undo entries are
   themselves audited and announced.
3. Focus management: after any tool execution that changes stage, move focus
   to the new stage's primary control and announce it. After grant close,
   return focus to where it was.
4. Timer hygiene audit: every setTimeout/setInterval in the codebase has a
   clear path; list them in a comment block in timers.ts.

Tests for undo inverses and focus targets. npm run verify. Stop and report.
```

---

## P8 — Deploy + evals runbook · branch `pr/deploy-evals` · 40 min

```
Read CLAUDE.md, .agent/TOOLS.md §5 and §9, .agent/PROJECT_SPEC.md §11–§12,
evals/adversarial.md.

Branch: pr/deploy-evals. Phase 8.

1. Confirm vercel.json has no headers block and no Origin-Agent-Cluster.
   Confirm the build is static, no functions. Give me the exact deploy
   command; I will run it and paste the URL.
2. Run npm run verify and scripts/verify-browser.mjs against a production
   build; fix anything red.
3. Write evals/RUNBOOK.md — exact click-by-click steps for ME to execute each
   case in evals/adversarial.md in ChatGPT's built-in browser (model: GPT-5.6
   Sol or Terra), including what to copy from the audit trail into each
   Observed field. Case 6 (#288) and Case 7 (#262) get the most detail.
4. Add a README "Verify it yourself" section: flag, model, Site tools button,
   Cmd/Ctrl+K, the side-by-side panel.
5. Confirm LICENSE is detected in the repo About section (MIT). Confirm commit
   history is inside the submission window.

Stop and report. I will deploy, run the evals by hand, and paste results for
you to record in the next phase.
```

---

## P9 — Submission assets · branch `pr/submission` · 90 min · do not compress

```
Read CLAUDE.md, README.md, .agent/PROJECT_SPEC.md §1, §12, §13,
evals/adversarial.md (now with my Observed fields filled in).

Branch: pr/submission. Phase 9.

1. README: replace <VERCEL_URL> and <YOUTUBE_URL>; add the eval results table
   summarised honestly, including anything surprising; add a screenshot of
   the Site tools panel and the side-by-side lockstep panel under docs/.
   Never state a result not in evals/adversarial.md (CONVENTIONS §9).
2. Write docs/DEVPOST.md: the text description hitting the four required
   points in order — why the use case fits WebMCP; how it improves UX; what
   people and agents can now do together that was hard before; how WebMCP
   was implemented. Under 600 words, specific, cites #288/#262/#282/#255
   inline. No generic AI-sounding sentences.
3. Write docs/VIDEO_SCRIPT.md: 165 seconds, timestamped, per PROJECT_SPEC.
   Order: the inaccessible calendar → agent books via tools → the SAME tools
   driving the palette with no mouse and no agent → lockstep shrink of both
   tool lists → injected "pre-authorized" text and the gate holding → the
   #288 audit line → the one-sentence thesis.
4. Final checklist from PROJECT_SPEC §12 with every box ticked or explained.

npm run verify. Stop and report. After I merge this and submit, NO further
commits to main until winners are announced.
```

---

## P10 — Tier 2 tools · branch `pr/tier2-tools` · 45 min (upside)

```
Read CLAUDE.md, .agent/PROJECT_SPEC.md §5 Tier 2, .agent/CONVENTIONS.md §4.
Branch: pr/tier2-tools. In this order, stopping when time runs out:
explain_no_results (registers only when lastSearch returned 0; returns the
eliminating constraint), set_companion_constraint, check_coverage (returns
the rule path from coverage.ts), release_slot, cancel_booking (gated, same
grants.ts path). Each with reasons, announce, group, tests, and a
get_booking_state size check. npm run verify. Stop and report.
```

## P11 — Voice · branch `pr/voice` · 30 min (upside)

```
Read CLAUDE.md, .agent/TOOLS.md §8 (Voice), .agent/CONVENTIONS.md §6.
Branch: pr/voice. src/components/VoiceInput.tsx using webkitSpeechRecognition,
feature-detected, Chrome-only acknowledged in UI. Match transcripts against
voiceAliases + enum values from each live tool's schema; on match, open the
palette pre-filled and let the user confirm — voice never executes directly.
Keyboard path always available. Tests for alias matching. npm run verify.
```

## P12 — Tier 3 · branch `pr/tier3-tools` (upside)

```
Read .agent/PROJECT_SPEC.md §5 Tier 3. Branch: pr/tier3-tools. Order:
get_provider_detail (untrustedContentHint: true — it returns the bio),
explain_capability, export_summary, set_transport_constraint,
watch_earlier_slot (honours the execute AbortSignal; progress lines to the
audit trail per spec issue #196), reschedule_booking last (gated, atomic
release+rehold+reconfirm). Stop when time runs out; never leave main broken.
```

---

## After submission (no repo edits)

- Comment on spec issue **#278** with the Phase 1 findings + a link to `webmcpInterop.ts`.
- File an implementation report on the spec repo (pattern: **#266**) referencing #277/#272/#262/#288 with the eval results.
- Both are visibility with the editors and adjacent to the judges, and neither touches the submitted repo.
