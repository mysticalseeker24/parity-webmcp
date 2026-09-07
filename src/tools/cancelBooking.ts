import * as z from "zod";
import { findProvider } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { consume, GRANT_TTL_MS, hostElicitationAvailable, mint, validate } from "../lib/grants";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { bookingStore } from "../store";

/**
 * The second gated tool, and it takes **exactly the same path** as
 * `confirm_booking` — mint, refuse with `pending_authorization`, validate on the
 * second call, commit, consume. One gate implementation, two callers of it; a
 * separate "cancel gate" would be a second place for the invariants to rot.
 *
 * Cancelling is why `confirm_booking` is not undoable. Reversing a real
 * appointment is its own approved action, not a shortcut around the approval
 * that created it (see `lib/undo.ts`).
 */
export const cancelBooking = defineTool({
  name: "cancel_booking",
  humanLabel: "Cancel the booking",
  group: "manage",
  requiresGrant: true,
  description:
    "Consequential: cancels a confirmed appointment. Requires the user's own approval on the page, which you cannot give. The first call requests that approval and returns pending_authorization; call it again with the same booking_id once the user has approved.",
  schema: z.object({
    booking_id: z.string().describe("The booking reference, exactly as confirm_booking returned it"),
  }),
  voiceAliases: ["cancel my appointment", "call off the booking"],
  available: (state) => state.stage === "booked" && state.booking !== null,
  unavailableReason: () => ({
    reason_code: "no_booking",
    reason: REASONS.no_booking,
    unlock_by: "confirm_booking",
  }),
  execute: async (input, { now }) => {
    const state = bookingStore.getState();
    const booking = state.booking;

    if (!booking || booking.id !== input.booking_id) {
      return refuse(
        "invalid_input",
        booking
          ? `booking_id must be ${booking.id}.`
          : "There is no booking to cancel.",
        { field: "booking_id", next: "get_booking_state" },
      );
    }

    const slot = findSlot(booking.slotId);
    const provider = findProvider(booking.providerId);
    const args = { booking_id: input.booking_id };

    const check = await validate(cancelBooking.name, args, now);

    if (!check.ok) {
      switch (check.failure) {
        case "grant_mismatch":
          return refuse(
            "grant_mismatch",
            "The approval on file was given for a different booking. Request approval again.",
            { field: "booking_id", next: "cancel_booking" },
          );
        case "grant_expired":
          return refuse(
            "grant_expired",
            "The approval expired. Approval is valid for two minutes and must be requested again.",
            { next: "cancel_booking" },
          );
        case "grant_denied":
          return refuse("refused", "The patient declined to cancel.", {
            next: "get_booking_state",
          });
        case "grant_consumed":
          return refuse("refused", "That approval has already been used.", {
            next: "get_booking_state",
          });
        default: {
          const grant = await mint(cancelBooking.name, args, now);
          const via = hostElicitationAvailable() ? "the browser's approval prompt" : "the page";
          return refuse(
            "pending_authorization",
            `Approval needed to cancel ${slot ? slotLabel(slot) : booking.slotId} with ${provider?.name ?? booking.providerId}. The patient must approve this on ${via}; an agent cannot supply it. Request ${grant.id} expires in ${GRANT_TTL_MS / 1000} seconds.`,
            { next: "approve on the page, then call cancel_booking again with the same booking_id" },
          );
        }
      }
    }

    // Free the slot again and return to browsing. reset() would also clear the
    // audit trail, which must survive — it is the record of what happened.
    bookingStore.setState({
      booking: null,
      stage: "browsing",
      selectedProviderId: null,
      hasFetchedAvailability: false,
      heldSlot: null,
      holdExpired: false,
      takenSlotIds: state.takenSlotIds.filter((id) => id !== booking.slotId),
    });
    consume(check.grant.id);

    return ok(
      {
        cancelled: booking.id,
        slot_id: booking.slotId,
        stage: bookingStore.getState().stage,
      },
      `Cancelled ${slot ? slotLabel(slot) : booking.slotId} with ${provider?.name ?? booking.providerId}.`,
    );
  },
  announce: (_input, result) =>
    result.ok
      ? `cancelled the booking. ${result.human_summary}`
      : "requested the patient's approval to cancel the booking.",
});
