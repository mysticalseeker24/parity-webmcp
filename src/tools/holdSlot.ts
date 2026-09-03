import * as z from "zod";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { bookingStore, HOLD_TTL_MS } from "../store";
import { nextStep } from "./shared";

/**
 * A 10-minute soft hold. Idempotent by slot_id: a second identical call returns
 * the existing hold and never double-holds (PROJECT_SPEC.md §10). Registers only
 * once availability has been fetched at least once, so the agent cannot hold a
 * slot it has not seen.
 */
export const holdSlot = defineTool({
  name: "hold_slot",
  humanLabel: "Hold a slot",
  description:
    "Place a 10-minute hold on one appointment slot for the selected provider, by slot id from get_availability. Holding a different slot replaces the current hold. The hold expires on its own; confirm_booking commits it.",
  schema: z.object({
    slot_id: z.string().describe('Slot id from get_availability, e.g. "s_p03_2026-10-14_1030".'),
  }),
  annotations: { readOnlyHint: false },
  reversible: true,
  available: (state) =>
    (state.stage === "provider_selected" && state.hasFetchedAvailability) ||
    state.stage === "slot_held" ||
    state.stage === "intake_complete",
  voiceAliases: ["hold it", "reserve that slot"],
  execute: (input, { now }) => {
    const state = bookingStore.getState();
    const slot = findSlot(input.slot_id);
    if (!slot) {
      return { error: `slot_id "${input.slot_id}" does not exist; use an id from get_availability`, field: "slot_id" };
    }
    if (slot.provider_id !== state.selectedProviderId) {
      return {
        error: `slot ${slot.id} belongs to provider ${slot.provider_id}, not the selected provider ${state.selectedProviderId ?? "(none)"}`,
        field: "slot_id",
      };
    }
    if (state.takenSlotIds.includes(slot.id)) {
      return { error: `slot ${slot.id} is no longer available; call get_availability for current slots`, field: "slot_id" };
    }

    const existing = state.hold;
    if (existing && existing.slot_id === slot.id) {
      return {
        held: true,
        already_held: true,
        slot_id: slot.id,
        starts: slotLabel(slot),
        duration_min: slot.duration_min,
        expires_in_s: Math.max(0, Math.round((existing.expires_at - now) / 1000)),
        stage: state.stage,
        next_step: nextStep(state),
      };
    }

    state.holdSlot({ slot_id: slot.id, provider_id: slot.provider_id, expires_at: now + HOLD_TTL_MS });
    const after = bookingStore.getState();
    return {
      held: true,
      already_held: false,
      slot_id: slot.id,
      starts: slotLabel(slot),
      duration_min: slot.duration_min,
      expires_in_s: HOLD_TTL_MS / 1000,
      stage: after.stage,
      next_step: nextStep(after),
    };
  },
  announce: (_input, result) =>
    result.already_held
      ? `confirmed the existing hold on ${result.starts}.`
      : `held ${result.starts}, ${result.duration_min} minutes. Hold expires in ten minutes.`,
});
