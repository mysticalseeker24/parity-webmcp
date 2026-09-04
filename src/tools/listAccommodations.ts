import * as z from "zod";
import { ACCOMMODATION, ACCOMMODATION_LABELS } from "../data/accommodations";
import { defineTool } from "../lib/defineTool";
import { ok } from "../lib/result";
import { NEVER_UNAVAILABLE } from "./shared";

/**
 * The controlled vocabulary. Always live.
 *
 * Spec issue #239 — structural constraint over prose instruction. The agent
 * reads the exact ids `find_providers` and `set_intake` accept, so it cannot
 * invent a near-miss like "wheelchair" that would silently match nothing.
 */
export const listAccommodations = defineTool({
  name: "list_accommodations",
  humanLabel: "List accommodation options",
  group: "orient",
  readOnly: true,
  description:
    "List every accommodation this site can filter on or request, with the exact id to use. Pass these ids to find_providers and set_intake; free-text accommodation names are not matched.",
  schema: z.object({}),
  voiceAliases: ["what accommodations are there", "accommodation options"],
  available: () => true,
  unavailableReason: () => NEVER_UNAVAILABLE,
  execute: () =>
    ok(
      {
        accommodations: ACCOMMODATION.options.map((id) => ({
          id,
          label: ACCOMMODATION_LABELS[id],
        })),
      },
      `${ACCOMMODATION.options.length} accommodation options.`,
    ),
  announce: (_input, result) =>
    result.ok ? "listed the accommodation options." : "could not list the accommodation options.",
});
