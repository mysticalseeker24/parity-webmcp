import { findProvider, SPECIALTY_LABELS, type Provider } from "../data/providers";
import type { UnavailableReason } from "../lib/defineTool";
import type { BookingState } from "../store";

/**
 * Trimmed provider shape for tool output. The bio is deliberately absent: it is
 * provider-submitted prose and leaves only through a tool marked
 * `untrustedOutput` (CONVENTIONS.md §5).
 */
export function providerSummary(p: Provider) {
  return {
    id: p.id,
    name: p.name,
    specialty: p.specialty,
    languages: p.languages,
    accommodations: p.accommodations,
    distance_km: p.location.distance_km,
    interpreter_lead_days: p.interpreter_lead_time_days,
  };
}

export function specialtyLabel(p: Provider): string {
  return SPECIALTY_LABELS[p.specialty];
}

export function selectedProvider(state: BookingState): Provider | undefined {
  return state.selectedProviderId ? findProvider(state.selectedProviderId) : undefined;
}

/** Always-live tools still need an unavailableReason; theirs is never read. */
export const NEVER_UNAVAILABLE: UnavailableReason = {
  reason_code: "always_live",
  reason: "This tool is always available.",
  unlock_by: "",
};
