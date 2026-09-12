# Parity — Devpost submission copy

**Devpost:** <https://devpost.com/software/parity-uy7opk>
**Live:** <https://parity-webmcp.vercel.app/>
**Repo:** <https://github.com/mysticalseeker24/parity-webmcp>
**Thumbnail:** `docs/brand/devpost-thumbnail.png`
**Gallery images:** `docs/screenshots/` — suggested order: `hero.png`,
`lockstep-panel.png`, `command-palette.png`, `prompt-injection.png`, `grant-card.png`,
`audit-trail.png`, `calendar.png`

---

<!-- Paste everything below into the Devpost "description" field.
     Four required points, in order. ~570 words. -->

## Why booking specialist care fits WebMCP

Booking a specialist is a constraint-satisfaction problem: insurance × language
× wheelchair access × ASL interpreter lead time × paratransit pickup window ×
caregiver availability × appointment length. No booking site lets you express
those at once, so today it is forty minutes of phone calls.

The people with the most constraints are disproportionately the people the
interface already blocks — calendar grids with no keyboard path, custom
dropdowns with no roles. Chrome's own WebMCP docs use `date_pick` as the
canonical control an agent cannot understand. Calendar grids are simultaneously
among the web's most notorious accessibility failures. **That overlap is the
entire product.** A constraint solver is exactly what an agent is good at, and
the tools that let it solve are the same tools that give a keyboard user a way
in.

## How it improves the experience

Parity has one tool registry. The visual UI, a `⌘K` command palette, voice, and
your agent are all *callers* of it.

The palette is not a menu of app features. It calls
`document.modelContext.getTools()` — the same discovery API the agent uses — and
executes through `executeTool()`. Every form in it is generated from the tool's
own JSON Schema, and each field's label **is** its schema description. That is
the inverse of spec issue **#286**: rather than deriving a parameter description
from an accessible name, the accessible name *is* the parameter description, so
they cannot drift apart. Voice works the same way — the grammar is assembled
from each tool's declared aliases and the enum values in its own schema, so a
new tool becomes speakable the moment it is defined.

Second contribution: **agentic browsing is currently an accessibility
regression.** When an agent fills a form, the DOM mutates silently — a sighted
user watches it happen, a blind user is told nothing. Every execution here
announces through `aria-live` with the actor named: *"Agent selected Dr. Amara
Okafor."* One fix, both surfaces.

## What people and agents can now do together

Ask for "the earliest wheelchair-accessible neurologist who takes my plan, with
an interpreter" and the agent solves it — while you watch each step land and
hear it announced. Then take over mid-flow with the keyboard, from the same
registry, and undo what the agent just did.

The agent cannot commit a booking: `confirm_booking` returns
`pending_authorization` and an approval card appears that only a human can act
on. When a tool disappears, the agent is not left guessing — spec issue **#262**
calls that semantic context blindness, and
`get_booking_state.unavailable[]` returns `{tool, reason_code, unlock_by}` for
every non-live tool, so *"the hold expired — call hold_slot"* survives the
unregistration that destroyed it.

## How WebMCP is implemented

No server. A static SPA; the browser is the MCP client, the page is the server
made of closures.

- **19 tools defined, never more than 8 registered.** Each carries
  `available(state)`; the registry diffs
  `allTools.filter(t => t.available(state))` on every store change and
  registers/unregisters via `AbortController`. Illegal actions are prevented by
  *absence* — Parity's answer to **#255**, built from existing primitives.
- **One `defineTool` spec → six consumers**: registration (`z.toJSONSchema`),
  palette form, voice grammar, runtime validation, announcement, audit entry.
- **One typed envelope** (**#282**): refusals *fulfil* with
  `{ok:false, kind, reason, next}`; only bugs throw.
- **One grant gate, three callers.** SHA-256 over canonical arguments, 120 s
  expiry, consumed once, re-validated at commit.

And the honest part. Spec issue **#288** records a host clicking a page's own
Approve button. **We reproduced it:** CDP-injected input approved our card and
the page logged it as a *trusted event*. So we say page-side approval is
**necessary, not sufficient**, record `delta_ms` and modality, and flag sub-second
approvals. We add no CAPTCHA, because every trick that would stop #288 excludes
the users this exists for.

Offered as a datapoint, not a complaint: a page cannot tell injected input from a
human, so the capability has to come from the layer that can. That is a concrete
argument for **#165**'s `requestUserInteraction()`, which we feature-detect on
every call and found **absent in Chrome 152**.

> Building your website for agents is how you finally make it usable by the
> humans your interface locked out. It is the same work, not two projects.
