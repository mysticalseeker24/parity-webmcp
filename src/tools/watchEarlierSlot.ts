import * as z from "zod";
import { findSlot, slotLabel, slotsForProvider } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { bookingStore, newId } from "../store";

/**
 * The long-running tool: wait for something earlier than the current hold.
 *
 * Two things make this worth building rather than faking.
 *
 * **Cancellation.** `execute` is handed an `AbortSignal`, and this honours it
 * — the wait ends promptly and reports that it was cancelled rather than
 * resolving as if it had finished. But see `.agent/PHASE1_FINDINGS.md` §6:
 * **Chrome 152 calls `execute` with one argument and supplies no options
 * object**, so in that browser the browser-supplied signal never arrives.
 * `defineTool` synthesises one, and this tool additionally stops on its own
 * terms — the hold going away — so cancellation genuinely works even where the
 * documented mechanism does not.
 *
 * **Progress.** Spec issue #196 asks for a progress channel and there is none,
 * so progress goes where the user can actually see it: each poll appends to the
 * on-page audit trail, and the final result is returned normally. That is the
 * honest workaround, not a claim that #196 is solved.
 */

const POLL_MS = 1000;

export const watchEarlierSlot = defineTool({
  name: "watch_earlier_slot",
  humanLabel: "Watch for an earlier slot",
  group: "schedule",
  readOnly: true,
  description:
    "Wait for a slot earlier than the one currently held with this provider, and report the first one that appears. Runs for up to the number of seconds given, then returns whatever it found. Stops early if the hold is released or the wait is cancelled.",
  schema: z.object({
    within_seconds: z
      .number()
      .int()
      .min(1)
      .max(120)
      .default(20)
      .describe("How long to keep watching, in seconds"),
  }),
  voiceAliases: ["watch for something earlier", "look for an earlier slot"],
  // slot_held only. Once intake is complete the live set is at its cap and
  // confirming is the next step, not shopping for a better time.
  available: (state) => state.stage === "slot_held" && state.heldSlot !== null,
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    const code = state.holdExpired ? "hold_expired" : "no_hold";
    return { reason_code: code, reason: REASONS[code], unlock_by: "hold_slot" };
  },
  execute: async (input, { signal, now }) => {
    const start = bookingStore.getState();
    const held = start.heldSlot;
    const heldSlot = held ? findSlot(held.slotId) : undefined;
    if (!held || !heldSlot) {
      return refuse("unavailable", "No slot is on hold to improve on.", { next: "hold_slot" });
    }

    const heldKey = `${heldSlot.date} ${heldSlot.time}`;
    const deadline = now + input.within_seconds * 1000;
    let polls = 0;

    const note = (text: string) =>
      bookingStore.getState().appendAudit({
        id: newId("audit"),
        at: Date.now(),
        tool: "watch_earlier_slot",
        actor: "system",
        input: { poll: polls },
        result: { ok: true, data: { poll: polls }, human_summary: text },
      });

    note(`Watching for something before ${slotLabel(heldSlot)}.`);

    for (;;) {
      // Cancelled by the caller, or by our own bound.
      if (signal.aborted) {
        note("Stopped watching: cancelled.");
        return refuse("refused", "The watch was cancelled before an earlier slot appeared.", {
          next: "get_booking_state",
        });
      }

      const state = bookingStore.getState();
      // The hold going away is the other way this ends. Without this the watch
      // would outlive the thing it is watching.
      if (state.heldSlot?.slotId !== held.slotId) {
        note("Stopped watching: the hold is gone.");
        return refuse("unavailable", "The hold ended, so there is nothing to improve on.", {
          next: "hold_slot",
        });
      }

      const taken = new Set(state.takenSlotIds);
      const earlier = slotsForProvider(held.providerId)
        .filter((s) => !taken.has(s.id) && `${s.date} ${s.time}` < heldKey)
        .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];

      if (earlier) {
        note(`Found ${slotLabel(earlier)}.`);
        return ok(
          {
            found: true,
            slot_id: earlier.id,
            date: earlier.date,
            time: earlier.time,
            polls,
            currently_held: held.slotId,
          },
          `${slotLabel(earlier)} is earlier than the held slot. Call hold_slot to take it.`,
        );
      }

      if (Date.now() >= deadline) {
        note(`Stopped watching after ${polls} checks; nothing earlier appeared.`);
        return ok(
          { found: false, polls, currently_held: held.slotId },
          `Nothing earlier appeared in ${input.within_seconds} seconds. The hold is unchanged.`,
        );
      }

      polls += 1;
      // Abortable sleep: an unabortable one would leave the tool "cancelled"
      // in name only, still ticking until its timer ran out.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, POLL_MS);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });
    }
  },
  announce: (_input, result) =>
    result.ok ? `finished watching. ${result.human_summary}` : "stopped watching for an earlier slot.",
});
