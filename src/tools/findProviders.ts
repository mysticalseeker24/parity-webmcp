import * as z from "zod";
import { ACCOMMODATION } from "../data/accommodations";
import { PROVIDERS, SPECIALTY, type Provider } from "../data/providers";
import { defineTool } from "../lib/defineTool";
import { bookingStore, type LastSearch } from "../store";
import { providerSummary } from "./shared";

const MAX_RESULTS = 5;

/**
 * Multi-constraint provider search. Each constraint is applied in turn and the
 * number it eliminated is recorded, so a zero-result search can say *which*
 * constraint emptied the list rather than "no results" (PROJECT_SPEC.md §10).
 */
export const findProviders = defineTool({
  name: "find_providers",
  humanLabel: "Find providers",
  description:
    "Search specialists by specialty, required accommodations, insurance plan, language and distance. Returns up to 5 matches with the accommodations each offers. When nothing matches, the result names which constraint eliminated the most candidates so you can relax it.",
  schema: z.object({
    specialty: SPECIALTY.describe("Medical specialty required."),
    accommodations: z
      .array(ACCOMMODATION)
      .default([])
      .describe("Accommodations the provider must offer. Use ids from list_accommodations."),
    insurance: z
      .string()
      .optional()
      .describe('Insurance plan name as the patient states it, e.g. "Northstar PPO".'),
    language: z
      .string()
      .optional()
      .describe('A language the provider must speak, e.g. "Spanish".'),
    radius_km: z
      .number()
      .positive()
      .max(100)
      .optional()
      .describe("Maximum distance from the patient in kilometres."),
  }),
  annotations: { readOnlyHint: true },
  reversible: false,
  available: (state) => state.stage === "browsing" || state.stage === "provider_selected",
  voiceAliases: ["find a doctor", "search providers"],
  execute: (input) => {
    const eliminated: Record<string, number> = {};
    let pool: Provider[] = [...PROVIDERS];

    const apply = (constraint: string, keep: (p: Provider) => boolean) => {
      const before = pool.length;
      pool = pool.filter(keep);
      eliminated[constraint] = before - pool.length;
    };

    apply("specialty", (p) => p.specialty === input.specialty);
    if (input.accommodations.length > 0) {
      apply("accommodations", (p) => input.accommodations.every((a) => p.accommodations.includes(a)));
    }
    if (input.insurance) {
      const wanted = input.insurance.trim().toLowerCase();
      apply("insurance", (p) => p.insurance.some((plan) => plan.toLowerCase() === wanted));
    }
    if (input.language) {
      const wanted = input.language.trim().toLowerCase();
      apply("language", (p) => p.languages.some((l) => l.toLowerCase() === wanted));
    }
    if (input.radius_km !== undefined) {
      const radius = input.radius_km;
      apply("radius_km", (p) => p.location.distance_km <= radius);
    }

    pool.sort((a, b) => a.location.distance_km - b.location.distance_km);
    const shown = pool.slice(0, MAX_RESULTS);

    const search: LastSearch = {
      specialty: input.specialty,
      accommodations: input.accommodations,
      ...(input.insurance !== undefined ? { insurance: input.insurance } : {}),
      ...(input.language !== undefined ? { language: input.language } : {}),
      ...(input.radius_km !== undefined ? { radius_km: input.radius_km } : {}),
      result_ids: shown.map((p) => p.id),
      total_matches: pool.length,
      eliminated_by: eliminated,
    };
    bookingStore.getState().recordSearch(search);

    let hint: string | undefined;
    if (pool.length === 0) {
      const [worst] = Object.entries(eliminated)
        .filter(([constraint]) => constraint !== "specialty")
        .sort(([, a], [, b]) => b - a);
      hint = worst && worst[1] > 0
        ? `The "${worst[0]}" constraint eliminated ${worst[1]} candidate${worst[1] === 1 ? "" : "s"}; relax it and search again.`
        : `No providers offer ${input.specialty.replace("_", " ")}.`;
    }

    return {
      showing: shown.length,
      total: pool.length,
      providers: shown.map(providerSummary),
      eliminated_by: eliminated,
      ...(pool.length > MAX_RESULTS
        ? { note: `Showing ${MAX_RESULTS} of ${pool.length}; add a constraint to narrow the search.` }
        : {}),
      ...(hint !== undefined ? { hint } : {}),
      next_step:
        shown.length > 0
          ? "Call select_provider with the provider_id the patient chooses."
          : "Relax a constraint and call find_providers again.",
    };
  },
  announce: (input, result) =>
    result.total === 0
      ? `found no ${input.specialty.replace("_", " ")} providers. ${result.hint ?? ""}`.trim()
      : `found ${result.total} ${input.specialty.replace("_", " ")} provider${result.total === 1 ? "" : "s"}${
          input.accommodations.length ? ` offering ${input.accommodations.length} required accommodation${input.accommodations.length === 1 ? "" : "s"}` : ""
        }.`,
});
