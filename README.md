# Parity

**Booking specialist care, where every capability is reachable three ways — the visual interface, a keyboard and voice command surface, or your AI agent — all driving the same WebMCP tool registry.**

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/).

🔗 **Live:** `<VERCEL_URL>` — open in the **ChatGPT desktop app's built-in browser**, or Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled.
🎥 **Demo:** `<YOUTUBE_URL>`

---

## The thesis

> Building your website for agents is how you finally make it usable by the humans your interface locked out. It is the same work, not two projects.

The web has spent twenty years bolting accessibility on after the fact, and it drifts the moment anyone ships. WebMCP changes the incentive: to serve an agent, a site must declare its capabilities as typed, described, machine-readable tools. That declaration is a semantic layer that **cannot drift, because the application depends on it.**

Parity takes that to its conclusion. The human command surface is not a parallel implementation of the app's features. It calls `document.modelContext.getTools()` — the same discovery API the agent uses — and executes through `document.modelContext.executeTool()`. **One registry, two callers.** The product name is a description of the call graph, not a slogan.

---

## The problem

Booking specialist care is a constraint-satisfaction problem across dimensions no booking site lets you express at once:

- a provider who takes your insurance **and** speaks your language
- a building that is actually wheelchair accessible, not "accessible" in the marketing copy
- an ASL interpreter booked in parallel, with lead time respected
- a slot inside your paratransit pickup window
- a slot a caregiver can also attend
- extended appointment length, because fifteen minutes is not enough
- a low-sensory waiting environment

Today that is forty minutes of phone calls, or an abandoned booking.

And the people with the most constraints are disproportionately the people blocked by the interface itself — calendar grids with no keyboard path, custom dropdowns with no roles, sessions that expire mid-form. Chrome's own WebMCP documentation names `date_pick` as the canonical example of a control built for humans that agents cannot understand. Calendar grids are simultaneously among the most notorious accessibility failures on the web. **That overlap is the entire product.**

---

## The second contribution: agentic browsing is currently an a11y regression

When an agent fills a form, a screen-reader user is told nothing. The DOM mutates silently. A sighted user watches it happen; a blind user has no idea their intake form was just completed by something other than themselves.

Parity fixes this inside the standard's own primitives. Every tool execution — agent- or human-initiated — emits an `aria-live` announcement derived from the tool's own definition, naming the actor:

> *"Agent selected Dr. Amara Okafor, Neurology, wheelchair accessible, ASL available."*
> *"Agent held Tuesday 14 October, 10:30, thirty minutes. Hold expires in ten minutes."*
> *"Authorization required: confirm booking. You must approve this."*

---

## How WebMCP is implemented

**There is no server.** No backend, no database, no MCP endpoint — just a static SPA. The browser is the MCP client; the page is the server, made of JavaScript closures in a tab. Tools register with the browser on load and appear under **Site tools** in the address bar.

### One `defineTool` spec → six consumers

```ts
defineTool({
  name: "hold_slot",
  description: "Place a 10-minute hold on an appointment slot for the selected provider.",
  schema: z.object({ slot_id: z.string().describe("Slot id from get_availability.") }),
  humanLabel: "Hold a slot",
  voiceAliases: ["hold it", "reserve that slot"],
  reversible: true,
  available: (s) => s.stage === "provider_selected" && s.hasFetchedAvailability,
  announce: (i, r) => `Held ${r.human_time}. Expires in ten minutes.`,
  execute: async ({ slot_id }, { signal }) => { /* ... */ },
});
```

