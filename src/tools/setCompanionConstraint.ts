import * as z from "zod";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { bookingStore } from "../store";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A caregiver's availability window, which the search then has to satisfy
 * alongside everything else. This is what makes the problem genuinely
 * multi-dimensional rather than a filtered list: the appointment has to work
 * for two people's calendars, not one.
 *
 * Times are accepted as the user says them — `"14:00"` — rather than asking the
 * agent to compute anything (CONVENTIONS.md §4).
 */
export const setCompanionConstraint = defineTool({
  name: "set_companion_constraint",
  humanLabel: "Set companion availability",
  // "search", not "intake": it is a constraint on what you are looking for, and
  // it is offered while you are still choosing — the palette groups in workflow
  // order, so it has to sit where it is actually used.
  group: "search",
  reversible: true,
  description:
    "Record when a companion or caregiver can attend, so only appointment times inside their window are offered. Times are 24-hour, for example 09:00 to 14:30.",
  schema: z.object({
    name: z.string().optional().describe("Companion's name, if you want it on the booking"),
    available_from: z.string().describe("Earliest time the companion can attend (HH:MM)"),
    available_to: z.string().describe("Latest time the companion can attend (HH:MM)"),
  }),
  voiceAliases: ["my carer can come", "companion times"],
  // Same home as the transport window: both are "who is coming and how",
  // settled once a provider is chosen and before times are picked.
  // Settable for as long as it can still change the outcome — until a slot is
  // held. Gating on !hasFetchedAvailability assumed people declare every
  // constraint before looking; in practice the Calendar fetches availability
  // the moment a provider is selected, so that window closed before anyone
  // could reach it and this tool was dead in the deployed app. People also
  // work the other way round: look first, then say the carer is only free in
  // the morning. get_availability re-reads both constraints on every call.
  available: (state) => state.stage === "provider_selected",
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    if (state.stage === "browsing") {
      return { reason_code: "no_provider", reason: REASONS.no_provider, unlock_by: "select_provider" };
    }
    return { reason_code: "hold_active", reason: REASONS.hold_active, unlock_by: "release_slot" };
  },
  execute: (input) => {
    for (const [field, value] of [
      ["available_from", input.available_from],
      ["available_to", input.available_to],
    ] as const) {
      if (!TIME_RE.test(value)) {
        return refuse(
          "invalid_input",
          `${field} must be a 24-hour time as HH:MM; received "${value}". Valid: "09:30".`,
          { field },
        );
      }
    }
    if (input.available_from >= input.available_to) {
      return refuse(
        "invalid_input",
        `available_from (${input.available_from}) must be earlier than available_to (${input.available_to}).`,
        { field: "available_from" },
      );
    }

    bookingStore.getState().setCompanion({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      available_from: input.available_from,
      available_to: input.available_to,
    });

    return ok(
      {
        companion: bookingStore.getState().companion,
        note: "get_availability now offers only slots inside this window.",
      },
      `${input.name ? `${input.name} can` : "The companion can"} attend between ${input.available_from} and ${input.available_to}.`,
    );
  },
  announce: (_input, result) =>
    result.ok
      ? `set the companion window. ${result.human_summary}`
      : "could not set the companion window.",
});
