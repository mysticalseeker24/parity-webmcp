import type { AnyDefinedTool } from "../lib/defineTool";
import { cancelBooking } from "./cancelBooking";
import { checkCoverage } from "./checkCoverage";
import { confirmBooking } from "./confirmBooking";
import { explainNoResults } from "./explainNoResults";
import { findProviders } from "./findProviders";
import { getAvailability } from "./getAvailability";
import { getBookingState, registerToolCatalogue } from "./getBookingState";
import { holdSlot } from "./holdSlot";
import { listAccommodations } from "./listAccommodations";
import { releaseSlot } from "./releaseSlot";
import { selectProvider } from "./selectProvider";
import { setCompanionConstraint } from "./setCompanionConstraint";
import { setIntake } from "./setIntake";

/**
 * Every tool the site defines, in workflow order. The registry decides which
 * are live; this list never changes at runtime.
 *
 * Tier 1 (PROJECT_SPEC.md §5) is the first eight. Tier 2 adds five more, and
 * each is scoped so the live set never exceeds seven in any stage — the
 * registry asserts that in dev, so a careless predicate fails the test run
 * rather than degrading the agent's choices silently.
 */
export const TOOLS: readonly AnyDefinedTool[] = [
  // Tier 1
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
];

// get_booking_state reports on every tool including itself, so it needs the
// catalogue — injected here to keep the import graph acyclic.
registerToolCatalogue(TOOLS);

export {
  cancelBooking,
  checkCoverage,
  confirmBooking,
  explainNoResults,
  findProviders,
  getAvailability,
  getBookingState,
  holdSlot,
  listAccommodations,
  releaseSlot,
  selectProvider,
  setCompanionConstraint,
  setIntake,
};
