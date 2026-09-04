# QODO.md — The Qodo Review Gate

How Qodo reviews `parity-webmcp`, what setup it needs, and what a clean PR looks like. Qodo is not a hackathon requirement here — the WebMCP Challenge has no review track — so it plays a different role than it did in `falcon-harness`: it is a **quality instrument**, used because the judging panel will read this code and because an accessibility product that ships an accessibility bug is self-refuting.

That means one thing above all: **Qodo must never become the bottleneck.** If a review is slow and the deadline is close, merge on your own read of the diff and note it in the PR body. The submission deadline beats the review gate every time.

---

## 1. What Qodo is here

Qodo Merge (the managed GitHub App) reviews each PR and posts findings. Four config surfaces, doing different jobs:

- **`REVIEW.md`** (repo root) — repository-specific review instructions. Qodo reads it automatically to calibrate severity, focus the review, and cut noise. This is the primary customization surface. Claude Code's own review reads the same file, so it serves both tools.
- **`.pr_agent.toml`** (repo root) — reviewer *behaviour*: which commands auto-run, inline comments, suggestion count. Keep it **minimal** — copying the full default config is a documented anti-pattern because defaults drift.
- **`best_practices.md`** (repo root) — custom standards for the `/improve` tool. Violations get flagged under "Organization best practices". Think of it as "what good code looks like"; `REVIEW.md` is "how to calibrate the review".
- **`pr_compliance_checklist.yaml`** — optional, for `/compliance`. **Skip it.** Not worth the time on this build.

All three of the first surfaces ship in Phase 0. **Qodo config only takes effect once it is on the default branch**, so Phase 0 must merge before later PRs get a customized review. Phase 1 may receive a default-flavoured review; that is fine.

---

## 2. One-time setup (before Phase 0 is opened)

1. **Install the Qodo Merge GitHub App on `mysticalseeker24/parity-webmcp`** — the App, not just the VS Code extension. The App reviews PRs; the extension is local/IDE only. Check `github.com/settings/installations` → Qodo → repository access includes `parity-webmcp`.
2. Confirm which commands auto-run on PR open. Our `.pr_agent.toml` sets describe + review.
3. You can invoke manually in any PR by commenting a slash command: `/review`, `/improve`, `/describe`. Use `/review` to force a fresh pass after pushing fixes.

If the App is not installed, install it now or decide explicitly to skip Qodo for this build. Do not half-configure it and lose time debugging why reviews are not appearing.

---

## 3. The PR loop

1. Branch off `main` — `pr/<phase-name>` per `PROJECT_SPEC.md` §8.
2. One phase, one logical change. Follow `CONVENTIONS.md` so Qodo has little to flag.
3. Open the PR with a body stating what changed, why, and any assumption made.
4. Qodo reviews automatically. Read every finding.
5. **Resolve High / action-required findings**: fix, push, `/review` again.
6. **If you dismiss a finding, write why in the thread.** One line. A reasoned dismissal is evidence of judgment; a silent ignore is not.
7. Merge only when High findings are resolved or reasoned-away and `main` still builds and deploys.

Do not batch. Small sequential PRs also produce the commit trail that proves the project was built inside the submission window — which *is* a hackathon eligibility matter (`PROJECT_SPEC.md` §12).

---

## 3b. Review focus added from the spec issues

Ask for these explicitly in PR bodies (Qodo reads the description):

- **Phase 2:** `ToolResult` envelope enforced by the factory type; every field has `.describe()`; `group` present; `get_booking_state` under 1.5K with `unavailable[]` complete.
- **Phase 5:** palette reads `inputSchema` via `readInputSchema()` (string-or-object), executes via `encodeToolArgs()` / `parseToolResult()`. A hand-parsed `JSON.parse(tool.inputSchema)` at a call site is a defect.
- **Phase 6:** no path from gated tool to commit without `argsHash` + expiry + approved + unconsumed checks at execution; approval handler records `delta_ms`, `isTrusted`, modality; dwell implemented as *disabled control*, not a sleep; `requestUserInteraction` feature-detected, never assumed; **no CAPTCHA or challenge on the approval path.**
- **Phase 7:** every `toolchange` that removes a tool produces a live-region line with the reason.

## 4. What Qodo should focus on in this repo

Written into `REVIEW.md`, restated here so Claude Code pre-empts it:

**High priority:**

- **Duplicate sources of truth.** Any hand-written JSON Schema, any second TypeScript interface describing a tool input, any human-only command list. This is the project's cardinal sin (`CONVENTIONS.md` §3).
- **Direct `registerTool` calls outside `registry.ts`.** All tools go through `defineTool`.
- **`navigator.modelContext`** anywhere. Wrong namespace, silent failure.
- **Grant-gate bypasses.** Any path from `confirm_booking` to a committed booking that skips grant validation; any grant validated without re-checking `argsHash`, expiry, and approval status at execution time.
- **Accessibility defects**: missing labels, `outline: none`, keyboard traps, div-as-button, live region not firing on a state change, colour-only signalling.
- **Missing error handling** in an `execute`, or an error returned without naming the offending field.
- **Unhandled promise rejections**; timers not cleaned up on unmount or state transition.

**Medium:**

- `any` or unchecked index access
- Character budget violations (`TOOLS.md` §6)
- Impure `available(state)` predicates
- Tools with overlapping purpose or vague descriptions

**Deliberately lower priority — tell Qodo not to escalate these:**

- Fixture data realism. It is synthetic on purpose.
- **The prompt-injection string in a provider `bio`.** It is an intentional adversarial test fixture, clearly commented. Expect Qodo to flag it anyway; that is cosmetic. Do not remove it — it is what `evals/adversarial.md` exercises.
- Absence of a backend, auth, or persistence. Architecturally deliberate (`CLAUDE.md` hard boundaries).
- Absence of UI tests. Deliberate scope decision.
- Styling and visual polish.

---

## 5. Timeboxing (read this twice)

The original deadline was Sep 3, 1:00 PM PDT; a 12-hour extension has been reported — **confirm it in writing from Devpost/OpenAI before relying on it.** Qodo review latency is real and the phases are tight.

- **Phases 0–5 and 8–9 are the submission.** If review latency threatens them, self-review and merge.
- When you merge without a completed Qodo pass, **say so in the PR body**: `"Merged on self-review; Qodo pass pending, deadline pressure."` Honest and auditable.
- Never leave a PR open at the deadline with the work only on a branch. **A merged imperfect `main` beats a perfect unmerged branch.**
- Never let a Qodo finding push you into a refactor during the final three hours. Note it as a follow-up in the README's "known issues" and move on.

---

## 6. After the deadline

**Stop.** Do not merge, push, or open PRs on `main` after submission. Editing a submitted repo during the judging period (Sep 4 – ~Sep 23) risks eligibility. Fork to keep building. If Qodo posts findings on already-merged PRs, leave them — resolving them means touching the repo.
