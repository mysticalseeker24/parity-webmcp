import * as z from "zod";
import { defineTool, type AnyDefinedTool } from "../lib/defineTool";
import { REASONS } from "../lib/reasons";
import { ok } from "../lib/result";

/**
 * What this site can and cannot do. Always live.
 *
 * Its job is to stop an agent burning turns on dead ends — and, just as
 * usefully, to state the limits plainly rather than letting a model infer
 * capabilities that do not exist. The "cannot" list is the valuable half.
 */

let catalogue: readonly AnyDefinedTool[] = [];
export function registerCapabilityCatalogue(tools: readonly AnyDefinedTool[]): void {
  catalogue = tools;
}

const CANNOT = [
  "change a provider's own availability",
  "book for more than one patient at a time",
  "approve its own booking — only the person at the page can",
  "take payment, or check a deductible",
  "contact the clinic, send email, or leave a voicemail",
  "remember anything after the tab closes",
] as const;

export const explainCapability = defineTool({
  name: "explain_capability",
  humanLabel: "What this site can do",
  group: "orient",
  readOnly: true,
  description:
    "Describe what this site can and cannot do, and how many tools exist in total versus how many are callable right now. Use it when a request seems out of scope, before trying an approach that may not be supported.",
  schema: z.object({}),
  voiceAliases: ["what can you do", "what can this site do"],
  // The "what is this site" tool, for before you start. Once a search is under
  // way, get_booking_state is the orientation tool and this would only crowd
  // the live set.
  available: (state) => state.stage === "browsing" && state.lastSearch === null,
  unavailableReason: (state) => {
    if (state.stage === "booked") {
      return { reason_code: "already_booked", reason: REASONS.already_booked, unlock_by: "" };
    }
    return {
      reason_code: "already_searched",
      reason: REASONS.already_searched,
      unlock_by: "get_booking_state",
    };
  },
  execute: () =>
    ok(
      {
        can: [
          "search specialists by insurance, language, accommodations and distance",
          "explain which constraint made a search return nothing",
          "check whether a plan covers a specialty, with the rule that decided it",
          "hold a slot for 10 minutes, then release or re-hold it",
          "record patient intake and a companion's availability window",
          "book and cancel, each after the patient approves on the page",
        ],
        cannot: CANNOT,
        tools_defined: catalogue.length,
        // The small live surface is deliberate, so say so rather than letting
        // it look like tools went missing (#255, #262).
        note: "Tools register and unregister with the booking stage. If one is missing, call get_booking_state and read unavailable[] for the reason and the tool that unlocks it.",
        data: "Synthetic. No real providers, patients or appointments.",
      },
      `${catalogue.length} tools defined; the live set changes with the booking stage.`,
    ),
  announce: (_input, result) =>
    result.ok ? `described what this site can do.` : "could not describe the site's capabilities.",
});
