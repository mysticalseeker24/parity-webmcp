import * as z from "zod";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { bookingStore } from "../store";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * A paratransit pickup window.
 *
 * This is the constraint most likely to be invisible in an ordinary booking
 * flow and most likely to make an appointment unusable: a slot you can reach
 * but cannot leave is not a slot. It filters availability the same way the
 * companion window does, and for the same reason — the tool promises the
 * filtering, so the filtering has to happen.
 */
export const setTransportConstraint = defineTool({
  name: "set_transport_constraint",
  humanLabel: "Set transport window",
  group: "search",
  reversible: true,
  description:
    "Record the paratransit or accessible-transport pickup window, so only appointments that start and finish inside it are offered. Times are 24-hour, for example 10:00 to 15:00.",
  schema: z.object({
    earliest_pickup: z.string().describe("Earliest time transport can bring you (HH:MM)"),
    latest_return: z.string().describe("Latest time transport can collect you (HH:MM)"),
    note: z.string().optional().describe("Anything the clinic should know about your transport"),
  }),
  voiceAliases: ["set my transport window", "paratransit window"],
  // Set once you know where you are going, before you start picking times.
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
      ["earliest_pickup", input.earliest_pickup],
      ["latest_return", input.latest_return],
    ] as const) {
      if (!TIME_RE.test(value)) {
        return refuse(
          `invalid_input`,
          `${field} must be a 24-hour time as HH:MM; received "${value}". Valid: "10:00".`,
          { field },
        );
      }
    }
    if (input.earliest_pickup >= input.latest_return) {
      return refuse(
        "invalid_input",
        `earliest_pickup (${input.earliest_pickup}) must be earlier than latest_return (${input.latest_return}).`,
        { field: "earliest_pickup" },
      );
    }

    bookingStore.getState().setTransport({
      earliest_pickup: input.earliest_pickup,
      latest_return: input.latest_return,
      ...(input.note !== undefined ? { note: input.note.trim() } : {}),
    });

    return ok(
      {
        transport: bookingStore.getState().transport,
        note: "get_availability now offers only appointments that finish before the return time.",
      },
      `Transport between ${input.earliest_pickup} and ${input.latest_return}.`,
    );
  },
  announce: (_input, result) =>
    result.ok
      ? `set the transport window. ${result.human_summary}`
      : "could not set the transport window.",
});
