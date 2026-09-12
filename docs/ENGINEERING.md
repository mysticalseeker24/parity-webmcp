# ENGINEERING.md — how to work on this, and what we got wrong

`CLAUDE.md` says what this project is and what not to build. This file is the other half: the working practices, each one derived from a specific mistake made here rather than from general advice. Every rule below has an incident attached, because a rule without one is forgettable.

Read it before making claims, writing tests, or posting anything upstream.

---

## 1. A browser is not the specification

**The mistake.** We measured Chrome 152 calling `execute` with one argument and no `AbortSignal`, and reported to the working group that the spec's proposal was unimplementable because "there is nothing to observe". We did the same for [#300](https://github.com/webmachinelearning/webmcp/issues/300), calling the behaviour "unavoidable for any registry that derives its live set from page state" — in our own README.

Both were wrong in the same way. `@mlmrx` read the algorithms and pointed out that the draft **already** passes `ToolExecuteCallbackOptions.signal` to `execute`, and [#248](https://github.com/webmachinelearning/webmcp/pull/248) **already** says unregistration must not orphan a started execution. Chrome 152 was behind the spec. We had described a browser and called it the standard — in public, twice, having flagged the same error in someone else's paragraph two days earlier.

**The rule.** Before describing any behaviour as a gap in a specification:

1. Read the specification source. For WebMCP that is `index.bs` in the spec repo, not the explainer, not the types package, not a blog post.
2. State the browser and full version with every measurement. `"Chrome 152.0.7977.83"`, not `"Chrome"`.
3. Distinguish the three cases explicitly, because the remedy differs for each:
   - **spec gap** — the draft does not provide it → propose a change
   - **conformance bug** — the draft provides it, the browser does not → file a bug, write a WPT case
   - **implementation lag** — shipped later, already fixed upstream → note the version and the CL

**How to apply.** Any sentence of the form "the spec does not allow X" needs a line-level citation next to it. If you cannot produce one, the sentence is about a browser.

---

## 2. Never write a number you have not measured

**The mistake.** `index.css` carried this for weeks:

```css
--color-spot-deep: #d9663a; /* 4.6:1 on stock — small marks, borders */
```

It measured **3.09:1**. The comment was an estimate written in the shape of a fact, and everything downstream trusted it: every error message, the untrusted-content fence, and a link were below WCAG 1.4.3 AA. Reading the markup never caught it, because only one of those was on screen in a happy-path state.

**The rule.** A number in a comment, a README, or a claim is a measurement or it does not appear. Contrast ratios, character budgets, test counts, tool counts. If it is worth stating, it is worth computing — and once computed, it is worth asserting in a script so it cannot drift.

**How to apply.** `npm run audit:a11y` now measures contrast at every stage rather than trusting the token comment. `find_providers` derives its result count from the 1.5K budget rather than a hardcoded 5, because a hardcoded 5 silently blew the budget the moment provider records got richer — and the budget assertion is dev-only, so production shipped it.

---

## 3. Stale numbers are the most common defect in this repo

**The mistake.** Repeatedly, and never caught by any test:

- README said 328 tests and 22 browser checks when there were 385 and 36
- the shooting script said `19 / 7` live tools after the cap moved to 8
- `TOOLS.md` said 12 providers after there were 16
- the Devpost copy still said 7 live tools three commits after everything else was corrected

None of these are bugs. All of them are false claims in submission-facing text, which is worse.

**The rule.** When you change a number that is stated anywhere, grep for it immediately — in `README.md`, `docs/`, `.agent/`, and any artifact. Treat the search as part of the change, not as follow-up.

```bash
grep -rnE "\b(385|36|19|16|8)\b" README.md docs/ .agent/ | grep -vE "^\S+:\s*$"
```

**How to apply.** The counts that appear in prose are: unit tests, real-Chrome checks, accessibility checks, tools defined, max live tools, providers, and spec issues answered. Changing any one of them is a documentation change too.

---

## 4. A test that passes before the fix tests nothing

**The mistake.** We narrowed the actor-attribution window, then wrote a regression test for it. Before committing, we reverted the fix and ran the test again — **it passed**. The existing keyed-mark test already covered the case, and the remaining window was not deterministically reproducible. The test was decoration.

**The rule.** For any regression test, run it against the broken code before you keep it. If it passes there, either the test is wrong or the bug is not what you think it is. Both are worth knowing.

If a fix genuinely cannot be tested deterministically — a timing window, a race — say so in the commit message and do not ship a test that pretends otherwise. We deleted that one and explained why.

**How to apply.** Our WPT submission was validated exactly this way: it fails on Chrome 152 with the real error string and passes on Chromium 153. A conformance test that passes on the buggy build catches nothing.

---

## 5. Audit the states your happy path never reaches

**The mistake.** The first accessibility audit drove the booking flow and came back clean. But five of the nine uses of the failing colour were **error messages**, and no error had been rendered. The audit was checking the states where contrast matters least.

**The rule.** Any sweep — accessibility, performance, visual — must reach the failure states deliberately. Refusals, empty results, expired holds, permission denials. Those are where the user is already in trouble, and where defects do the most harm.

**How to apply.** `a11y-audit.mjs` submits an intentionally invalid date of birth to force a refusal, and asserts the error actually rendered before auditing that state. Add a stage rather than assume a global fix covered it.

---

## 6. Fix at the layer the problem is on

**The mistake.** For [#300](https://github.com/webmachinelearning/webmcp/issues/300) we deferred the *entire* re-sync whenever it would cut a running tool. It worked, but it delayed registrations that were never at risk — so the calendar asked for availability before the tool providing it had been registered, took an `unavailable`, and cached it. We then added a guard in the Calendar to work around our own fix.

`@minjikim89` proposed the narrower version: never defer the sync, skip only the individual *unregistration* of a tool that is currently executing. Registrations never wait, so the second bug cannot arise at all.

**The rule.** When a fix requires a second fix at the call site, the first fix was at the wrong layer. Go back. A workaround for your own workaround is a design smell, not a subtlety.

**How to apply.** Prefer the narrowest condition that is sufficient. "Defer everything when anything is at risk" is easier to write and worse than "defer exactly the thing at risk".

---

## 7. `.finally()` is not "after"

**The mistake.** The first attempt at the #300 fix scheduled re-registration in the executing tool's own `.finally()`. It still rejected the caller, because `.finally()` runs while the browser is still awaiting that call. Only `setTimeout(…, 0)` — a fresh task — landed after the result was delivered.

**The rule.** "After the promise settles" and "after the caller has the value" are different moments. When the boundary is a platform API awaiting your promise, the end of your own promise chain is still inside its call.

**How to apply.** If ordering across a platform boundary matters, verify it in the real browser. This is not inferable from reading the code, and no mock will show it.

---

## 8. Authoring on Windows, publishing to POSIX

**The mistake.** Our WPT submission went up with 89 CRLF line endings. WPT's linter rejects `CR AT EOL`, and it would have failed CI in front of reviewers.

Separately: `grep -c $'\r'` counts *lines containing* CR, not CR bytes, and reported a wrong answer twice. The byte-level check was the one that settled it.

**The rule.** Anything leaving this machine for a POSIX-first project gets normalised to LF and verified at byte level before it is pushed.

```bash
python -c "d=open('f','rb').read(); print('CR bytes:', d.count(b'\r'))"
```

**How to apply.** Also relevant: `git mv` with case-only renames needs two steps on Windows, which is how `Public/` shipped to Vercel's Linux and broke every static asset.

---

## 9. Contributing upstream

The WebMCP repo is a **W3C Community Group specification repo**, not a library. There is nothing to implement. Two of a hundred issues are assigned, both to spec editors; the `good first issue` and `help wanted` labels have zero issues on them. Asking to be assigned marks you as unfamiliar with how standards work.

What is scarce there is **implementation experience**. That is what gets adopted.

**Rules that earned results here:**

- **Lead with the finding, never an introduction.** No "Hi, I'm X, I built Y." Link the repo once at the bottom as provenance so people can check the claim.
- **Be specific enough to be checkable.** Exact version, exact error string, the code you ran. `"The operation failed for an unknown transient reason (e.g. out of memory)"` is evidence; "it errors" is not.
- **State what you did not verify.** The single sentence "no screen reader has been run against this build" is what made the rest of an accessibility report credible to an accessibility working group.
- **Comment only where you have data.** Two good comments beat six opinions. We deliberately skipped [#305](https://github.com/webmachinelearning/webmcp/issues/305) because it is an editorial question about algorithm steps and we had nothing.
- **Do not bump.** If you hold the last word and nobody has asked anything, wait. Posting again with nothing new reads as working the room.
- **Correct yourself in public, quickly and without ceremony.** When `@mlmrx` corrected our framing we took it, verified it first-hand, fixed our own docs, and said so. That cost nothing and was the point at which the exchange became collaborative.
- **Adopt a better idea when you are handed one.** `@minjikim89`'s formulation was better than ours; we switched, said why, and reported back.

**Outcomes, for calibration:** enforcement by absence is now mitigation **(d)** in the body of [#298](https://github.com/webmachinelearning/webmcp/issues/298), credited; our reproduction is cited in the body of [#300](https://github.com/webmachinelearning/webmcp/issues/300); [WPT #62642](https://github.com/web-platform-tests/wpt/pull/62642) is the conformance case `@mlmrx` asked for. None of that came from advocacy. It came from measurements nobody else had taken.

---

## 10. Verify against the deployment, not the build

**The mistake, avoided rather than made.** Twice the local build was correct while the deployed site was not — a case-only rename that broke on Linux, and a redeploy that had not yet happened when a demo was about to be recorded.

**The rule.** "It works" means it works at the URL a judge will open. `npm run verify` drives `dist/`; the live check drives the deployment. Compare the bundle hash to be sure you are not testing a cache:

```bash
grep -o 'assets/index-[A-Za-z0-9_-]*\.js' dist/index.html
curl -s https://parity-webmcp.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
```

---

## 11. Cross-version verification is available locally

Chrome and Edge ship different Chromium versions. On this machine that meant Chrome **152** and Edge **153** — both sides of two upstream fixes, without downloading anything.

```bash
BROWSER_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node probe.mjs
```

This is how we confirmed that Chrome 152 was lagging rather than the spec being wrong, and that our WPT test fails on 152 and passes on 153. Check what versions are actually installed before concluding you cannot test something.

Practical notes: kill lingering browser processes and use a per-port `--user-data-dir`, or the debug port silently refuses connections.

---

## 12. Probe-writing hazards, all hit at least once

Working over CDP is where most of the wasted time went:

- **CDP results are nested.** `send("Accessibility.getFullAXTree")` resolves to the whole message; the payload is `.result.nodes`. Destructuring the wrong level yields `undefined` and a confusing failure.
- **JS template literals eat backslashes.** `` `…replace(/\s+/g, " ")…` `` becomes `/s+/g` inside an evaluated string and silently deletes every letter `s`. Avoid regex inside injected source, or escape twice.
- **`.click()` is untrusted.** A synthetic click does not satisfy a consent gate that checks activation; `Input.dispatchMouseEvent` over CDP does. That distinction *is* the [#288](https://github.com/webmachinelearning/webmcp/issues/288) reproduction.
- **Prove side effects in the DOM, not in a closure.** "The work landed" was only convincing because the loop wrote `data-applied` to `document.body`. A variable inside the tool proves the function ran, not that the page changed.

---

## 13. The rules that already governed this repo, and why they held

From `CLAUDE.md`, restated because each was tested:

- **One registry, both callers.** Every bug reported in this project traced back to a surface that had quietly stopped being a caller — a form holding its own copy of search state, a grid built from the fixture instead of the tool. The rule is not architecture for its own sake; violating it is how the two halves start disagreeing.
- **Do not claim a result you have not observed.** See §1, §2 and §9. This one is load-bearing in front of a working group.
- **Enforcement by absence, not by annotation.** `readOnlyHint` is a signal to an agent, never a control. The tool that is not registered cannot be called — which is now mitigation (d) in a W3C issue.
- **No CAPTCHA, dwell puzzle, or timing challenge on the approval path.** Every mechanism that separates synthesized input from physical input is a barrier to switch access, voice control, and screen reader users — and still does not establish authorization. The distinction that matters is *agent-originated vs user-authorized*.
