import * as z from "zod";
import { resolveCoverage } from "../data/coverage";
import { INSURANCE_PLANS, SPECIALTY, type InsurancePlan } from "../data/providers";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok, refuse } from "../lib/result";

/**
 * Insurance eligibility, answered from the rules table in `data/coverage.ts`.
 *
 * The result carries the **rule that fired** — its id and its human-readable
 * sentence — not a paraphrase. The agent cannot hallucinate coverage because it
 * never reads prose to reach the answer; it reads which rule matched. If the
 * answer is ever wrong, the rule id says exactly where to look.
 */
export const checkCoverage = defineTool({
  name: "check_coverage",
  humanLabel: "Check insurance coverage",
  group: "search",
  readOnly: true,
  description:
    "Check whether an insurance plan covers a specialty, and whether a referral is needed first. Returns the coverage rule that produced the answer, by id, so the reasoning can be checked rather than taken on trust.",
  schema: z.object({
    insurance: z.enum(INSURANCE_PLANS).describe("Insurance plan to check"),
    specialty: SPECIALTY.describe("Specialty the appointment is for"),
  }),
  voiceAliases: ["am I covered", "check my insurance"],
  available: (state) => state.stage === "browsing" && state.lastSearch !== null,
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    if (state.stage !== "browsing") {
      return { reason_code: "picking_times", reason: REASONS.picking_times, unlock_by: "release_slot" };
    }
    return { reason_code: "no_search", reason: REASONS.no_search, unlock_by: "find_providers" };
  },
  execute: (input) => {
    // Belt and braces: the schema constrains this, but schema constraints are
    // helpful rather than guaranteed (CONVENTIONS.md §4).
    if (!INSURANCE_PLANS.includes(input.insurance as InsurancePlan)) {
      return refuse("invalid_input", `Unknown plan "${input.insurance}".`, {
        field: "insurance",
      });
    }

    const rule = resolveCoverage(input.insurance, input.specialty);
    return ok(
      {
        insurance: input.insurance,
        specialty: input.specialty,
        effect: rule.effect,
        rule_id: rule.id,
        rule: rule.human_readable,
        can_book: rule.effect !== "not_covered",
      },
      rule.human_readable,
    );
  },
  announce: (_input, result) =>
    result.ok ? `checked coverage. ${result.human_summary}` : "could not check coverage.",
});
