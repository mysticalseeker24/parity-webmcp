import * as z from "zod";

/**
 * The accommodation vocabulary. Exported exactly once and consumed by
 * `list_accommodations`, `find_providers` and `set_intake`.
 *
 * Spec issue #239 (grammar-level injection mitigation): a `z.enum` becomes a
 * JSON Schema `enum`, which *structurally* constrains what the agent can send.
 * That is stronger than a sentence in a description asking it to behave, and it
 * gives the palette a `<select>` for free.
 */
export const ACCOMMODATION = z.enum([
  "wheelchair_accessible",
  "step_free_entrance",
  "asl_interpreter",
  "extended_appointment",
  "low_sensory",
  "ground_floor",
  "companion_seating",
  "guide_dog_welcome",
  "hoist_transfer",
  "large_print_forms",
]);

export type Accommodation = z.infer<typeof ACCOMMODATION>;

/**
 * Labels double as the palette's form labels and the announcer's wording, so
 * they are written to read as a label rather than as a hint to a model
 * (spec issue #286 — one source, so the accessible name and the parameter
 * description cannot disagree).
 */
export const ACCOMMODATION_LABELS: Record<Accommodation, string> = {
  wheelchair_accessible: "Wheelchair accessible",
  step_free_entrance: "Step-free entrance",
  asl_interpreter: "ASL interpreter",
  extended_appointment: "Extended appointment",
  low_sensory: "Low-sensory environment",
  ground_floor: "Ground floor",
  companion_seating: "Companion seating",
  guide_dog_welcome: "Guide dog welcome",
  hoist_transfer: "Hoist transfer",
  large_print_forms: "Large-print forms",
};

/**
 * Decorative glyphs. Always rendered `aria-hidden` beside the label, never
 * alone — an icon with no text is unreadable to a screen reader and ambiguous
 * to everyone else (CONVENTIONS.md §6, "never rely on colour alone" applies to
 * icons for the same reason).
 */
export const ACCOMMODATION_ICONS: Record<Accommodation, string> = {
  wheelchair_accessible: "♿",
  step_free_entrance: "⇔",
  asl_interpreter: "🤟",
  extended_appointment: "⏱",
  low_sensory: "🔉",
  ground_floor: "▤",
  companion_seating: "👥",
  guide_dog_welcome: "🦮",
  hoist_transfer: "⇧",
  large_print_forms: "🔎",
};

export function accommodationLabel(id: Accommodation): string {
  return ACCOMMODATION_LABELS[id];
}

export function accommodationLabels(ids: readonly Accommodation[]): string {
  return ids.map(accommodationLabel).join(", ");
}
