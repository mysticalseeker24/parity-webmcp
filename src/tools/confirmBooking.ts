import * as z from "zod";
import { findProvider } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { refuse } from "../lib/result";
import { bookingStore, intakeMissing } from "../store";

/**
 * The gated commit (PROJECT_SPEC.md §7). Registers only in `intake_complete`
 * with a live hold, so with intake missing the tool does not exist at all —
 * the agent cannot call what is not registered.
 *
 * Phase 2 builds the registration and the pre-flight checks only. The grant
 * gate itself lands in Phase 6; until then this tool has **no path to a
 * committed booking**, which is the structural property §7 demands. It refuses
 * with `pending_authorization` (#282: a refusal fulfils, it does not throw).
 *
 * The description states the action is consequential so the host's own
 * confirmation policy fires as a second layer — page-side approval is
 * necessary, not sufficient (SPEC_ISSUES.md #288).
 */
export const confirmBooking = defineTool({
  name: "confirm_booking",
  humanLabel: "Confirm booking",
  group: "commit",
  requiresGrant: true,
  description:
    "Consequential: commits the held slot as a real appointment. Requires the patient's own approval on the page, which you cannot give. Calling this requests that approval and returns pending_authorization; the booking commits only after the patient approves.",
  schema: z.object({
    slot_id: z.string().describe("The held slot's id, exactly as returned by hold_slot"),
  }),
  voiceAliases: ["confirm", "book it"],
  available: (state) => state.stage === "intake_complete" && state.heldSlot !== null,
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return {
        reason_code: "already_booked",
        reason: "The appointment is already booked.",
        unlock_by: "",
      };
    }
    if (state.heldSlot === null) {
      return { reason_code: "no_hold", reason: "No slot is on hold.", unlock_by: "hold_slot" };
    }
    const missing = intakeMissing(state.intake);
    return {
      reason_code: "intake_incomplete",
      reason: `Intake is missing ${missing.join(", ")}.`,
      unlock_by: "set_intake",
    };
  },
  execute: (input) => {
    const state = bookingStore.getState();
    const held = state.heldSlot;
    if (!held || held.slotId !== input.slot_id) {
      return refuse(
        "invalid_input",
        held
          ? `slot_id must be the held slot ${held.slotId}.`
          : "No slot is on hold; hold one first.",
        { field: "slot_id", next: "hold_slot" },
      );
    }

    // Re-check the slot at commit time; never trust the hold (CONVENTIONS.md §5).
    const slot = findSlot(held.slotId);
    if (!slot || state.takenSlotIds.includes(slot.id)) {
      bookingStore.getState().releaseHold();
      return refuse("conflict", "That slot was booked by someone else while it was held.", {
        field: "slot_id",
        next: "get_availability",
      });
    }

    const provider = findProvider(slot.provider_id);
    // Phase 6 replaces this with the grant gate. Until it exists there is no
    // code path from here to a committed booking, which is the point.
    return refuse(
      "pending_authorization",
      `The patient must approve booking ${slotLabel(slot)} with ${provider?.name ?? slot.provider_id} on the page. Approval is not something an agent can supply.`,
      { next: "get_booking_state" },
    );
  },
  announce: (_input, result) =>
    result.ok
      ? `confirmed the booking. ${result.human_summary}`
      : "requested the patient's approval to confirm the booking.",
});
