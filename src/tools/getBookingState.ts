import * as z from "zod";
import { defineTool } from "../lib/defineTool";
import { bookingStore, intakeMissing } from "../store";
import { heldSlotLabel, nextStep, selectedProvider } from "./shared";

/**
 * The agent's orientation tool. Always live. Tells the agent where the booking
 * is, what is still missing, and which tools exist right now — so it never has
 * to guess at a tool that was unregistered behind its back.
 */
export const getBookingState = defineTool({
  name: "get_booking_state",
  humanLabel: "Check booking status",
  description:
    "Report the current booking: stage, selected provider, held slot, intake completeness, and which tools are available right now. Call this first, and again whenever a tool you expected is missing.",
  schema: z.object({}),
  annotations: { readOnlyHint: true },
  reversible: false,
  available: () => true,
  voiceAliases: ["where am I", "booking status"],
  execute: (_input, { now }) => {
    const state = bookingStore.getState();
    const provider = selectedProvider(state);
    const missing = intakeMissing(state.intake);

    return {
      stage: state.stage,
      selected_provider: provider
        ? { id: provider.id, name: provider.name, specialty: provider.specialty }
        : null,
      hold: state.hold
        ? {
            slot_id: state.hold.slot_id,
            starts: heldSlotLabel(state),
            expires_in_s: Math.max(0, Math.round((state.hold.expires_at - now) / 1000)),
          }
        : null,
      intake: { complete: missing.length === 0, missing, provided: Object.keys(state.intake) },
      booking: state.booking ? { id: state.booking.id, slot_id: state.booking.slot_id } : null,
      live_tools: state.liveTools,
      next_step: nextStep(state),
    };
  },
  announce: (_input, result) => `checked booking status: ${result.stage.replace("_", " ")}.`,
});
