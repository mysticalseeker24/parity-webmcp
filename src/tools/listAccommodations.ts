import * as z from "zod";
import { ACCOMMODATION, ACCOMMODATION_LABELS } from "../data/accommodations";
import { defineTool } from "../lib/defineTool";

/**
 * The controlled vocabulary. Always live. Exists so the agent reads the exact
 * ids `find_providers` and `set_intake` accept instead of inventing near-misses
 * like "wheelchair" that would silently match nothing.
 */
export const listAccommodations = defineTool({
  name: "list_accommodations",
  humanLabel: "List accommodation options",
  description:
    "List every accommodation this site can filter or request, with its exact id. Use these ids in find_providers and set_intake; free-text accommodation names are not matched.",
  schema: z.object({}),
  annotations: { readOnlyHint: true },
  reversible: false,
  available: () => true,
  voiceAliases: ["what accommodations are there", "accommodation options"],
  execute: () => ({
    accommodations: ACCOMMODATION.options.map((id) => ({
      id,
      label: ACCOMMODATION_LABELS[id].label,
      description: ACCOMMODATION_LABELS[id].description,
    })),
  }),
  announce: (_input, result) => `listed ${result.accommodations.length} accommodation options.`,
});
