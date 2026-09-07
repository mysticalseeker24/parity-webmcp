/**
 * Every reason code, with the one sentence a human hears.
 *
 * Spec issue #262 — the agent loses context when a tool disappears, and a
 * screen-reader user loses exactly the same context when a palette row
 * disappears. One table serves both: `get_booking_state.unavailable[]` reads it
 * for the agent, and the announcer reads it for the human. If the wording lived
 * in two places it would drift, and the drift would be invisible until someone
 * relied on it.
 */

export const REASONS = {
  always_live: "This is always available.",
  no_provider: "No provider is selected yet.",
  no_availability: "Availability has not been fetched for this provider yet.",
  no_hold: "No slot is on hold.",
  hold_active: "A slot is on hold; doing this would lose it.",
  hold_expired: "The hold on the slot expired.",
  intake_incomplete: "Patient details are incomplete.",
  already_booked: "The appointment is already booked.",
  slot_taken: "The slot was taken by someone else.",
  no_search: "No search has been run yet.",
  search_had_results: "The last search matched providers, so there is nothing to explain.",
  no_booking: "There is no booking to change.",
  picking_times: "This is set before choosing a time.",
} as const;

export type ReasonCode = keyof typeof REASONS;

export function reasonText(code: ReasonCode): string {
  return REASONS[code];
}

/**
 * What the human hears when a tool leaves the live set. The agent gets the
 * same reason through `unavailable[]`; this is the sentence for the live
 * region (wired up in Phase 7).
 */
export function toolLostSentence(humanLabel: string, code: ReasonCode): string {
  return `${humanLabel} is no longer available: ${lowerFirst(REASONS[code])}`;
}

function lowerFirst(sentence: string): string {
  return sentence.charAt(0).toLowerCase() + sentence.slice(1);
}
