import type { InsurancePlan, Specialty } from "./providers";

/**
 * Coverage rules as **data, not code** (TOOLS.md §10), so `check_coverage`
 * (Tier 2) can return the rule path that produced its answer rather than a
 * sentence of prose. The agent cannot hallucinate coverage because it never
 * reads prose — it reads which rule fired.
 */

export interface CoverageRule {
  readonly id: string;
  /** Matched against the query; every stated field must match. */
  readonly condition: {
    readonly plan?: InsurancePlan;
    readonly specialty?: Specialty;
  };
  readonly effect: "covered" | "referral_required" | "not_covered";
  readonly human_readable: string;
}

/** First match wins, so specific rules precede the catch-alls. */
export const COVERAGE_RULES: readonly CoverageRule[] = [
  {
    id: "cov_harbor_none",
    condition: { plan: "Harbor Assist" },
    effect: "not_covered",
    human_readable: "Harbor Assist has no in-network specialists on this site.",
  },
  {
    id: "cov_civic_neuro_referral",
    condition: { plan: "CivicCare Basic", specialty: "neurology" },
    effect: "referral_required",
    human_readable: "CivicCare Basic needs a referral from your GP before a neurology visit.",
  },
  {
    id: "cov_civic_rheum_referral",
    condition: { plan: "CivicCare Basic", specialty: "rheumatology" },
    effect: "referral_required",
    human_readable: "CivicCare Basic needs a referral from your GP before a rheumatology visit.",
  },
  {
    id: "cov_meridian_physio_referral",
    condition: { plan: "Meridian HMO", specialty: "physiotherapy" },
    effect: "referral_required",
    human_readable: "Meridian HMO needs a referral before physiotherapy.",
  },
  {
    id: "cov_lantern_audiology_no",
    condition: { plan: "Lantern Plus", specialty: "audiology" },
    effect: "not_covered",
    human_readable: "Lantern Plus does not cover audiology.",
  },
  {
    id: "cov_default",
    condition: {},
    effect: "covered",
    human_readable: "This plan covers the visit with no referral needed.",
  },
];

export function resolveCoverage(plan: InsurancePlan, specialty: Specialty): CoverageRule {
  const matched = COVERAGE_RULES.find(
    (rule) =>
      (rule.condition.plan === undefined || rule.condition.plan === plan) &&
      (rule.condition.specialty === undefined || rule.condition.specialty === specialty),
  );
  // The catch-all guarantees a match; the fallback keeps the type honest.
  return matched ?? COVERAGE_RULES[COVERAGE_RULES.length - 1]!;
}
