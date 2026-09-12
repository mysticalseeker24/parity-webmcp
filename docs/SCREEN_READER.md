# SCREEN_READER.md — the part a machine cannot do

`npm run audit:a11y` checks two things automatically: axe-core over every stage of the booking flow, and the accessibility tree Chrome exposes. Both are real, and neither answers the question that matters.

A clean axe run means no *detectable* violation. It does not mean the page is usable. It cannot tell you whether the reading order makes sense, whether an announcement arrives at a useful moment or three seconds after you have moved on, whether the calendar is navigable or merely traversable, or whether the whole flow is bearable. Those need a screen reader and a person.

**As of this writing, no screen reader has been run against this build, and no disabled person has used it.** That is stated in the README and in [`FUTURE.md`](./FUTURE.md), and it was stated to the WebMCP working group on [#277](https://github.com/webmachinelearning/webmcp/issues/277). This file exists so the gap can be closed properly rather than quietly.

---

## Before you start

- **NVDA** (free) from [nvaccess.org](https://www.nvaccess.org/download/). A *portable copy* avoids installing anything.
- **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` enabled.
- Turn on NVDA's **Speech Viewer** (`NVDA menu → Tools → Speech Viewer`). It prints what is being spoken, so you can copy exact strings into the log below instead of paraphrasing from memory.
- Run at NVDA's default speech rate. Speeding it up hides latency problems that a real user would hit.

`Insert` is the NVDA key below. `Caps Lock` works if you enabled that during setup.

---

## What to record

For each task: **what you heard, verbatim**, and whether you could complete it without looking at the screen. Not "worked fine" — the actual words. A verbatim string is evidence; an impression is not.

Mark each one:

- **PASS** — completed without sight, and what was announced matched what happened
- **PARTIAL** — completed, but something was unclear, late, or had to be inferred
- **FAIL** — could not complete, or was told something untrue

**Turn the monitor off, or close your eyes.** Reading the screen while "testing with a screen reader" is the most common way this exercise produces a false pass.

---

## The tasks

### 1. Orientation
Load the page. Press `Insert`+`↓` to read continuously from the top.

- Do you learn what the site is for within the first few seconds?
- Is the WebMCP detection status announced, or silent?
- Do the section headings (`Insert`+`F7`, Headings) describe a flow you could navigate by?

### 2. Search, by keyboard only
`Tab` to the search form. Set a specialty, tick an accommodation, submit.

- Is each field's purpose clear from its label alone?
- **Is the result announced?** This is the live region. Note the exact wording and roughly how long after submitting it arrived.

### 3. The calendar grid
`Tab` into the availability grid.

- Is it announced as a table, with its caption?
- Do arrow keys move by cell, and is the date **and** time of the focused cell spoken — or only one of them?
- Is a cell you cannot book distinguishable from one you can, **without colour**?
- With a paratransit window set, does an excluded cell say *why* it is excluded?
- Does `Escape` leave the grid, or does focus trap?

### 4. The command palette
`Ctrl`+`K`.

- Is the dialog announced with a name, and does focus land in the search field?
- Are the options announced as a list, with position ("3 of 7")?
- Open a command. **Is each generated field's label spoken?** These labels are generated from the tool's own parameter descriptions — this is the [#286](https://github.com/webmachinelearning/webmcp/issues/286) claim, and it either holds aurally or it does not.
- Run it. Is the result announced, and is the payload reachable?
- Does `Escape` close it and return focus where you started?

### 5. The announcement that justifies the whole project
With the palette closed, have an agent — or a second browser tab driving the tools — run `select_provider`.

- **Are you told that something changed, without having gone looking?**
- Is the actor named?
- If you are doing something else at that moment, does the announcement interrupt you or wait?

This is the second contribution in the README. If a screen-reader user is not reliably told that an agent acted, the claim is not true, and the README must change rather than the finding.

> Note the announcement says "Agent" or "You" based on an **inference**, not a known fact — `executeTool()` carries no caller identity. If you ever hear the wrong actor named, that is a finding worth reporting on [#277](https://github.com/webmachinelearning/webmcp/issues/277), because it is the concrete harm behind an abstract API gap.

### 6. Intake, and being told you were wrong
Fill the intake form, entering the date of birth as `14/10/2026` on purpose.

- Is the error announced, or does it appear silently?
- Does the error name the field, and can you get from the announcement to the field that needs fixing?
- Is the ISO example spoken as part of the field's instructions, before you make the mistake?

### 7. Consent
Trigger `confirm_booking` and reach the approval card.

- Is the card announced when it appears? It is an `alertdialog`.
- Are the appointment details — provider, date, time — spoken **before** you reach the Approve button?
- Approve is disabled for 1.5 seconds. Is that communicated, or does the button just silently fail?
- Could you tell a fraudulent request from a legitimate one using only what was spoken?

### 8. The whole booking, unsighted
Screen off, from a fresh load: search → choose → hold → intake → confirm.

Record the wall-clock time and every point where you had to guess.

---

## Recording the results

Append to `evals/screen-reader.md`, one row per task:

```markdown
| # | Task | Verdict | Heard (verbatim) | Notes |
|---|------|---------|------------------|-------|
| 1 | Orientation | PASS | "Parity, specialist care booking. WebMCP detected…" | |
```

Head the file with the exact versions — they are the difference between a result and an anecdote:

```markdown
NVDA 2026.x · Chrome 152.x · Windows 11 · <date> · tested by <name>
Synthesizer: <the default, or whichever you used>
```

**Record failures in full.** A screen-reader pass that finds nothing is not a good result, it is an unconvincing one — and for an accessibility product, an unconvincing accessibility claim is worse than an honest defect. The two spec threads this project contributed to were both taken seriously because they described what did *not* work.

---

## Afterwards

1. **Fix what the run found**, then re-run the affected task rather than assuming the fix landed.
2. **Update the claims.** README's accessibility section and `FUTURE.md`'s "Owed" list both currently say no screen reader has been run. When one has, those sentences change — including the "no disabled person has used this" line, which only changes if that is also true.
3. **Report back on [#277](https://github.com/webmachinelearning/webmcp/issues/277).** `mlmrx` explicitly asked that the stated limitation travel with the implementation report. Real screen-reader results are the one thing that would upgrade it from implementation experience to accessibility evidence — and nobody else in that thread has offered any.
