import * as z from "zod";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok } from "../lib/result";
import { clearHoldTimer } from "../lib/timers";
import { bookingStore } from "../store";

/**
 * The explicit inverse of `hold_slot`. Registers only while a hold exists, so
 * there is never a "release" offered with nothing to release.
 *
 * Distinct from the undo stack on purpose: undo is a human affordance that
 * reverses whatever happened last, while this is an action an *agent* can take
 * deliberately — "that slot doesn't work, free it up and look again".
 */
export const releaseSlot = defineTool({
  name: "release_slot",
  humanLabel: "Release the held slot",
  group: "schedule",
  reversible: true,
  description:
    "Give up the current hold so a different slot or provider can be chosen. The appointment is not booked and nothing is cancelled — this only frees a hold that has not been confirmed.",
  schema: z.object({}),
  voiceAliases: ["let it go", "release the slot", "cancel the hold"],
  available: (state) => state.heldSlot !== null && state.stage !== "booked",
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    const code = state.holdExpired ? "hold_expired" : "no_hold";
    return { reason_code: code, reason: REASONS[code], unlock_by: "hold_slot" };
  },
  execute: () => {
    const state = bookingStore.getState();
    const held = state.heldSlot;
    const slot = held ? findSlot(held.slotId) : undefined;

    // The hold is going, so its expiry timer goes with it.
    clearHoldTimer();
    state.releaseHold();

    const after = bookingStore.getState();
    return ok(
      {
        released: held?.slotId ?? null,
        stage: after.stage,
        provider_id: after.selectedProviderId,
      },
      slot ? `Released ${slotLabel(slot)}.` : "Released the hold.",
    );
  },
  announce: (_input, result) =>
    result.ok ? `released the hold. ${result.human_summary}` : "could not release the hold.",
});
