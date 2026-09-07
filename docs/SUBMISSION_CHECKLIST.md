# Submission checklist

Every line from `.agent/PROJECT_SPEC.md` §12, either ticked with the evidence, or explained.
Verified 2026-09-07 against commit `3b79942` and <https://parity-webmcp.vercel.app/>.

---

## Compliance

- [x] **Working live URL, reachable in ChatGPT's built-in browser or Chrome 149+ with the flag**
      — <https://parity-webmcp.vercel.app/> returns `200`, HTTPS, and serves no
      `Origin-Agent-Cluster` header (that header set to `?0` disables WebMCP outright). Confirmed
      working in Chrome by the maintainer, and by `scripts/run-evals.mjs` driving the live URL.

- [x] **Public repo on GitHub** — `mysticalseeker24/parity-webmcp`.

- [x] **MIT license present and detectable in the About section** — `LICENSE` is the standard MIT
      text; `gh api repos/mysticalseeker24/parity-webmcp --jq .license.spdx_id` returns `MIT`.

- [x] **All source, assets and run instructions in the repo** — `README.md` → *Run locally* and
      *Verify it yourself*.

- [x] **A genuine `document.modelContext.registerTool(...)` implementation** — `src/lib/registry.ts`,
      which is the *only* file that calls it. `src/lib/registry.test.ts` greps the source tree to
      keep it that way.

- [ ] **Demo video under 3 minutes, public on YouTube, with audio** — **NOT DONE.** Script is ready
      at `docs/VIDEO_SCRIPT.md` (targets 2:45). To be recorded once the build is final.

- [x] **Text description covering all four required points** — `docs/DEVPOST.md`, in the required
      order: why the use case fits WebMCP · how it improves UX · what people and agents can do
      together · how WebMCP was implemented.

- [x] **Specific, non-generic project name** — "Parity". The name describes the call graph: one
      registry, two callers.

- [ ] ⚠️ **Project newly created within the submission period, commit history shows it** — **NEEDS
      YOUR DECISION.** See below.

- [ ] **Submitted before the deadline** — not yet submitted.

- [ ] **After the deadline: freeze everything** — not yet applicable. No commits to `main` after
      submitting until winners are announced; fork to keep building.

- [ ] **Live URL stays up through judging** — Vercel Hobby projects do not idle static deployments,
      but **confirm the project will not be deleted or the deployment superseded**, and do not run a
      second canonical URL.

---

## ⚠️ The one that needs your attention

`PROJECT_SPEC.md` §12 records the submission window as **Aug 25 – Sep 3** and the deadline as
**Sep 3, 1:00 PM PDT**. The commit history runs:

```
ba49eff  2026-09-03  Initial commit
edd0f99  2026-09-03  Phase 0+1
98e0321  2026-09-04  Phase 1 verification
...
3b79942  2026-09-07  Phase 8
```

Ten of eighteen commits are dated after Sep 3.

**This has not been "fixed".** Rewriting commit dates would falsify the exact evidence the rule
exists to check, and a judge who runs `git log` would see a history that disagrees with the pushed
timestamps on GitHub. Confirm the real deadline before submitting; if the window has genuinely
closed, that is a question for the organisers.

---

## Definition of done (`CLAUDE.md`)

- [x] TypeScript strict, no `any`, builds clean — `npm run typecheck` and `npm run build` green.
- [x] Every tool authored through `defineTool`; no bare `registerTool` call outside `registry.ts`.
- [x] Every tool returns the `ToolResult` envelope; refusals fulfil with `ok: false`.
- [x] Every tool carries a `group`; `get_booking_state.unavailable[]` lists every non-live tool with
      `reason_code` and `unlock_by`.
- [x] One Zod schema per tool, used for registration, palette form and runtime validation.
- [x] Every execution emits an `aria-live` announcement with the correct actor.
- [x] Character budgets enforced at definition time (`TOOLS.md` §6); output budget checked per run.
- [x] The deployed URL works in a WebMCP browser.
- [x] The palette completes a full booking with keyboard only, no agent — tested in
      `src/components/CommandPalette.test.tsx`.
- [n/a] Qodo review — dropped by explicit instruction; the `npm run verify` gate is run in its place.

---

## Verification evidence

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` | **237 passing**, 15 files |
| `npm run build` | 5 static files, no functions |
| `npm run verify:browser` | **22 checks passing** against real Chrome 152 + real WebMCP |
| `scripts/run-evals.mjs` | 6 structural eval cases run against the live deployment |

---

## Known gaps, stated rather than hidden

1. **No real screen reader has been run against this.** `scripts/a11y-smoke.md` separates what is
   asserted by a test from what was verified by reading markup. NVDA, JAWS and VoiceOver differ on
   `aria-live` under rapid updates and on roving-`tabindex` grids.
2. **Four eval half-cases are outstanding, all behavioural** (1b, 6b, 7b, and the model half of the
   flow) — they need a human in ChatGPT's browser. `evals/RUNBOOK.md` is the procedure.
3. **Case 6a reproduced #288 at the mechanism level**: CDP-injected input approved the page's own
   card and was logged as a trusted event. This is documented as the reason page-side approval is
   called *necessary, not sufficient*, and is not claimed to be solved.
4. **Tier 2 and Tier 3 tools are not built.** Eight of nineteen tools ship. `get_provider_detail`
   in particular is absent, which is why the injected provider bio has no path to the agent in this
   build — worth stating, because it makes Case 1a a weaker result than it first appears.
5. **`find_providers`' 5-result cap is never exercised** by the fixture: three providers per
   specialty. The truncation code and its note are written and unit-asserted, but no test proves the
   cap fires.
