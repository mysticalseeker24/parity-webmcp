import * as z from "zod";
import { defineTool, type AnyDefinedTool, type ToolGroup } from "../lib/defineTool";
import { ok } from "../lib/result";
import { bookingStore, intakeMissing } from "../store";
import { NEVER_UNAVAILABLE, selectedProvider } from "./shared";

/**
 * The agent's orientation tool. Always live, and the first thing to call.
 *
 * Spec issue #262 — unregistering a tool destroys context: the agent sees only
 * that a tool vanished, not whether it is forbidden, not-yet-ready, or
 * irrelevant. We keep unregistration for enforcement and give the context back
 * here, in `unavailable[]`, without making the dangerous tool callable.
 *
 * Spec issue #255 — `live[]` is grouped, so the agent reads a handful of group
 * headings rather than nineteen descriptions.
 *
 * The whole payload must stay under the 1.5K character budget with every
 * non-live tool listed, which is why reason codes are terse and `unavailable[]`
 * carries codes rather than prose.
 */

// Set by tools/index.ts once every tool is constructed. A module-level
// reference rather than an import, because the tool list imports this file.
let allTools: readonly AnyDefinedTool[] = [];
export function registerToolCatalogue(tools: readonly AnyDefinedTool[]): void {
  allTools = tools;
}

export const getBookingState = defineTool({
  name: "get_booking_state",
  humanLabel: "Check booking status",
  group: "orient",
  readOnly: true,
  description:
    "Report where the booking has got to: stage, current selections, which tools are available now (grouped), and which are not yet available with the reason and how to unlock each. Call this first, and again whenever a tool you expected is missing.",
  schema: z.object({}),
  voiceAliases: ["where am I", "booking status"],
  available: () => true,
  unavailableReason: () => NEVER_UNAVAILABLE,
  execute: (_input, { now }) => {
    const state = bookingStore.getState();
    const provider = selectedProvider(state);
    const missing = intakeMissing(state.intake);

    const live: Partial<Record<ToolGroup, string[]>> = {};
    const unavailable: { tool: string; reason_code: string; reason: string; unlock_by: string }[] = [];
    for (const tool of allTools) {
      if (tool.available(state)) {
        (live[tool.group] ??= []).push(tool.name);
      } else {
        const why = tool.unavailableReason(state);
        unavailable.push({ tool: tool.name, ...why });
      }
    }

    return ok(
      {
        stage: state.stage,
        provider: provider ? { id: provider.id, name: provider.name } : null,
        held_slot: state.heldSlot
          ? {
              slot_id: state.heldSlot.slotId,
              expires_in_s: Math.max(0, Math.round((state.heldSlot.expiresAt - now) / 1000)),
            }
          : null,
        intake: { complete: missing.length === 0, missing },
        booking: state.booking ? { id: state.booking.id, slot_id: state.booking.slotId } : null,
        live,
        unavailable,
      },
      `Stage ${state.stage.replace(/_/g, " ")}.`,
    );
  },
  announce: (_input, result) =>
    result.ok ? `checked the booking status.` : `could not check the booking status.`,
});
