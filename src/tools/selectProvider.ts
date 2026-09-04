import * as z from "zod";
import { accommodationLabels } from "../data/accommodations";
import { findProvider } from "../data/providers";
import { defineTool } from "../lib/defineTool";
import { ok, refuse } from "../lib/result";
import { bookingStore } from "../store";
import { providerSummary, specialtyLabel } from "./shared";

/**
 * Selecting a provider who lacks an accommodation the search required is a
 * hard block, not a warning (PROJECT_SPEC.md §10). The refusal names the
 * accommodation that failed so the agent can search again rather than argue —
 * a structured refusal, fulfilled with `ok: false` (#282).
 */
export const selectProvider = defineTool({
  name: "select_provider",
  humanLabel: "Select provider",
  group: "search",
  reversible: true,
  description:
    "Choose the provider to book with, by provider_id from find_providers. Refuses, naming the accommodation, if the provider lacks any accommodation the last search required. Moves the booking on so availability can be fetched.",
  schema: z.object({
    provider_id: z.string().describe("Provider id from find_providers"),
  }),
  voiceAliases: ["choose this doctor", "select provider"],
  available: (state) => state.stage === "browsing" || state.stage === "provider_selected",
  unavailableReason: (state) => ({
    reason_code: state.stage === "booked" ? "already_booked" : "hold_active",
    reason:
      state.stage === "booked"
        ? "The appointment is already booked."
        : "A slot is on hold; changing provider would lose it.",
    unlock_by: state.stage === "booked" ? "" : "release_slot",
  }),
  execute: (input) => {
    const provider = findProvider(input.provider_id);
    if (!provider) {
      return refuse(
        "invalid_input",
        `No provider has id "${input.provider_id}". Use an id from find_providers.`,
        { field: "provider_id", next: "find_providers" },
      );
    }

    const store = bookingStore.getState();
    const required = store.lastSearch?.accommodations ?? [];
    const missing = required.filter((a) => !provider.accommodations.includes(a));
    if (missing.length > 0) {
      return refuse(
        "refused",
        `${provider.name} does not offer ${accommodationLabels(missing)}, which the search required. Choose another provider or search again without it.`,
        { field: "provider_id", next: "find_providers" },
      );
    }

    store.selectProvider(provider.id);
    return ok(
      { selected: providerSummary(provider), stage: bookingStore.getState().stage },
      `${provider.name}, ${specialtyLabel(provider)}.`,
    );
  },
  announce: (_input, result) =>
    result.ok ? `selected ${result.human_summary}` : `could not select that provider.`,
});
