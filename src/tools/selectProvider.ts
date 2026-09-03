import * as z from "zod";
import { findProvider } from "../data/providers";
import { defineTool } from "../lib/defineTool";
import { bookingStore } from "../store";
import { listLabels, nextStep, providerSummary, specialtyLabel } from "./shared";

/**
 * Selecting a provider is a hard block, not a warning, when they lack an
 * accommodation the search required (PROJECT_SPEC.md §10). The agent is told
 * exactly which one failed so it can search again rather than argue.
 */
export const selectProvider = defineTool({
  name: "select_provider",
  humanLabel: "Select provider",
  description:
    "Choose the provider to book with, by provider_id from find_providers. Fails, naming the accommodation, if the provider lacks any accommodation the last search required. Moves the booking to the provider_selected stage.",
  schema: z.object({
    provider_id: z.string().describe('Provider id from find_providers, e.g. "p03".'),
  }),
  annotations: { readOnlyHint: false },
  reversible: true,
  available: (state) => state.stage === "browsing" || state.stage === "provider_selected",
  voiceAliases: ["choose this doctor", "select provider"],
  execute: (input) => {
    const provider = findProvider(input.provider_id);
    if (!provider) {
      return {
        error: `provider_id "${input.provider_id}" does not exist; use an id returned by find_providers`,
        field: "provider_id",
      };
    }

    const store = bookingStore.getState();
    const required = store.lastSearch?.accommodations ?? [];
    const missing = required.filter((a) => !provider.accommodations.includes(a));
    if (missing.length > 0) {
      return {
        error: `${provider.name} lacks required accommodation${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Choose another provider or search again without ${missing.length === 1 ? "it" : "them"}.`,
        field: "provider_id",
        details: { missing_accommodations: missing },
      };
    }

    store.selectProvider(provider.id);
    const state = bookingStore.getState();
    return {
      selected: {
        ...providerSummary(provider),
        specialty_label: specialtyLabel(provider),
        matched_accommodations: required,
      },
      stage: state.stage,
      next_step: nextStep(state),
    };
  },
  announce: (_input, result) => {
    const acc = result.selected.matched_accommodations;
    return `selected ${result.selected.name}, ${result.selected.specialty_label}${
      acc.length ? `, ${listLabels(acc)}` : ""
    }.`;
  },
});
