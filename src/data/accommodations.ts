import * as z from "zod";

/**
 * The accommodation vocabulary. Exported exactly once and consumed by
 * `list_accommodations`, `find_providers`, `select_provider` and `set_intake`
 * (TOOLS.md §10). One vocabulary, every consumer — an agent that reads it from
 * `list_accommodations` cannot then invent a value `find_providers` rejects.
 */
export const ACCOMMODATION = z.enum([
  "wheelchair_accessible",
  "step_free_entrance",
  "accessible_restroom",
  "hoist_available",
  "asl_interpreter",
  "spoken_language_interpreter",
  "low_sensory_waiting",
  "extended_appointment",
  "service_animal_welcome",
  "caregiver_may_attend",
  "paratransit_drop_off",
]);

export type Accommodation = z.infer<typeof ACCOMMODATION>;

/** Short labels for announcements and the palette. Kept terse: they are also
 *  serialized into `list_accommodations` output, which has a 1.5K budget. */
export const ACCOMMODATION_LABELS: Record<Accommodation, { label: string; description: string }> = {
  wheelchair_accessible: {
    label: "Wheelchair accessible",
    description: "Exam room and route from entrance fit a wheelchair.",
  },
  step_free_entrance: {
    label: "Step-free entrance",
    description: "No steps between street and reception.",
  },
  accessible_restroom: {
    label: "Accessible restroom",
    description: "Restroom with grab bars and turning space.",
  },
  hoist_available: {
    label: "Hoist available",
    description: "Patient hoist for exam-table transfers.",
  },
  asl_interpreter: {
    label: "ASL interpreter",
    description: "Sign-language interpreter can be booked.",
  },
  spoken_language_interpreter: {
    label: "Spoken-language interpreter",
    description: "Interpreter for languages the provider does not speak.",
  },
  low_sensory_waiting: {
    label: "Low-sensory waiting area",
    description: "Quiet, dimmed waiting space on request.",
  },
  extended_appointment: {
    label: "Extended appointment",
    description: "60-minute slots offered.",
  },
  service_animal_welcome: {
    label: "Service animal welcome",
    description: "Service animals admitted throughout.",
  },
  caregiver_may_attend: {
    label: "Caregiver may attend",
    description: "A companion may stay for the whole visit.",
  },
  paratransit_drop_off: {
    label: "Paratransit drop-off",
    description: "Marked drop-off point at the entrance.",
  },
};

export function accommodationLabel(id: Accommodation): string {
  return ACCOMMODATION_LABELS[id].label;
}
