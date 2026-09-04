import * as z from "zod";
import { ACCOMMODATION } from "../data/accommodations";
import { PROVIDERS, SPECIALTY, type Provider } from "../data/providers";
import { defineTool } from "../lib/defineTool";
import { ok, refuse } from "../lib/result";
import { bookingStore, type LastSearch } from "../store";
import { providerSummary } from "./shared";

const MAX_RESULTS = 5;

/**
 * Multi-constraint search. Each constraint is applied in turn and the count it
 * eliminated is recorded, so a zero-result search can name *which* constraint
 * emptied the list instead of saying "no results" — the store field that
 * Tier 2's `explain_no_results` reads.
 */
export const findProviders = defineTool({
  name: "find_providers",
  humanLabel: "Find providers",
  group: "search",
  readOnly: true,
  description:
    "Search specialists by specialty, required accommodations, insurance plan, language and distance. Returns up to 5 matches, nearest first, with the accommodations each offers. When nothing matches, the result names the constraint that eliminated the most candidates so you can relax it.",
  schema: z.object({
    specialty: SPECIALTY.describe("Medical specialty needed"),
    accommodations: z
      .array(ACCOMMODATION)
      .default([])
      .describe("Accommodations the provider must offer"),
    insurance: z.string().optional().describe("Insurance plan name, as the patient states it"),
    language: z.string().optional().describe("A language the provider must speak"),
    radius_km: z
      .number()
      .positive()
      .max(100)
      .optional()
      .describe("Maximum distance from the patient, in kilometres"),
  }),
  voiceAliases: ["find a doctor", "search providers"],
  available: (state) => state.stage === "browsing" || state.stage === "provider_selected",
  unavailableReason: (state) => ({
    reason_code: state.stage === "booked" ? "already_booked" : "hold_active",
    reason:
      state.stage === "booked"
        ? "The appointment is already booked."
        : "A slot is on hold; searching again would lose it.",
    unlock_by: state.stage === "booked" ? "" : "release_slot",
  }),
  execute: (input) => {
    const eliminated: Record<string, number> = {};
    let pool: Provider[] = [...PROVIDERS];

    const apply = (constraint: string, keep: (p: Provider) => boolean) => {
      const before = pool.length;
      pool = pool.filter(keep);
      const removed = before - pool.length;
      if (removed > 0) eliminated[constraint] = removed;
    };

    apply("specialty", (p) => p.specialty === input.specialty);
    if (input.accommodations.length > 0) {
      apply("accommodations", (p) =>
        input.accommodations.every((a) => p.accommodations.includes(a)),
      );
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

    if (pool.length === 0) {
      const worst = Object.entries(eliminated)
        .filter(([constraint]) => constraint !== "specialty")
        .sort(([, a], [, b]) => b - a)[0];
      return refuse(
        "unavailable",
        worst
          ? `No ${input.specialty} provider matches. The "${worst[0]}" constraint eliminated ${worst[1]} of them; relax it and search again.`
          : `No provider offers ${input.specialty}.`,
        { next: "find_providers" },
      );
    }

    return ok(
      {
        showing: shown.length,
        total: pool.length,
        providers: shown.map(providerSummary),
        ...(pool.length > MAX_RESULTS
          ? { note: `showing ${shown.length} of ${pool.length}; narrow the search` }
          : {}),
      },
      pool.length > MAX_RESULTS
        ? `Showing ${shown.length} of ${pool.length} ${input.specialty} providers.`
        : `${pool.length} ${input.specialty} provider${pool.length === 1 ? "" : "s"}.`,
    );
  },
  announce: (input, result) =>
    result.ok
      ? `found ${result.human_summary.toLowerCase()}`
      : `found no ${input.specialty} providers.`,
});
