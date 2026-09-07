import { afterEach, describe, expect, it } from "vitest";
import { focusStage, stageSentence, stageTargets } from "./stageFocus";
import type { Stage } from "../store";

const STAGES: Stage[] = [
  "browsing",
  "provider_selected",
  "slot_held",
  "intake_complete",
  "booked",
];

afterEach(() => {
  document.body.innerHTML = "";
});

describe("stage focus targets", () => {
  it("names a target for every stage", () => {
    for (const stage of STAGES) expect(stageTargets(stage).length).toBeGreaterThan(0);
  });

  it("focuses the stage's primary control", () => {
    document.body.innerHTML = `
      <input id="specialty" />
      <h2 id="calendar-heading" tabindex="-1"></h2>
      <input id="patient_name" />
      <button id="confirm-booking"></button>
      <h2 id="summary-heading" tabindex="-1"></h2>`;

    const expected: Record<Stage, string> = {
      browsing: "specialty",
      provider_selected: "calendar-heading",
      slot_held: "patient_name",
      intake_complete: "confirm-booking",
      booked: "summary-heading",
    };

    for (const stage of STAGES) {
      expect(focusStage(stage)).toBe(expected[stage]);
      expect(document.activeElement?.id).toBe(expected[stage]);
    }
  });

  it("falls back to the next target when the primary one is absent", () => {
    // The confirm button only exists once intake is complete; if it has not
    // rendered yet, focus must still land somewhere sensible.
    document.body.innerHTML = `<h2 id="intake-heading" tabindex="-1"></h2>`;
    expect(focusStage("intake_complete")).toBe("intake-heading");
  });

  it("returns null rather than throwing when nothing matches", () => {
    expect(focusStage("booked")).toBeNull();
  });

  it("gives every stage a sentence saying where the work moved", () => {
    for (const stage of STAGES) {
      expect(stageSentence(stage)).toMatch(/^[A-Z].*\.$/);
    }
    expect(stageSentence("slot_held")).toBe("Now fill in the patient details.");
  });
});
