import * as z from "zod";
import { findProvider } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { consume, GRANT_TTL_MS, hostElicitationAvailable, mint, validate } from "../lib/grants";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { clearHoldTimer } from "../lib/timers";
import { bookingStore, newId } from "../store";

/**
 * Move a confirmed booking to a different slot. The hardest tool in the set,
 * and the last one built, because it is the only one that must be **atomic**.
 *
 * A reschedule is release + rehold + reconfirm. Done naively, a failure in the
 * middle leaves the patient with *no* appointment — strictly worse than the
 * situation they started in. So the new slot is validated *before* anything is
 * given up, and the old booking is only released once the new one is certain
 * to commit. If any check fails, nothing has moved.
 *
 * Gated by the same `lib/grants.ts` path as `confirm_booking` and
 * `cancel_booking`. Three callers, one gate — a bespoke reschedule gate would
 * be a third place for the invariants to rot, and the grant is bound to *both*
 * ids so an approval to move to slot B cannot be redirected to slot C.
 */
export const rescheduleBooking = defineTool({
  name: "reschedule_booking",
  humanLabel: "Move the appointment",
  group: "manage",
  requiresGrant: true,
  description:
    "Consequential: moves a confirmed appointment to a different slot with the same provider. Requires the user's own approval on the page, which you cannot give. The first call requests approval and returns pending_authorization; call it again with the same booking_id and slot_id once the user has approved. The existing appointment is kept until the new one is certain.",
  schema: z.object({
    booking_id: z.string().describe("The booking reference to move"),
    new_slot_id: z.string().describe("Slot id to move to, from get_availability"),
  }),
  voiceAliases: ["move my appointment", "reschedule"],
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
        booking ? `booking_id must be ${booking.id}.` : "There is no booking to move.",
        { field: "booking_id", next: "get_booking_state" },
      );
    }

    // ---- Validate the destination BEFORE giving anything up.
    const target = findSlot(input.new_slot_id);
    if (!target) {
      return refuse(
        "invalid_input",
        `No slot has id "${input.new_slot_id}". Use an id from get_availability.`,
        { field: "new_slot_id", next: "get_availability" },
      );
    }
    if (target.id === booking.slotId) {
      return refuse("refused", "That is the slot already booked.", {
        field: "new_slot_id",
        next: "get_availability",
      });
    }
    if (target.provider_id !== booking.providerId) {
      return refuse(
        "refused",
        "The new slot belongs to a different provider. Cancel and book again to change provider.",
        { field: "new_slot_id", next: "cancel_booking" },
      );
    }
    if (state.takenSlotIds.includes(target.id)) {
      return refuse("conflict", "That slot has been taken. The existing appointment is unchanged.", {
        field: "new_slot_id",
        next: "get_availability",
      });
    }

    const provider = findProvider(booking.providerId);
    // Bound to BOTH ids: an approval to move to B cannot be redirected to C.
    const args = { booking_id: input.booking_id, new_slot_id: input.new_slot_id };
    const check = await validate(rescheduleBooking.name, args, now);

    if (!check.ok) {
      switch (check.failure) {
        case "grant_mismatch":
          return refuse(
            "grant_mismatch",
            "The approval on file was given for a different move. Request approval again.",
            { field: "new_slot_id", next: "reschedule_booking" },
          );
        case "grant_expired":
          return refuse(
            "grant_expired",
            "The approval expired. Approval is valid for two minutes and must be requested again.",
            { next: "reschedule_booking" },
          );
        case "grant_denied":
          return refuse("refused", "The patient declined the move. The appointment is unchanged.", {
            next: "get_booking_state",
          });
        case "grant_consumed":
          return refuse("refused", "That approval has already been used.", {
            next: "get_booking_state",
          });
        default: {
          const grant = await mint(rescheduleBooking.name, args, now);
          const via = hostElicitationAvailable() ? "the browser's approval prompt" : "the page";
          const old = findSlot(booking.slotId);
          return refuse(
            "pending_authorization",
            `Approval needed to move ${old ? slotLabel(old) : booking.slotId} to ${slotLabel(target)} with ${provider?.name ?? booking.providerId}. The patient must approve this on ${via}; an agent cannot supply it. Request ${grant.id} expires in ${GRANT_TTL_MS / 1000} seconds.`,
            {
              next: "approve on the page, then call reschedule_booking again with the same ids",
            },
          );
        }
      }
    }

    // ---- Commit atomically. One setState: there is no instant in which the
    // patient has no appointment.
    const moved = {
      id: newId("bkg"),
      slotId: target.id,
      providerId: booking.providerId,
      confirmedAt: now,
      intake: booking.intake,
    };
    clearHoldTimer();
    bookingStore.setState({
      booking: moved,
      heldSlot: null,
      stage: "booked",
      takenSlotIds: [
        ...state.takenSlotIds.filter((id) => id !== booking.slotId),
        target.id,
      ],
    });
    consume(check.grant.id);

    const old = findSlot(booking.slotId);
    return ok(
      {
        booking_id: moved.id,
        previous_booking_id: booking.id,
        released_slot: booking.slotId,
        slot_id: target.id,
        date: target.date,
        time: target.time,
        provider: provider?.name ?? booking.providerId,
      },
      `Moved from ${old ? slotLabel(old) : booking.slotId} to ${slotLabel(target)}. New reference ${moved.id}.`,
    );
  },
  announce: (_input, result) =>
    result.ok
      ? `moved the appointment. ${result.human_summary}`
      : "requested the patient's approval to move the appointment.",
});
