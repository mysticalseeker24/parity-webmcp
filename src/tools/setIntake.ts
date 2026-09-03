import * as z from "zod";
import { ACCOMMODATION } from "../data/accommodations";
import { isRealDate } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { bookingStore, intakeMissing, type Intake } from "../store";
import { nextStep } from "./shared";

const FIELD_LABELS: Record<string, string> = {
  patient_name: "patient name",
  dob: "date of birth",
  reason: "reason for visit",
};

/**
 * Structured intake. Partial updates are allowed; completeness is computed, and
 * the stage flips to intake_complete — which is what registers confirm_booking —
 * only when every required field is present. Structural, not a runtime check.
 */
export const setIntake = defineTool({
  name: "set_intake",
  humanLabel: "Fill in intake",
  description:
    "Record patient intake for the held slot: name, date of birth, reason for visit, and accommodations needed on the day. Send any subset; fields you omit are kept. The result lists what is still missing. confirm_booking becomes available once nothing is.",
  schema: z.object({
    patient_name: z.string().min(1).optional().describe("Patient's full name as it should appear on the booking."),
    dob: z.string().optional().describe("Date of birth, YYYY-MM-DD."),
    reason: z.string().min(1).optional().describe("Reason for the visit, in the patient's own words."),
    accommodations: z
      .array(ACCOMMODATION)
      .optional()
      .describe("Accommodations needed on the day, by id from list_accommodations."),
  }),
  annotations: { readOnlyHint: false },
  reversible: true,
  available: (state) => state.stage === "slot_held" || state.stage === "intake_complete",
  voiceAliases: ["fill in my details", "intake"],
  execute: (input, { now }) => {
    const provided = Object.entries(input).filter(([, v]) => v !== undefined);
    if (provided.length === 0) {
      return { error: "provide at least one of patient_name, dob, reason, accommodations" };
    }

    if (input.dob !== undefined) {
      if (!isRealDate(input.dob)) {
        return { error: `dob must be ISO 8601 (YYYY-MM-DD); received "${input.dob}"`, field: "dob" };
      }
      const today = new Date(now).toISOString().slice(0, 10);
      if (input.dob > today) {
        return { error: `dob ${input.dob} is in the future`, field: "dob" };
      }
    }

    const patch: Intake = {
      ...(input.patient_name !== undefined ? { patient_name: input.patient_name.trim() } : {}),
      ...(input.dob !== undefined ? { dob: input.dob } : {}),
      ...(input.reason !== undefined ? { reason: input.reason.trim() } : {}),
      ...(input.accommodations !== undefined ? { accommodations: input.accommodations } : {}),
    };
    bookingStore.getState().setIntake(patch);

    const state = bookingStore.getState();
    const missing = intakeMissing(state.intake);
    return {
      intake: state.intake,
      complete: missing.length === 0,
      missing,
      stage: state.stage,
      next_step: nextStep(state),
    };
  },
  announce: (_input, result) =>
    result.complete
      ? `completed intake for ${result.intake.patient_name ?? "the patient"}.`
      : `updated intake. Still missing: ${result.missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.`,
});
