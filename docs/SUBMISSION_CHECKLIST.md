# Submission checklist

Every line from `.agent/PROJECT_SPEC.md` §12, either ticked with the evidence, or explained.
Verified 2026-09-07 against `main` and <https://parity-webmcp.vercel.app/>.

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
      at `docs/VIDEO_SCRIPT.md`, cut to **2:10** with sparse narration so the screen carries the
      argument. To be recorded once the build is final.

- [x] **Text description covering all four required points** — `docs/DEVPOST.md`, in the required
      order: why the use case fits WebMCP · how it improves UX · what people and agents can do
      together · how WebMCP was implemented.

- [x] **Specific, non-generic project name** — "Parity". The name describes the call graph: one
      registry, two callers.

- [ ] **Project newly created within the submission period, commit history shows it** — the history
      runs past the stated deadline and has not been rewritten. Raised with the organisers directly.

- [ ] **Submitted before the deadline** — not yet submitted.

- [ ] **After the deadline: freeze everything** — not yet applicable. No commits to `main` after
      submitting until winners are announced; fork to keep building.

- [ ] **Live URL stays up through judging** — Vercel Hobby projects do not idle static deployments,
      but **confirm the project will not be deleted or the deployment superseded**, and do not run a
      second canonical URL.

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
| `npm test` | **328 passing**, 18 files |
| `npm run build` | 5 static files, no functions |
| `npm run verify:browser` | **22 checks passing** against real Chrome 152 + real WebMCP |
| `scripts/run-evals.mjs` | 7 structural eval cases run against the live deployment |
| `scripts/screenshots.mjs` | 9 screenshots captured from the live deployment |

---

## Scope

1. **Verified in Chrome (latest) with the WebMCP flag** — by hand and by the automated harness.
   Not yet driven by a language model in ChatGPT's built-in browser, which supports a documented
   subset that Parity already stays inside.
2. **Case 6 reproduced spec issue #288** at the mechanism level: injected input approved the page's
   own card and was logged as a trusted event. Documented as the reason page-side approval is called
   *necessary, not sufficient*. It cannot be closed from inside a page.
3. **`find_providers`' 5-result cap is not exercised by the fixture** — three providers per
   specialty. The truncation code and its note are written and unit-asserted.
