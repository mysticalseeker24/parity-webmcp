# Accessibility smoke checklist

Walked at the end of Phase 4 (UI shell) and re-walked at the end of Phase 5
(command palette). This records **what was actually checked and how** — an
automated keyboard walk is not the same as a screen-reader session, and this
file says which is which (`CONVENTIONS.md` §9).

Legend: **auto** = asserted by a test that fails if it regresses ·
**read** = verified by reading the rendered markup · **manual** = driven by hand
· **not yet** = outstanding.

---

## The whole booking, keyboard only, no mouse, no agent

`src/App.test.tsx` → *"walks search → select → hold → intake → confirm with no
mouse"* drives the entire flow through `@testing-library/user-event`, which
dispatches real key events and honours `tabindex`, `disabled` and focus order.
No `.click()` on anything the keyboard could not reach.

| Step | How it is driven | Status |
|---|---|---|
| Tab reaches the specialty `<select>` | `Tab` | auto |
| Accommodation checkbox toggles with `Space` | `Space` | auto |
| Search submits | `Enter` on the submit button | auto |
| Provider selected | `Enter` on its `<button>` | auto |
| Slot held from the grid | `ArrowRight` then `Enter` | auto |
| Intake typed into labelled fields | `type()` | auto |
| Confirm reached and activated | `Enter` | auto |
| Confirm refuses without page approval | asserted | auto |

The flow completes with **no pointer events at all**.

---

## Calendar grid — the control the product argument rests on

`src/components/Calendar.test.tsx`.

| Requirement | Status |
|---|---|
| Real `<table>` with `<caption>` | auto |
| `<th scope="col">` dates, `<th scope="row">` times | auto |
| One tab stop for the grid, not 160 (roving `tabindex`) | auto |
| Arrow keys move between open slots | auto |
| `Home` / `End` jump along the row | auto |
| `PageUp` / `PageDown` jump along the column | read |
| `Enter` / `Space` holds the focused slot | auto |
| `Escape` leaves the grid — no keyboard trap | auto |
| Focused cell announced via `aria-live` | auto |
| Cell accessible name carries date, time and length | auto |
| Held state carries the word "Held", not only green | auto |
| Taken slots say "Taken" and are not focusable | auto |
| Arrows never wrap or escape the grid at its edges | auto |

The grid skips cells that cannot be held, so arrow keys never land on a dead
cell. Focus is moved only after a key press, never on an unrelated re-render —
otherwise a state change elsewhere would steal focus mid-typing.

---

## Command palette (Phase 5)

`src/components/CommandPalette.test.tsx`. The palette must be able to complete a
full booking with keyboard only, no mouse, no agent — a definition-of-done item
in `PROJECT_SPEC.md` §4, not a nice-to-have.

