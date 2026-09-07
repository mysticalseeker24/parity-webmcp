import * as z from "zod";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { startHoldTimer } from "../lib/timers";
import { bookingStore, HOLD_TTL_MS } from "../store";

/**
 * A 10-minute soft hold. Registers only once availability has been fetched at
 * least once, so the agent cannot hold a slot it has never seen.
 *
 * Idempotent by slot_id: holding the slot you already hold returns the existing
 * hold rather than creating a second one (PROJECT_SPEC.md §10, "two rapid
 * identical tool calls"). The expiry timer arrives in Phase 3.
 */
export const holdSlot = defineTool({
  name: "hold_slot",
  humanLabel: "Hold a slot",
  group: "schedule",
  reversible: true,
  description:
    "Place a 10-minute hold on one appointment slot for the selected provider, by slot id from get_availability. Holding a different slot replaces the current hold. Holding the slot you already hold is safe and changes nothing.",
  schema: z.object({
    slot_id: z.string().describe("Slot id from get_availability"),
  }),
  voiceAliases: ["hold it", "reserve that slot"],
  available: (state) =>
    (state.stage === "provider_selected" && state.hasFetchedAvailability) ||
    state.stage === "slot_held" ||
    state.stage === "intake_complete",
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    if (state.stage === "browsing") {
      return {
        reason_code: "no_provider",
        reason: REASONS.no_provider,
        unlock_by: "select_provider",
      };
    }
    return {
      reason_code: "no_availability",
      reason: REASONS.no_availability,
      unlock_by: "get_availability",
    };
  },
  execute: (input, { now }) => {
    const state = bookingStore.getState();
    const slot = findSlot(input.slot_id);
    if (!slot) {
      return refuse(
        "invalid_input",
        `No slot has id "${input.slot_id}". Use an id from get_availability.`,
        { field: "slot_id", next: "get_availability" },
      );
    }
    if (slot.provider_id !== state.selectedProviderId) {
      return refuse(
        "refused",
        `That slot belongs to a different provider. Select that provider first, or pick a slot from get_availability.`,
        { field: "slot_id", next: "get_availability" },
      );
    }
    if (state.takenSlotIds.includes(slot.id)) {
      return refuse("conflict", `That slot has just been taken by someone else.`, {
        field: "slot_id",
        next: "get_availability",
      });
    }

    const existing = state.heldSlot;
    if (existing && existing.slotId === slot.id) {
      return ok(
        {
          slot_id: slot.id,
          date: slot.date,
          time: slot.time,
          already_held: true,
          expires_in_s: Math.max(0, Math.round((existing.expiresAt - now) / 1000)),
          stage: state.stage,
        },
        `${slotLabel(slot)} is already on hold.`,
      );
    }

    const expiresAt = now + HOLD_TTL_MS;
    state.holdSlot({ slotId: slot.id, providerId: slot.provider_id, expiresAt });
    // One timer, owned by lib/timers.ts. Holding a different slot replaces it,
    // so a superseded hold can never expire the current one.
    startHoldTimer(slot.id, expiresAt);

    return ok(
      {
        slot_id: slot.id,
        date: slot.date,
        time: slot.time,
        already_held: false,
        expires_in_s: HOLD_TTL_MS / 1000,
        stage: bookingStore.getState().stage,
      },
      `${slotLabel(slot)}, held for 10 minutes.`,
    );
  },
  announce: (_input, result) =>
    result.ok ? `held ${result.human_summary}` : "could not hold that slot.",
});
