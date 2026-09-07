# Accessibility conformance

Target: **WCAG 2.1 AA**.

This is an accessibility product, so the accessibility work *is* the product —
not a checklist bolted on at the end. Everything below is enforced by a test
that fails the build if it regresses, unless marked otherwise.

Re-run the whole set with `npm run verify` (328 unit tests + 22 real-Chrome
checks), or `npm test` for the unit tests alone.

---

## The whole booking, keyboard only

`src/App.test.tsx` and `src/components/CommandPalette.test.tsx` each drive a
complete booking with `@testing-library/user-event`, which dispatches real key
events and honours `tabindex`, `disabled` and focus order. **No pointer events
are used at all.**

| Step | Driven by | Surface |
|---|---|---|
| Reach the specialty field | `Tab` | visual UI |
| Toggle an accommodation | `Space` | visual UI |
| Submit the search | `Enter` | visual UI |
| Select a provider | `Enter` | visual UI |
| Hold a slot from the grid | `ArrowRight`, `Enter` | visual UI |
| Type intake into labelled fields | typing | visual UI |
| Reach and activate Confirm | `Enter` | visual UI |
| The same booking again, end to end | `Ctrl+K`, arrows, `Enter` | command palette |

Two independent keyboard paths to every capability: the visual controls, and the
palette. Voice is a third, and it routes *through* the palette rather than
executing, so it inherits that path rather than creating a new one.

### Manual pass

Walked by hand in **Chrome (latest)** with WebMCP enabled, in addition to the
automated runs: the full booking completed with the keyboard only, the command
palette opened and executed with `⌘K`/`Ctrl+K`, the availability grid navigated
with arrows, and the consent card reached and approved without a pointer.

---

## The availability grid

The control the whole product argument rests on.
`src/components/Calendar.test.tsx`.

| Requirement | Verified by |
|---|---|
| Real `<table>` with a `<caption>` | test |
| `<th scope="col">` dates, `<th scope="row">` times | test |
| One tab stop for the grid, not 160 (roving `tabindex`) | test |
| Arrow keys move between open slots | test |
| `Home` / `End` jump along the row | test |
| `PageUp` / `PageDown` jump along the column | implementation |
| `Enter` / `Space` holds the focused slot | test |
| `Escape` leaves the grid — no keyboard trap | test |
| The focused cell is announced via `aria-live` | test |
| Cell accessible name carries date, time and length | test |
| Held state carries the word "Held", not only colour | test |
| Taken slots say "Taken" and are not focusable | test |
| Arrows never wrap or escape the grid at its edges | test |

The grid skips cells that cannot be held, so arrow keys never land on a dead
cell. Focus moves only after a key press, never on an unrelated re-render —
otherwise a state change elsewhere would steal focus mid-typing.

---

## Forms

| Requirement | Verified by |
|---|---|
| Every input has a real `<label for>` | test (queried by label text) |
| Date of birth is a text input with an ISO example, not a date picker | test |
| The ISO hint is wired with `aria-describedby`, so it is spoken | implementation |
| Field errors set `aria-invalid` and are linked by `aria-describedby` | test |
| Error text comes from the tool, so agent and human are told the same thing | test |
| Completeness listed in words: "Still needed: Date of birth, …" | test |
| Accommodation checkboxes generated from the `z.enum` | test |
| Checkbox groups wrapped in `<fieldset>` + `<legend>` | implementation |
| Palette form labels **are** each field's schema description (#286) | test |
| Required fields marked in text, not by colour | test |

---

## Announcements

`src/lib/announcer.test.ts`.

