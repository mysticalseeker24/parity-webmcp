import * as z from "zod";
import { isRealDate, SCHEDULE_END, SCHEDULE_START, slotsForProvider } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { ok, refuse } from "../lib/result";
import { bookingStore } from "../store";
import { selectedProvider } from "./shared";

const MAX_SLOTS = 8;

/**
 * Open slots for the selected provider. Registers only once a provider is
 * selected, and stays live through the held stages so a conflict at confirm
 * time has somewhere to go back to (PROJECT_SPEC.md §10).
 */
export const getAvailability = defineTool({
  name: "get_availability",
  humanLabel: "Show available slots",
  group: "schedule",
  readOnly: true,
  description:
    `Show open appointment slots for the selected provider, optionally narrowed by date range, time of day and appointment length. The booking window runs ${SCHEDULE_START} to ${SCHEDULE_END}. Returns slot ids to pass to hold_slot.`,
  schema: z.object({
    date_from: z.string().optional().describe("Earliest date to include (YYYY-MM-DD)"),
    date_to: z.string().optional().describe("Latest date to include (YYYY-MM-DD)"),
    time_of_day: z
      .enum(["morning", "afternoon", "any"])
      .default("any")
      .describe("Time of day: morning is before 12:00"),
    duration_min: z
      .literal([30, 60])
      .default(30)
      .describe("Minimum appointment length in minutes"),
  }),
  voiceAliases: ["show me times", "when is the doctor free"],
  available: (state) =>
    state.stage === "provider_selected" ||
    state.stage === "slot_held" ||
    state.stage === "intake_complete",
  unavailableReason: (state) => ({
    reason_code: state.stage === "booked" ? "already_booked" : "no_provider",
    reason:
      state.stage === "booked"
        ? "The appointment is already booked."
        : "No provider is selected yet.",
    unlock_by: state.stage === "booked" ? "" : "select_provider",
  }),
  execute: (input) => {
    const state = bookingStore.getState();
    const provider = selectedProvider(state);
    if (!provider) {
      return refuse("unavailable", "No provider is selected.", { next: "select_provider" });
    }

    for (const [field, value] of [
      ["date_from", input.date_from],
      ["date_to", input.date_to],
    ] as const) {
      if (value !== undefined && !isRealDate(value)) {
        return refuse(
          "invalid_input",
          `${field} must be a real date as YYYY-MM-DD. Valid: "2026-10-14".`,
          { field },
        );
      }
    }

    const from = input.date_from ?? SCHEDULE_START;
    const to = input.date_to ?? SCHEDULE_END;
    // Window check first: "outside the booking window" is more useful than
    // "after date_to" when date_to was defaulted.
    if (from > SCHEDULE_END || to < SCHEDULE_START) {
      return refuse(
        "invalid_input",
        `The booking window is ${SCHEDULE_START} to ${SCHEDULE_END}.`,
        { field: from > SCHEDULE_END ? "date_from" : "date_to" },
      );
    }
    if (from > to) {
      return refuse("invalid_input", `date_from (${from}) is after date_to (${to}).`, {
        field: "date_from",
      });
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

    if (matches.length === 0) {
      return refuse(
        "unavailable",
        `${provider.name} has no open slots in that range. Widen the dates or change time_of_day.`,
        { next: "get_availability" },
      );
    }

    const shown = matches.slice(0, MAX_SLOTS);
    return ok(
      {
        provider_id: provider.id,
        showing: shown.length,
        total: matches.length,
        slots: shown.map((s) => ({
          id: s.id,
          date: s.date,
          time: s.time,
          min: s.duration_min,
        })),
        ...(matches.length > MAX_SLOTS
          ? { note: `showing ${shown.length} of ${matches.length}; narrow the date range` }
          : {}),
      },
      `${matches.length} open slot${matches.length === 1 ? "" : "s"} for ${provider.name}.`,
    );
  },
  announce: (_input, result) =>
    result.ok ? `found ${result.human_summary}` : "found no open slots in that range.",
});
