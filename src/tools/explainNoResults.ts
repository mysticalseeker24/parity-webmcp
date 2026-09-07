import * as z from "zod";
import { SPECIALTY_LABELS } from "../data/providers";
import { defineTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok } from "../lib/result";
import { bookingStore } from "../store";

/**
 * Registers **only when the last search returned zero**, which is the whole
 * idea: a tool that exists exactly when it is useful, and not otherwise.
 *
 * Chrome's guidance is to return descriptive errors so the model can
 * self-correct. This makes that a first-class tool rather than a hope — it
 * names which constraint eliminated how many candidates and what to relax,
 * reading the counts `find_providers` recorded rather than guessing.
 */

const CONSTRAINT_LABELS: Record<string, string> = {
  specialty: "specialty",
  accommodations: "required accommodations",
  insurance: "insurance plan",
  language: "language",
  radius_km: "distance",
};

export const explainNoResults = defineTool({
  name: "explain_no_results",
  humanLabel: "Explain why nothing matched",
  group: "search",
  readOnly: true,
  description:
    "Explain why the last provider search returned nothing: which constraint eliminated how many providers, and which single change would open up the most options. Available only after a search that matched nobody.",
  schema: z.object({}),
  voiceAliases: ["why did nothing match", "why no results"],
  // Browsing only. Without the stage check a zero-result search earlier in the
  // session would leave this live all the way through to `booked`, explaining
  // a search nobody is looking at any more.
  available: (state) =>
    state.stage === "browsing" &&
    state.lastSearch !== null &&
    state.lastSearch.total_matches === 0,
  unavailableReason: (state) => {
    if (state.stage !== "browsing") {
      return { reason_code: "picking_times", reason: REASONS.picking_times, unlock_by: "release_slot" };
    }
    const code = state.lastSearch === null ? "no_search" : "search_had_results";
    return { reason_code: code, reason: REASONS[code], unlock_by: "find_providers" };
  },
  execute: () => {
    const search = bookingStore.getState().lastSearch;
    if (!search) {
      // available() guarantees this cannot happen; a refusal here would be
      // dishonest about why, so return the empty shape instead.
      return ok({ constraints: [], relax: null }, "No search to explain.");
    }

    const eliminated = Object.entries(search.eliminated_by)
      .filter(([constraint]) => constraint !== "specialty")
      .sort(([, a], [, b]) => b - a);

    const worst = eliminated[0];
    const specialtyLabel = SPECIALTY_LABELS[search.specialty];

    return ok(
      {
        specialty: search.specialty,
        constraints: eliminated.map(([constraint, count]) => ({
          constraint,
          eliminated: count,
        })),
        // Naming the single highest-value change beats listing five options.
        relax: worst ? worst[0] : null,
        required_accommodations: search.accommodations,
      },
      worst
        ? `No ${specialtyLabel} provider matched. ${CONSTRAINT_LABELS[worst[0]] ?? worst[0]} ruled out ${worst[1]}; relaxing it opens the most options.`
        : `No provider offers ${specialtyLabel} at all.`,
    );
  },
  announce: (_input, result) =>
    result.ok ? `explained the empty search. ${result.human_summary}` : "could not explain the search.",
});
