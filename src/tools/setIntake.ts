import * as z from "zod";
import { ACCOMMODATION } from "../data/accommodations";
import { isRealDate } from "../data/slots";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";
import { bookingStore, intakeMissing, type Intake } from "../store";

const FIELD_LABELS: Record<string, string> = {
  patient_name: "patient name",
  dob: "date of birth",
  reason: "reason for visit",
};

/**
 * Structured intake. Partial updates are allowed and completeness is computed;
 * the stage flips to `intake_complete` — which is what registers
 * `confirm_booking` — only when every required field is present. That is
 * structural, not a runtime check (CONVENTIONS.md §5).
 */
export const setIntake = defineTool({
  name: "set_intake",
  humanLabel: "Fill in intake",
  group: "intake",
  reversible: true,
  description:
    "Record patient intake for the held slot: name, date of birth, reason for the visit, and any accommodations needed on the day. Send any subset; omitted fields keep their current value. The result lists what is still missing.",
  schema: z.object({
    patient_name: z.string().min(1).optional().describe("Patient's full name"),
    dob: z.string().optional().describe("Date of birth (YYYY-MM-DD)"),
    reason: z.string().min(1).optional().describe("Reason for the visit, in the patient's words"),
    accommodations: z
      .array(ACCOMMODATION)
      .optional()
      .describe("Accommodations needed on the day"),
  }),
  voiceAliases: ["fill in my details", "intake"],
  available: (state) => state.stage === "slot_held" || state.stage === "intake_complete",
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    const code = state.holdExpired ? "hold_expired" : "no_hold";
    return { reason_code: code, reason: REASONS[code], unlock_by: "hold_slot" };
  },
  execute: (input, { now }) => {
    const provided = Object.entries(input).filter(([, v]) => v !== undefined);
    if (provided.length === 0) {
      return refuse(
        "invalid_input",
        "Provide at least one of patient_name, dob, reason or accommodations.",
      );
    }

    // Strict validation in code, loose in schema (CONVENTIONS.md §4).
    if (input.dob !== undefined) {
      if (!isRealDate(input.dob)) {
        return refuse(
          "invalid_input",
          `dob must be ISO 8601 (YYYY-MM-DD); received "${input.dob}". Valid: "1984-03-09".`,
          { field: "dob" },
        );
      }
      if (input.dob > new Date(now).toISOString().slice(0, 10)) {
        return refuse("invalid_input", `dob ${input.dob} is in the future.`, { field: "dob" });
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
    return ok(
      { intake: state.intake, complete: missing.length === 0, missing, stage: state.stage },
      missing.length === 0
        ? `Intake complete for ${state.intake.patient_name ?? "the patient"}.`
        : `Still missing: ${missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.`,
    );
  },
  announce: (_input, result) =>
    result.ok ? `updated the intake. ${result.human_summary}` : "could not update the intake.",
});