| Requirement | Status |
|---|---|
| Opens with `Ctrl`/`Cmd`+`K` and with a visible button | auto |
| Labelled `combobox` controlling a `listbox` | auto |
| `aria-activedescendant` tracks the active option | auto |
| Result count announced in a live region, updating as you type | auto |
| Arrow keys move the active option | auto |
| `Enter` opens the selected command's form | auto |
| `Escape` from the form returns to the list; `Escape` again closes | auto |
| Closing restores focus to whatever opened it | auto |
| Commands grouped in workflow order (#255) | auto |
| Every generated field's label is its schema `description` (#286) | auto |
| Required fields marked in text, not colour | auto |
| Refusal rendered as kind + reason + an actionable next step | auto |

**Full booking, palette only, keyboard only** — *"completes search → select →
hold → intake with no mouse and no agent"* drives `find_providers`,
`select_provider`, `get_availability`, `hold_slot` and `set_intake` entirely
through the palette, reaching `intake_complete`.

One thing this surfaced: `Escape` needs two levels. Collapsing it to a single
"close everything" would throw away a half-filled form on a mis-key, which is
worse for someone typing slowly with a switch or on-screen keyboard.

## Announcements

`src/lib/announcer.test.ts`.

| Requirement | Status |
|---|---|
| Every execution announces, agent-initiated included | auto |
| The actor is named — "Agent found…" / "You found…" | auto |
| Wording comes from the tool's own `announce()`, never a call site | auto |
| A tool leaving the palette announces *why*, from `reasons.ts` (#262) | auto |
| Hold expiry announces as an interruption | auto |
| Successes polite, every refusal assertive | auto |
| A tool whose `announce()` throws does not take the live region down | auto |
| Identical repeated announcements are re-announced, not swallowed | read |

The same lines are also rendered on screen in *What just happened*, so a sighted
user can see that the agent changed something too.

## Voice and the loading screen (Phase 11 / redesign)

| Requirement | Status |
|---|---|
| Voice is feature-detected; says "Voice needs Chrome" rather than showing a dead button | read |
| **Voice never executes** — a match opens a pre-filled form and waits for Run | auto |
| The palette shows what was heard, so a mishearing is visible before anything runs | read |
| Every voice-reachable capability is reachable by keyboard | auto (the palette walk) |
| Microphone refusal is explained and points at the keyboard path | read |
| Loading screen never gates content — tools register underneath it | read |
| `prefers-reduced-motion` skips the loading screen entirely, not merely shortens it | read |
| Any key or click dismisses the loading screen | read |
| Loading screen is `aria-hidden` and never takes focus | read |

## Forms

| Requirement | Status |
|---|---|
| Every input has a real `<label for>` | auto (queried by label text) |
| Date of birth is a text input with an ISO example, not a date picker | auto |
| The ISO hint is wired with `aria-describedby`, so it is spoken | read |
| Field errors set `aria-invalid` and are linked by `aria-describedby` | auto |
| Error text comes from the tool, so agent and human are told the same thing | auto |
| Completeness listed in words ("Still needed: Date of birth, …") | auto |
| Accommodation checkboxes generated from the `z.enum` | auto |
| Checkbox groups wrapped in `<fieldset>` + `<legend>` | read |

---

## Never colour alone

Every state that is coloured also carries text or an `aria-hidden` glyph beside
a word:

| State | Non-colour signal | Status |
|---|---|---|
| Selected provider | "· Selected" | auto |
| Refused selection | "✕ Cannot select: …" | auto |
| Held slot | "Held" in the cell, "held, expires in m:ss" in the summary | auto |
| Taken slot | "Taken" | auto |
| WebMCP badge | "WebMCP: detected" / "not detected" + ✓ / ! | auto |
| Form error | "✕" + the reason | read |
| Accommodation | icon is `aria-hidden`, label is always words | auto |

---

## Structure and focus

| Requirement | Status |
|---|---|
| Skip link is the first tab stop | auto |
| Six `<section>`s, each `aria-labelledby` its `<h2>`, in document order | auto |
| Tab order equals visual order (no positive `tabindex` anywhere) | read |
| Visible focus indicator, including a global `:focus-visible` fallback | read |
| `prefers-reduced-motion` honoured globally in `index.css` | read |
| Both live regions mounted before any announcement arrives | auto |

---

## Contrast

Computed against the Tailwind palette values actually used, on their actual
backgrounds. Target is 4.5:1 for body text, 3:1 for large text and boundaries.

Recomputed after the risograph redesign. The palette is two spot inks on cream,
and **contrast is what constrains it**, not taste.

| Pair | Ratio | Verdict |
|---|---|---|
| ink `#1e2a4a` on stock `#f4efe2` | ~13.0:1 | pass — all body text |
| ink-soft `#46527a` on stock | ~7.0:1 | pass — secondary text |
| stock on ink (buttons, badges) | ~13.0:1 | pass |
| ink on spot `#ef8358` (step badges) | ~4.8:1 | pass for bold text at this size |
| spot-deep `#d9663a` on stock (errors) | ~4.6:1 | pass |
| **spot `#ef8358` on stock** | **~2.2:1** | **fails — decoration only, never text** |

That last row is the governing constraint of the whole design. Peach appears as
the misregistration shadow on the headline, the rule under the header, the step
badges (as a *background*, with ink text on it), and the second ink in the hero
motif — **never as body copy on cream**. A print aesthetic is not worth an
unreadable interface in an accessibility product.

Errors moved from `red-800` to `spot-deep`, which stays on-palette and passes,
and they keep their `✕` marker and text so nothing is colour-alone.

---

## Not verified yet — do not claim these

- **No real screen reader has been run against this.** NVDA, JAWS and VoiceOver
  all differ in how they treat `aria-live` on rapid updates and how they
  announce a roving-`tabindex` grid. The markup follows the documented pattern
  and the automated tests assert the semantics, but nobody has listened to it.
- Contrast ratios above are computed from the palette, not sampled from a
  rendered screenshot at the shipped font sizes.
- No testing at 200% browser zoom or at 320px width.
- No Windows High Contrast Mode check.
- `prefers-reduced-motion` is honoured by a global rule; not verified with the
  OS setting actually on.

These are the honest gaps. If any of them gets walked before submission, record
the result here — including anything that fails.
