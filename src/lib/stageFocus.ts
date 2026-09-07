import type { Stage } from "../store";

/**
 * Where focus should go when the stage changes.
 *
 * A stage change moves the work to a different part of the page. A sighted user
 * sees that; without moving focus, a keyboard or screen-reader user is left on
 * a control that may no longer exist, and has to hunt for what changed. So
 * focus follows the work — but **only on an actual stage change**, never on an
 * ordinary re-render, or it would yank focus out from under someone mid-typing.
 */

/** Element ids, in priority order, for each stage's primary control. */
const TARGETS: Record<Stage, readonly string[]> = {
  browsing: ["specialty"],
  provider_selected: ["calendar-heading"],
  slot_held: ["patient_name"],
  intake_complete: ["confirm-booking", "intake-heading"],
  booked: ["summary-heading"],
};

const STAGE_SENTENCES: Record<Stage, string> = {
  browsing: "Now find a provider.",
  provider_selected: "Now pick a time from the availability grid.",
  slot_held: "Now fill in the patient details.",
  intake_complete: "Ready to confirm the booking.",
  booked: "The appointment is booked.",
};

export function stageSentence(stage: Stage): string {
  return STAGE_SENTENCES[stage];
}

/** Focus the first target that exists. Returns what it focused, for tests. */
export function focusStage(stage: Stage, root: ParentNode = document): string | null {
  for (const id of TARGETS[stage]) {
    const element = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (element) {
      element.focus();
      return id;
    }
  }
  return null;
}

export function stageTargets(stage: Stage): readonly string[] {
  return TARGETS[stage];
}
