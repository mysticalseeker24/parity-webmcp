import { accommodationLabel, type Accommodation } from "../data/accommodations";
import { findProvider, SPECIALTY_LABELS, type Provider } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import type { BookingState } from "../store";

/** Trimmed provider shape for tool output. The bio is deliberately absent: it
 *  is provider-submitted prose and only leaves through a tool marked
 *  untrustedContentHint (CONVENTIONS.md §5). */
export function providerSummary(p: Provider) {
  return {
    id: p.id,
    name: p.name,
    specialty: p.specialty,
    languages: p.languages,
    accommodations: p.accommodations,
    distance_km: p.location.distance_km,
    interpreter_lead_time_days: p.interpreter_lead_time_days,
  };
}

export function specialtyLabel(p: Provider): string {
  return SPECIALTY_LABELS[p.specialty];
}

export function listLabels(ids: readonly Accommodation[]): string {
  return ids.map(accommodationLabel).join(", ");
}

/** One sentence telling the agent what to do next. Returned by most tools so
 *  a result is never a dead end. */
export function nextStep(state: BookingState): string {
  switch (state.stage) {
    case "browsing":
      return "Call find_providers with a specialty and any accommodations the patient needs.";
    case "provider_selected":
      return state.hasFetchedAvailability
        ? "Call hold_slot with a slot_id from get_availability."
        : "Call get_availability to see open slots for the selected provider.";
    case "slot_held":
      return "Call set_intake with patient_name, dob (YYYY-MM-DD) and reason.";
    case "intake_complete":
      return "Call confirm_booking with the held slot_id. The patient must approve on the page before it commits.";
    case "booked":
      return "The booking is confirmed. Nothing further is required.";
  }
}

export function selectedProvider(state: BookingState): Provider | undefined {
  return state.selectedProviderId ? findProvider(state.selectedProviderId) : undefined;
}

export function heldSlotLabel(state: BookingState): string | null {
  const slot = state.hold ? findSlot(state.hold.slot_id) : undefined;
  return slot ? slotLabel(slot) : null;
}
