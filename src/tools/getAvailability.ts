import * as z from "zod";
import { isRealDate, SCHEDULE_END, SCHEDULE_START, slotsForProvider } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { bookingStore } from "../store";
import { selectedProvider } from "./shared";

const MAX_SLOTS = 10;

/**
 * Open slots for the selected provider. Registers only once a provider is
 * selected, and stays live through the held stages so a conflict at confirm
 * time has a tool to fall back to (PROJECT_SPEC.md §10).
 */
export const getAvailability = defineTool({
  name: "get_availability",
  humanLabel: "Show available slots",
  description:
    `Show open appointment slots for the selected provider, optionally narrowed by date range, time of day and appointment length. The booking window runs ${SCHEDULE_START} to ${SCHEDULE_END}. Returns slot ids to pass to hold_slot.`,
  schema: z.object({
    date_from: z
      .string()
      .optional()
      .describe("Earliest date to include, YYYY-MM-DD. Defaults to the start of the window."),
    date_to: z
      .string()
      .optional()
      .describe("Latest date to include, YYYY-MM-DD. Defaults to the end of the window."),
    time_of_day: z
      .enum(["morning", "afternoon", "any"])
      .default("any")
      .describe("morning is before 12:00, afternoon is 12:00 onwards."),
    duration_min: z
      .literal([30, 60])
      .default(30)
      .describe("Minimum appointment length in minutes. 60 requires a provider offering extended appointments."),
  }),
  annotations: { readOnlyHint: true },
  reversible: false,
  available: (state) =>
    state.stage === "provider_selected" || state.stage === "slot_held" || state.stage === "intake_complete",
  voiceAliases: ["show me times", "when is the doctor free"],
  execute: (input) => {
    const state = bookingStore.getState();
    const provider = selectedProvider(state);
    if (!provider) {
      return { error: "no provider is selected; call select_provider first" };
    }

    for (const [field, value] of [["date_from", input.date_from], ["date_to", input.date_to]] as const) {
      if (value !== undefined && !isRealDate(value)) {
        return { error: `${field} must be a real date in YYYY-MM-DD form; received "${value}"`, field };
      }
    }
    const from = input.date_from ?? SCHEDULE_START;
    const to = input.date_to ?? SCHEDULE_END;
    // Window check first: a date outside the window is the more useful error
    // than "after date_to" when date_to was defaulted.
    if (from > SCHEDULE_END || to < SCHEDULE_START) {
      return {
        error: `no slots outside the booking window ${SCHEDULE_START} to ${SCHEDULE_END}`,
        field: from > SCHEDULE_END ? "date_from" : "date_to",
      };
    }
    if (from > to) {
      return { error: `date_from (${from}) is after date_to (${to})`, field: "date_from" };
    }

    const taken = new Set(state.takenSlotIds);
    const matches = slotsForProvider(provider.id).filter((slot) => {
      if (taken.has(slot.id)) return false;
      if (slot.date < from || slot.date > to) return false;
      if (slot.duration_min < input.duration_min) return false;
      const hour = Number(slot.time.slice(0, 2));
      if (input.time_of_day === "morning" && hour >= 12) return false;
      if (input.time_of_day === "afternoon" && hour < 12) return false;
      return true;
    });

    state.markAvailabilityFetched();
    const shown = matches.slice(0, MAX_SLOTS);

    return {
      provider_id: provider.id,
      provider_name: provider.name,
      window: { from, to },
      showing: shown.length,
      total: matches.length,
      slots: shown.map((s) => ({
        id: s.id,
        date: s.date,
        time: s.time,
        duration_min: s.duration_min,
        ...(state.hold?.slot_id === s.id ? { held_by_you: true } : {}),
      })),
      ...(matches.length > MAX_SLOTS
        ? { note: `Showing ${MAX_SLOTS} of ${matches.length}; narrow the date range to see others.` }
        : {}),
      next_step:
        shown.length > 0
          ? "Call hold_slot with the id of the slot the patient wants."
          : "Widen the date range or change time_of_day, then call get_availability again.",
    };
  },
  announce: (_input, result) =>
    result.total === 0
      ? `found no open slots for ${result.provider_name} in that range.`
      : `found ${result.total} open slot${result.total === 1 ? "" : "s"} for ${result.provider_name} between ${result.window.from} and ${result.window.to}.`,
});
