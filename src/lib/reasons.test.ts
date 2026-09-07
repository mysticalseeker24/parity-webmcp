import { describe, expect, it } from "vitest";
import { bookingStore } from "../store";
import { TOOLS } from "../tools";
import { REASONS, reasonText, toolLostSentence, type ReasonCode } from "./reasons";

describe("reasons table — one source for both surfaces (#262)", () => {
  it("every sentence is a complete sentence a human can hear", () => {
    for (const [code, sentence] of Object.entries(REASONS)) {
      expect(sentence, code).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("every reason_code a tool can emit exists in the table", () => {
    const store = bookingStore.getState();
    // Walk the states that produce different reasons.
    const states = [
      store,
      { ...store, stage: "booked" as const },
      { ...store, heldSlot: null, holdExpired: true },
      { ...store, stage: "slot_held" as const, heldSlot: { slotId: "s", providerId: "p", expiresAt: 0 } },
      { ...store, stage: "provider_selected" as const, selectedProviderId: "p01" },
    ];
    for (const state of states) {
      for (const tool of TOOLS) {
        const { reason_code } = tool.unavailableReason(state);
        expect(Object.keys(REASONS), `${tool.name} emitted "${reason_code}"`).toContain(reason_code);
      }
    }
  });

  it("the agent's reason and the human's sentence come from the same entry", () => {
    // If these could drift, a screen-reader user and the agent would be told
    // different things about the same event.
    const code: ReasonCode = "hold_expired";
    expect(reasonText(code)).toBe(REASONS[code]);
    expect(toolLostSentence("Confirm booking", code)).toBe(
      "Confirm booking is no longer available: the hold on the slot expired.",
    );
  });
});
