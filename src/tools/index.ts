import type { AnyDefinedTool } from "../lib/defineTool";
import { confirmBooking } from "./confirmBooking";
import { findProviders } from "./findProviders";
import { getAvailability } from "./getAvailability";
import { getBookingState, registerToolCatalogue } from "./getBookingState";
import { holdSlot } from "./holdSlot";
import { listAccommodations } from "./listAccommodations";
import { selectProvider } from "./selectProvider";
import { setIntake } from "./setIntake";

/**
 * Every tool the site defines, in workflow order. The registry decides which
 * are live; this list never changes at runtime. Tier 1 (PROJECT_SPEC.md §5).
 */
export const TOOLS: readonly AnyDefinedTool[] = [
  getBookingState,
  listAccommodations,
  findProviders,
  selectProvider,
  getAvailability,
  holdSlot,
  setIntake,
  confirmBooking,
];

// get_booking_state reports on every tool including itself, so it needs the
// catalogue — injected here to keep the import graph acyclic.
registerToolCatalogue(TOOLS);

export {
  confirmBooking,
  findProviders,
  getAvailability,
  getBookingState,
  holdSlot,
  listAccommodations,
  selectProvider,
  setIntake,
};