That single object produces: the WebMCP registration (`inputSchema` via Zod 4's native `z.toJSONSchema()`), the command palette entry (a form generated from the same schema), the voice grammar, runtime validation, the screen-reader announcement, and the audit-log entry. **Six consumers, one definition.**

### 19 tools defined, never more than 7 live

Chrome's best practices warn that overlapping tools make agents choose badly. So the design is a **large total surface with a small live surface**: each tool carries an `available(state)` predicate, and the registry re-derives `allTools.filter(t => t.available(state))` on every store change, registering and unregistering via `AbortController`.

Both surfaces observe this simultaneously. When intake completes and `confirm_booking` becomes legal, the agent receives a `toolchange` event and the human palette gains a row — from the same diff. Illegal operations are prevented by **absence of registration**, not by a runtime error.

```
browsing ──select_provider──► provider_selected ──hold_slot──► slot_held
   ▲                                  ▲                            │
   │                                  └──────release_slot──────────┘
   │                                                               │ set_intake
   │                                                               ▼
   └──────cancel_booking────── booked ◄──confirm_booking── intake_complete
```

### The consent gate

Two tools mutate irreversible state. They are the only gated ones, and the gate has four structural properties:

- **Out of band** — approved through page UI the agent cannot originate, render, or replay. No tool can approve a grant.
- **Bound to the action** — the grant is keyed to a SHA-256 hash of the canonicalised arguments. Change any argument and it is void.
- **Enforced elsewhere** — the commit path re-validates grant state at execution time. It never trusts an earlier decision, and never reads the tool's own annotations.
- **Expiring** — 120 seconds, then it must be re-requested. No silent retry.

`readOnlyHint` and `untrustedContentHint` are set honestly on every tool, but **they are signals to the agent, never enforcement.** The MCP specification warns that clients must treat tool annotations as untrusted; OpenAI's Site tools documentation states that a tool's claim it only reads data is not proof of what it does. Parity annotates truthfully *and* enforces independently.

---

## Adversarial evals

See [`evals/adversarial.md`](./evals/adversarial.md) for recorded runs. Cases exercised:

1. **Direct bypass** — a provider bio contains injected text claiming the agent is pre-authorized
2. **Argument swap** — a grant approved for slot A, reused against slot B
3. **Replay** — a consumed grant re-submitted
4. **Phantom tool** — `confirm_booking` requested while intake is incomplete

Results are recorded as observed, including anything surprising. The gate is designed so the outcome does not depend on the model choosing to behave.

---

## Run locally

```bash
git clone https://github.com/mysticalseeker24/parity-webmcp
cd parity-webmcp
npm install
npm run dev
```

Then either:

- open the dev URL in the **ChatGPT desktop app's built-in browser** (model must be **GPT-5.6 Sol** or **Terra** — Luna has WebMCP disabled), or
- open it in **Chrome 149+** with `chrome://flags/#enable-webmcp-testing` set to Enabled and the browser relaunched.

Without WebMCP, the app still works: the command palette falls back to the internal registry, and the visual UI is unaffected. Progressive enhancement throughout.

**Try it:** `⌘K` / `Ctrl+K` opens the command palette. Complete a full booking with the keyboard only, no mouse and no agent — then ask an agent to do the same thing and watch the audit trail record both.

---

## Stack

Vite · React 19 · TypeScript strict · Zod 4 (`z.toJSONSchema`) · Tailwind · Zustand · `webmcp-types` · Web Speech API · Vitest · deployed on Vercel.

No backend. No database. No auth. No secrets. Fixture data is synthetic and slots are generated deterministically from a seed, so demos are reproducible.

## Deliberate non-choices

- **The Declarative (HTML form) WebMCP API is unused.** It was evaluated and rejected: ChatGPT's built-in browser does not expose declarative tools, and that is the judging surface.
- **No iframes, no cross-origin tool exposure.** ChatGPT's browser does not discover tools registered in iframes, same-origin or not.
- **Booking state resets on reload.** It is a demo; there is nothing to persist and no user data to keep.

## Known limitations

- Voice input uses the Web Speech API and is Chrome-only. Every voice capability has an equivalent keyboard path.
- WebMCP is a **proposed standard** — a W3C Community Group draft in a Chrome origin trial — and its API surface is subject to change.
- Tools belong to the page. Navigating away or closing the tab unregisters them; this is expected WebMCP behaviour.

## License

MIT — see [LICENSE](./LICENSE).
