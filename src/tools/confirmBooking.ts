import * as z from "zod";
import { findProvider } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { checkGrant, consumeGrant, GRANT_TTL_MS, hashArgs, requestGrant } from "../lib/grants";
import { bookingStore, newId } from "../store";

/**
 * The gated commit (PROJECT_SPEC.md §7). Registers only in intake_complete, so
 * with intake missing it does not exist. When it does, the only path to a
 * committed booking runs through a grant that is approved, unexpired, and
 * bound to the hash of *this call's* arguments — re-validated here, at commit,
 * never trusted from earlier. There is no tool that approves a grant.
 */
export const confirmBooking = defineTool({
  name: "confirm_booking",
  humanLabel: "Confirm booking",
  description:
    "Commit the held slot as a booking. The first call requests the patient's authorization on the page and returns pending_authorization. Call it again with the same slot_id after the patient approves; only then does the booking commit.",
  schema: z.object({
    slot_id: z.string().describe("The held slot's id, exactly as returned by hold_slot."),
  }),
  annotations: { readOnlyHint: false },
  reversible: false,
  gated: true,
  available: (state) => state.stage === "intake_complete" && state.hold !== null,
  voiceAliases: ["confirm", "book it"],
  execute: async (input, { now }) => {
    const state = bookingStore.getState();
    const hold = state.hold;
    if (!hold || hold.slot_id !== input.slot_id) {
      return {
        error: hold
          ? `slot_id must match the held slot ${hold.slot_id}; received "${input.slot_id}"`
          : "no slot is held; call hold_slot first",
        field: "slot_id",
      };
    }

    // Re-check the slot at commit time, never from the hold (CONVENTIONS.md §5).
    const slot = findSlot(hold.slot_id);
    if (!slot || state.takenSlotIds.includes(slot.id)) {
      state.releaseHold("conflict");
      return {
        error: `slot_conflict: ${hold.slot_id} was booked by someone else. Call get_availability and hold another slot.`,
        field: "slot_id",
      };
    }

    const argsHash = await hashArgs(input);
    const check = checkGrant("confirm_booking", argsHash, now);

    switch (check.status) {
      case "none": {
        const grant = requestGrant("confirm_booking", argsHash, now);
        return {
          status: "pending_authorization" as const,
          grant_id: grant.id,
          expires_in_s: GRANT_TTL_MS / 1000,
          starts: slotLabel(slot),
          message: "The patient must approve this booking on the page. Call confirm_booking again with the same slot_id once they have.",
        };
      }
      case "pending":
        return {
          status: "pending_authorization" as const,
          grant_id: check.grant.id,
          expires_in_s: Math.max(0, Math.round((check.grant.expires_at - now) / 1000)),
          starts: slotLabel(slot),
          message: "Still waiting for the patient to approve on the page.",
        };
      case "expired":
        return {
          status: "grant_expired" as const,
          starts: slotLabel(slot),
          message: "The authorization expired. Call confirm_booking again to request a new one.",
        };
      case "denied":
        return { status: "grant_denied" as const, starts: slotLabel(slot), message: "The patient declined." };
      case "consumed":
        return { error: "this authorization was already used; the booking is complete or must be re-requested" };
      case "approved": {
        consumeGrant(check.grant.id);
        const provider = findProvider(slot.provider_id);
        const booking = {
          id: newId("bk"),
          slot_id: slot.id,
          provider_id: slot.provider_id,
          confirmed_at: now,
          intake: state.intake,
        };
        state.confirmBooking(booking);
        return {
          status: "booked" as const,
          booking_id: booking.id,
          provider_name: provider?.name ?? slot.provider_id,
          starts: slotLabel(slot),
          duration_min: slot.duration_min,
          slot_id: slot.id,
        };
      }
    }
  },
  assertive: (result) => result.status !== "booked",
  announce: (_input, result) => {
    switch (result.status) {
      case "pending_authorization":
        return `requested authorization to confirm the booking for ${result.starts}. You must approve this on the page.`;
      case "grant_expired":
        return "found the authorization had expired. Request it again to continue.";
      case "grant_denied":
        return "found the authorization was denied. The booking was not made.";
      case "booked":
        return `confirmed the booking with ${result.provider_name} on ${result.starts}.`;
    }
  },
});
