import type { AnyDefinedTool } from "../lib/defineTool";
import { cancelBooking } from "./cancelBooking";
import { checkCoverage } from "./checkCoverage";
import { confirmBooking } from "./confirmBooking";
import { explainCapability, registerCapabilityCatalogue } from "./explainCapability";
import { explainNoResults } from "./explainNoResults";
import { exportSummary } from "./exportSummary";
import { findProviders } from "./findProviders";
import { getAvailability } from "./getAvailability";
import { getBookingState, registerToolCatalogue } from "./getBookingState";
import { getProviderDetail } from "./getProviderDetail";
import { holdSlot } from "./holdSlot";
import { listAccommodations } from "./listAccommodations";
import { releaseSlot } from "./releaseSlot";
import { rescheduleBooking } from "./rescheduleBooking";
import { selectProvider } from "./selectProvider";
import { setCompanionConstraint } from "./setCompanionConstraint";
import { setIntake } from "./setIntake";
import { setTransportConstraint } from "./setTransportConstraint";
import { watchEarlierSlot } from "./watchEarlierSlot";

/**
 * Every tool the site defines, in workflow order. The registry decides which
 * are live; this list never changes at runtime.
 *
 * Nineteen defined, never more than seven registered (PROJECT_SPEC.md §5). Each
 * `available` predicate is scoped so no stage exceeds that cap — the registry
 * throws in dev if one ever does, so a careless predicate fails the test run
 * rather than quietly degrading the agent's choices.
 */
export const TOOLS: readonly AnyDefinedTool[] = [
  // Tier 1 — the minimum viable submission
  getBookingState,
  listAccommodations,
  findProviders,
  selectProvider,
  getAvailability,
  holdSlot,
  setIntake,
  confirmBooking,
  // Tier 2
  explainNoResults,
  checkCoverage,
  setCompanionConstraint,
  releaseSlot,
  cancelBooking,
  // Tier 3
  getProviderDetail,
  explainCapability,
  exportSummary,
  setTransportConstraint,
  watchEarlierSlot,
  rescheduleBooking,
];

// get_booking_state and explain_capability both report on the whole catalogue,
// so it is injected here rather than imported — that keeps the graph acyclic.
registerToolCatalogue(TOOLS);
registerCapabilityCatalogue(TOOLS);

export {
  cancelBooking,
  checkCoverage,
  confirmBooking,
  explainCapability,
  explainNoResults,
  exportSummary,
  findProviders,
  getAvailability,
  getBookingState,
  getProviderDetail,
  holdSlot,
  listAccommodations,
  releaseSlot,
  rescheduleBooking,
  selectProvider,
  setCompanionConstraint,
  setIntake,
  setTransportConstraint,
  watchEarlierSlot,
};
