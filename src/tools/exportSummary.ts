import * as z from "zod";
import { accommodationLabel } from "../data/accommodations";
import { findProvider, SPECIALTY_LABELS } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok } from "../lib/result";
import { bookingStore } from "../store";

/**
 * A plain-text summary for the patient's records, or to hand to a caregiver.
 *
 * Deliberately plain text rather than a structured blob: the point is that it
 * can be pasted into a message, read aloud, or printed. The accommodations are
 * spelled out in words for the same reason — a caregiver reading this has no
 * access to the enum.
 */
export const exportSummary = defineTool({
  name: "export_summary",
  humanLabel: "Summarise the appointment",
  group: "manage",
  readOnly: true,
  description:
    "Produce a plain-text summary of the appointment — provider, date, time, patient, and every accommodation requested — suitable for the patient's records or for sending to a companion.",
  schema: z.object({}),
  voiceAliases: ["summarise the appointment", "send me a summary"],
  available: (state) => state.stage === "booked" && state.booking !== null,
  unavailableReason: () => ({
    reason_code: "not_booked",
    reason: REASONS.not_booked,
    unlock_by: "confirm_booking",
  }),
  execute: () => {
    const state = bookingStore.getState();
    const booking = state.booking;
    const slotId = booking?.slotId ?? state.heldSlot?.slotId;
    const slot = slotId ? findSlot(slotId) : undefined;
    const providerId = booking?.providerId ?? state.selectedProviderId;
    const provider = providerId ? findProvider(providerId) : undefined;
    const intake = booking?.intake ?? state.intake;

    const lines = [
      booking ? "APPOINTMENT — CONFIRMED" : "APPOINTMENT — HELD, NOT YET CONFIRMED",
      "",
      `Provider:  ${provider?.name ?? "not selected"}`,
      provider ? `Specialty: ${SPECIALTY_LABELS[provider.specialty]}` : "",
      provider ? `Location:  ${provider.location.area} (${provider.location.distance_km} km)` : "",
      slot ? `When:      ${slotLabel(slot)} (${slot.duration_min} minutes)` : "",
      "",
      `Patient:   ${intake.patient_name ?? "not given"}`,
      intake.dob ? `Born:      ${intake.dob}` : "",
      intake.reason ? `Reason:    ${intake.reason}` : "",
    ];

    const accommodations = intake.accommodations ?? [];
    if (accommodations.length > 0) {
      lines.push("", "Accommodations requested:");
      for (const a of accommodations) lines.push(`  - ${accommodationLabel(a)}`);
    }

    if (state.companion?.available_from) {
      lines.push(
        "",
        `Companion: ${state.companion.name ?? "attending"}, ${state.companion.available_from}–${state.companion.available_to}`,
      );
    }

    if (provider && accommodations.includes("asl_interpreter")) {
      // The lead time is the thing most likely to derail an interpreter
      // booking, so it belongs in the summary rather than buried in the fixture.
      lines.push(
        "",
        `Interpreter: book at least ${provider.interpreter_lead_time_days} days ahead for this provider.`,
      );
    }

    lines.push("", booking ? `Reference: ${booking.id}` : "Not yet booked.");

    const text = lines.filter((line) => line !== "" || true).join("\n").replace(/\n{3,}/g, "\n\n");

    return ok(
      { text, confirmed: booking !== null },
      booking ? `Summary for booking ${booking.id}.` : "Summary of the held appointment.",
    );
  },
  announce: (_input, result) =>
    result.ok ? `produced the appointment summary.` : "could not produce a summary.",
});
