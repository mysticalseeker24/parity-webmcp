import * as z from "zod";
import { findProvider } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import {
  consume,
  GRANT_TTL_MS,
  hostElicitationAvailable,
  mint,
  validate,
} from "../lib/grants";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { clearHoldTimer } from "../lib/timers";
import { bookingStore, intakeMissing, newId } from "../store";

/**
 * The gated commit (PROJECT_SPEC.md §7).
 *
 * Two enforcement mechanisms, both structural:
 *
 *  1. **Registration.** This tool exists only in `intake_complete` with a live
 *     hold. With intake missing it is not registered, so it cannot be called at
 *     all — the phantom-tool case. Not "returns an error": does not exist.
 *  2. **The grant gate.** There is no code path from here to a committed
 *     booking that does not pass a valid, unexpired, argument-matched,
 *     approved, unconsumed grant.
 *
 * Two-phase by construction:
 *   first call  → mints a grant, refuses with `pending_authorization`
 *   second call → validates the grant against *this* call's arguments, commits
 *
 * The description opens with "Consequential:" so the host's own confirmation
 * policy fires as a second layer. Page-side approval is necessary, not
 * sufficient — see `lib/grants.ts` and SPEC_ISSUES.md #288.
 */
export const confirmBooking = defineTool({
  name: "confirm_booking",
  humanLabel: "Confirm booking",
  group: "commit",
  requiresGrant: true,
  description:
    "Consequential: commits a real appointment. Requires the user's own approval on the page, which you cannot give. The first call requests approval and returns pending_authorization; call it again with the same slot_id once the user has approved, and it commits.",
  schema: z.object({
    slot_id: z.string().describe("The held slot's id, exactly as returned by hold_slot"),
  }),
  voiceAliases: ["confirm", "book it"],
  available: (state) => state.stage === "intake_complete" && state.heldSlot !== null,
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    if (state.heldSlot === null) {
      const code = state.holdExpired ? "hold_expired" : "no_hold";
      return { reason_code: code, reason: REASONS[code], unlock_by: "hold_slot" };
    }
    const missing = intakeMissing(state.intake);
    return {
      reason_code: "intake_incomplete",
      reason: `Missing ${missing.join(", ")}.`,
      unlock_by: "set_intake",
    };
  },
  execute: async (input, { now }) => {
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

    // Re-check the world at commit time; never trust the hold or an earlier
    // decision (CONVENTIONS.md §5).
    const slot = findSlot(held.slotId);
    if (!slot || state.takenSlotIds.includes(slot.id)) {
      clearHoldTimer();
      bookingStore.getState().releaseHold();
      return refuse("conflict", "That slot was booked by someone else while it was held.", {
        field: "slot_id",
        next: "get_availability",
      });
    }
    if (intakeMissing(state.intake).length > 0) {
      return refuse("refused", "Patient details are incomplete.", { next: "set_intake" });
    }

    const provider = findProvider(slot.provider_id);
    const args = { slot_id: input.slot_id };

    // ---- Phase 2: is there already an approval for exactly these arguments?
    const check = await validate(confirmBooking.name, args, now);

    if (!check.ok) {
      switch (check.failure) {
        case "grant_mismatch":
          return refuse(
            "grant_mismatch",
            "The approval on file was given for different details, so it cannot be used for this booking. Request approval again.",
            { field: "slot_id", next: "confirm_booking" },
          );
        case "grant_expired":
          return refuse(
            "grant_expired",
            "The approval expired. Approval is valid for two minutes and must be requested again — it is never retried silently.",
            { next: "confirm_booking" },
          );
        case "grant_denied":
          return refuse("refused", "The patient declined this booking.", {
            next: "get_booking_state",
          });
        case "grant_consumed":
          return refuse("refused", "That approval has already been used to book this slot.", {
            next: "get_booking_state",
          });
        default: {
          // ---- Phase 1: mint and ask. This is a refusal, and it *fulfils*
          // (#282) — a pending authorization is a decision, not an error.
          const grant = await mint(confirmBooking.name, args, now);
          const via = hostElicitationAvailable() ? "the browser's approval prompt" : "the page";
          return refuse(
            "pending_authorization",
            `Approval needed to book ${slotLabel(slot)} with ${provider?.name ?? slot.provider_id}. The patient must approve this on ${via}; an agent cannot supply it. Request ${grant.id} expires in ${GRANT_TTL_MS / 1000} seconds.`,
            {
              next: "approve on the page, then call confirm_booking again with the same slot_id",
            },
          );
        }
      }
    }

    // ---- Commit. Only reachable with a validated grant.
    const booking = {
      id: newId("bkg"),
      slotId: slot.id,
      providerId: slot.provider_id,
      confirmedAt: now,
      intake: state.intake,
    };
    clearHoldTimer();
    bookingStore.getState().confirmBooking(booking);
    bookingStore.getState().markSlotTaken(slot.id);
    // Burn it, so a replay of the identical call cannot book twice.
    consume(check.grant.id);

    return ok(
      {
        booking_id: booking.id,
        slot_id: slot.id,
        date: slot.date,
        time: slot.time,
        provider: provider?.name ?? slot.provider_id,
        stage: bookingStore.getState().stage,
      },
      `${slotLabel(slot)} with ${provider?.name ?? slot.provider_id}, reference ${booking.id}.`,
    );
  },
  announce: (_input, result) =>
    result.ok
      ? `confirmed the booking: ${result.human_summary}`
      : "requested the patient's approval to confirm the booking.",
});
