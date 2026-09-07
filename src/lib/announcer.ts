import { bookingStore, type AuditEntry, type BookingStore } from "../store";
import { getRegistry } from "./registry";
import { REASONS, toolLostSentence, type ReasonCode } from "./reasons";
import { stageSentence } from "./stageFocus";
import { isToolResult } from "./result";
import type { StoreApi } from "zustand/vanilla";

/**
 * Turns store changes into spoken sentences.
 *
 * This is the project's second contribution. When an agent fills a form today,
 * a screen-reader user is told nothing: the DOM mutates silently. A sighted
 * user watches it happen; a blind user has no idea their intake form was just
 * completed by something other than themselves. So **every** execution
 * announces, agent-initiated ones included, with the actor named.
 *
 * Two sources, both from the store so nothing has to be wired at a call site:
 *
 *  - `audit` — one line per execution, built from the tool's own
 *    `spec.announce(input, result)`. Never hand-written here, or the wording
 *    would drift from the tool (CONVENTIONS.md §6).
 *  - `lastToolChange` — one line per tool that left the live set, using the
 *    reason sentence from `reasons.ts`. Spec issue #262: the agent recovers
 *    that context from `unavailable[]`; this is the same context, spoken.
 */

export type Politeness = "polite" | "assertive";

export interface Announcement {
  readonly text: string;
  readonly politeness: Politeness;
}

/**
 * Every refusal interrupts; successes wait their turn.
 *
 * The tempting alternative — treating a no-results search as merely
 * informational — gets it wrong. A refusal is always something the caller must
 * respond to: relax a constraint, fix a field, approve on the page. Making a
 * sighted user's red error box a polite announcement for everyone else would
 * reintroduce exactly the asymmetry this project exists to remove.
 */
function politenessFor(result: { ok: boolean }): Politeness {
  return result.ok ? "polite" : "assertive";
}

function actorPrefix(actor: AuditEntry["actor"]): string {
  if (actor === "human") return "You";
  if (actor === "agent") return "Agent";
  return "System";
}

/** The sentence for one audit entry. Exported so tests can assert it directly. */
export function announcementFor(entry: AuditEntry): Announcement | null {
  // A system entry is a transition nobody asked for — the hold expiring.
  if (entry.actor === "system") {
    const code = (entry.result as { reason_code?: string }).reason_code;
    if (code && code in REASONS) {
      return { text: REASONS[code as ReasonCode], politeness: "assertive" };
    }
    return null;
  }

  const tool = getRegistry()?.getTool(entry.tool);
  if (!tool || !isToolResult(entry.result)) return null;

  let phrase: string;
  try {
    phrase = tool.spec.announce(entry.input, entry.result);
  } catch {
    // A broken announce must not take the live region down with it.
    return null;
  }

  return {
    text: `${actorPrefix(entry.actor)} ${phrase}`,
    politeness: politenessFor(entry.result),
  };
}

export interface AnnouncerState {
  readonly polite: string;
  readonly assertive: string;
}

/**
 * Subscribe to the store and push sentences to `onAnnounce`. Returns an
 * unsubscribe. Called once by the LiveRegion host; never from a tool.
 */
export function startAnnouncer(
  onAnnounce: (a: Announcement) => void,
  store: StoreApi<BookingStore> = bookingStore,
): () => void {
  let lastAuditId = store.getState().audit.at(-1)?.id ?? null;
  let lastChangeAt = store.getState().lastToolChange?.at ?? null;
  let lastStage = store.getState().stage;

  return store.subscribe((state) => {
    // Focus moves to the new stage's primary control; say where it went, or a
    // screen-reader user hears a control read out with no idea why.
    if (state.stage !== lastStage) {
      lastStage = state.stage;
      onAnnounce({ text: stageSentence(state.stage), politeness: "polite" });
    }

    const latest = state.audit.at(-1);
    if (latest && latest.id !== lastAuditId) {
      lastAuditId = latest.id;
      const announcement = announcementFor(latest);
      if (announcement) onAnnounce(announcement);
    }

    const change = state.lastToolChange;
    if (change && change.at !== lastChangeAt) {
      lastChangeAt = change.at;
      for (const removed of change.removed) {
        // "always_live" can never actually be removed; skip defensively.
        if (!(removed.reason_code in REASONS)) continue;
        if (removed.reason_code === "always_live") continue;
        const label = getRegistry()?.getTool(removed.tool)?.spec.humanLabel ?? removed.tool;
        onAnnounce({
          text: toolLostSentence(label, removed.reason_code as ReasonCode),
          politeness: "polite",
        });
      }
    }
  });
}