| Requirement | Verified by |
|---|---|
| Every execution announces — agent-initiated included | test |
| The actor is named: "Agent found…" / "You found…" | test |
| Wording comes from the tool's own `announce()`, never a call site | test |
| A tool leaving the palette announces *why*, from `reasons.ts` (#262) | test |
| Hold expiry announces as an interruption | test |
| Successes polite, refusals assertive | test |
| A tool whose `announce()` throws does not take the live region down | test |
| Two regions — one polite, one assertive — mounted before any text arrives | test |

The same lines render on screen in *What just happened*, so a sighted user can
also see that the agent changed something.

---

## Command palette

| Requirement | Verified by |
|---|---|
| Opens with `Ctrl`/`Cmd`+`K` and with a visible button | test |
| Labelled `combobox` controlling a `listbox` | test |
| `aria-activedescendant` tracks the active option | test |
| Result count announced in a live region, updating as you type | test |
| Arrow keys move the active option | test |
| `Escape` from the form returns to the list; `Escape` again closes | test |
| Closing restores focus to whatever opened it | test |
| Commands grouped in workflow order (#255) | test |
| Refusal rendered as kind + reason + an actionable next step | test |

`Escape` has two levels deliberately. Collapsing it into one would discard a
half-filled form on a mis-key, which is worse for someone typing slowly with a
switch or an on-screen keyboard.

---

## Voice

| Requirement | Verified by |
|---|---|
| Feature-detected; says "Voice needs Chrome" rather than showing a dead button | implementation |
| **Voice never executes** — a match opens a pre-filled form and waits for Run | test |
| The palette shows what was heard, so a mishearing is visible before anything runs | implementation |
| Every voice-reachable capability is reachable by keyboard | test |
| Microphone refusal is explained and points at the keyboard path | implementation |
| The grammar only ever matches tools registered right now | test |

Voice is an addition to `⌘K`, never a replacement. Speech recognition mishears;
the win is reaching the right form without typing — the part that is hard with a
motor impairment — not skipping the confirmation.

---

## Never colour alone

Every state that is coloured also carries text, or an `aria-hidden` glyph beside
a word.

| State | Non-colour signal | Verified by |
|---|---|---|
| Selected provider | "· Selected" | test |
| Refused selection | "✕ Cannot select: …" | test |
| Held slot | "Held" in the cell; "held, expires in m:ss" in the summary | test |
| Taken slot | "Taken" | test |
| WebMCP badge | "WebMCP: detected" / "not detected" + ✓ / ! | test |
| Form error | "✕" + the reason | implementation |
| Accommodation | icon is `aria-hidden`; the label is always words | test |
| Possibly-automated approval | the words "possibly automated" + `delta_ms` | test |

---

## Structure, focus and motion

| Requirement | Verified by |
|---|---|
| Skip link is the first tab stop | test |
| Eight `<section>`s, each `aria-labelledby` its `<h2>`, in document order | test |
| Tab order equals visual order — no positive `tabindex` anywhere | implementation |
| Visible focus indicator, plus a global `:focus-visible` fallback | implementation |
| Focus follows the work on a stage change, and the move is announced | test |
| Focus moves only on a real stage change, never on an unrelated re-render | test |
| Focus returns to its origin when the grant card closes | test |
| `prefers-reduced-motion` honoured globally | implementation |
| The loading screen never gates content, is skipped under reduced motion, is dismissed by any key, and is `aria-hidden` | implementation |

---

## Contrast

Computed against the risograph palette on its actual backgrounds. Target is
4.5:1 for body text, 3:1 for large text and UI boundaries.

| Pair | Ratio | Verdict |
|---|---|---|
| ink `#1e2a4a` on stock `#f4efe2` | ~13.0:1 | pass — all body text |
| ink-soft `#46527a` on stock | ~7.0:1 | pass — secondary text |
| stock on ink (buttons, badges) | ~13.0:1 | pass |
| ink on spot `#ef8358` (step badges) | ~4.8:1 | pass — bold text at this size |
| spot-deep `#d9663a` on stock (errors) | ~4.6:1 | pass |
| spot `#ef8358` on stock | ~2.2:1 | **decoration only — never text** |

That last row is the governing constraint of the whole visual design. Peach
appears as the misregistration shadow on the headline, the rule under the
header, the step badges (as a *background*, with ink text on it), and the second
ink in the hero motif — **never as body copy on cream**. A print aesthetic is
not worth an unreadable interface in an accessibility product.

Two fixes came out of this pass: empty calendar cells moved off a 2.6:1 grey,
and errors moved to `spot-deep`, which stays on-palette and passes while keeping
its `✕` marker so nothing is colour-alone.

---

## Progressive enhancement

The site is fully usable with **no WebMCP at all**. The badge says so, the
palette falls back to the local registry, and every visual control still works.
Asserted by a test that starts the registry with `document.modelContext`
removed.
