import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Accommodation } from "./data/accommodations";
import type { Specialty } from "./data/providers";
import type { ToolResult } from "./lib/result";

/**
 * The single store (CONVENTIONS.md §8). The registry subscribes outside the
 * React tree; components subscribe inside. Every tool's `available(state)`
 * predicate is a pure function of this, so the only way a tool becomes
 * callable is a transition recorded here.
 *
 * State machine (PROJECT_SPEC.md §6):
 *   browsing → provider_selected → slot_held → intake_complete → booked
 *
 * Transitions here are pure and synchronous. No timers in this phase — hold
 * expiry arrives in Phase 3, owned by `lib/timers.ts`, never by a component.
 */

export type Stage = "browsing" | "provider_selected" | "slot_held" | "intake_complete" | "booked";
export type Actor = "agent" | "human";

export interface LastSearch {
  readonly specialty: Specialty;
  readonly accommodations: readonly Accommodation[];
  readonly insurance?: string;
  readonly language?: string;
  readonly radius_km?: number;
  readonly result_ids: readonly string[];
  readonly total_matches: number;
  /** How many candidates each constraint removed. Feeds explain_no_results. */
  readonly eliminated_by: Readonly<Record<string, number>>;
}

export interface HeldSlot {
  readonly slotId: string;
  readonly providerId: string;
  readonly expiresAt: number;
}

export interface Intake {
  readonly patient_name?: string;
  readonly dob?: string;
  readonly reason?: string;
  readonly accommodations?: readonly Accommodation[];
}

export const INTAKE_REQUIRED = ["patient_name", "dob", "reason"] as const;
export type IntakeRequiredField = (typeof INTAKE_REQUIRED)[number];

/** Caregiver availability window. Set by Tier 2's set_companion_constraint. */
export interface Companion {
  readonly name?: string;
  readonly available_from?: string;
  readonly available_to?: string;
}

export interface Booking {
  readonly id: string;
  readonly slotId: string;
  readonly providerId: string;
  readonly confirmedAt: number;
  readonly intake: Intake;
}

export interface AuditEntry {
  readonly id: string;
  readonly at: number;
  /** A tool name, or "system" for transitions nobody called (hold expiry). */
  readonly tool: string;
  readonly actor: Actor | "system";
  readonly input: unknown;
  readonly result: ToolResult | { readonly reason_code: string };
}

/**
 * What changed in the live tool set on the last transition, and why each tool
 * left. Written by the registry. Spec issue #262: the agent gets this through
 * `get_booking_state.unavailable[]`, and Phase 5 reads it here to announce the
 * same thing to a screen-reader user — one diff, both surfaces.
 */
export interface ToolChange {
  readonly at: number;
  readonly added: readonly string[];
  readonly removed: readonly {
    readonly tool: string;
    readonly reason_code: string;
    readonly reason: string;
    readonly unlock_by: string;
  }[];
}

export interface BookingState {
  readonly stage: Stage;
  readonly selectedProviderId: string | null;
  readonly lastSearch: LastSearch | null;
  readonly hasFetchedAvailability: boolean;
  readonly heldSlot: HeldSlot | null;
  /** True when the last hold ended by timing out rather than being replaced. */
  readonly holdExpired: boolean;
  readonly intake: Intake;
  readonly booking: Booking | null;
  readonly companion: Companion | null;
  readonly audit: readonly AuditEntry[];
  /** Slots held or booked by someone else. Drives the conflict path. */
  readonly takenSlotIds: readonly string[];
  /** Names of the tools currently registered. Written by the registry only. */
  readonly liveTools: readonly string[];
  readonly lastToolChange: ToolChange | null;
}

export interface BookingActions {
  recordSearch(search: LastSearch): void;
  selectProvider(providerId: string): void;
  markAvailabilityFetched(): void;
  holdSlot(held: HeldSlot): void;
  /** `expired` is set only by the hold timer; every other path is a release. */
  releaseHold(cause?: "expired" | "released"): void;
  setIntake(patch: Intake): void;
  setCompanion(companion: Companion): void;
  confirmBooking(booking: Booking): void;
  markSlotTaken(slotId: string): void;
  appendAudit(entry: AuditEntry): void;
  setLiveTools(names: readonly string[]): void;
  setLastToolChange(change: ToolChange): void;
  reset(): void;
}

export type BookingStore = BookingState & BookingActions;

export const HOLD_TTL_MS = 10 * 60 * 1000;
const AUDIT_CAP = 50;

export function intakeMissing(intake: Intake): IntakeRequiredField[] {
  return INTAKE_REQUIRED.filter((field) => {
    const value = intake[field];
    return typeof value !== "string" || value.trim() === "";
  });
}

export function isIntakeComplete(intake: Intake): boolean {
  return intakeMissing(intake).length === 0;
}

const INITIAL: BookingState = {
  stage: "browsing",
  selectedProviderId: null,
  lastSearch: null,
  hasFetchedAvailability: false,
  heldSlot: null,
  holdExpired: false,
  intake: {},
  booking: null,
  companion: null,
  audit: [],
  takenSlotIds: [],
  liveTools: [],
  lastToolChange: null,
};

let idCounter = 0;
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

/** slot_held or intake_complete, depending on whether intake is done. */
function stageWithHold(intake: Intake): Stage {
  return isIntakeComplete(intake) ? "intake_complete" : "slot_held";
}

export const bookingStore = createStore<BookingStore>()((set, get) => ({
  ...INITIAL,

  recordSearch: (search) => set({ lastSearch: search }),

  selectProvider: (providerId) =>
    set({
      stage: "provider_selected",
      selectedProviderId: providerId,
      hasFetchedAvailability: false,
      heldSlot: null,
      holdExpired: false,
    }),

  markAvailabilityFetched: () => set({ hasFetchedAvailability: true }),

  holdSlot: (held) =>
    set((s) => ({ heldSlot: held, holdExpired: false, stage: stageWithHold(s.intake) })),

  releaseHold: (cause = "released") => {
    if (!get().heldSlot) return;
    set({ heldSlot: null, holdExpired: cause === "expired", stage: "provider_selected" });
  },

  setIntake: (patch) =>
    set((s) => {
      // Drop undefined keys so a partial update never erases a field.
      const merged: Intake = { ...s.intake };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) Object.assign(merged, { [key]: value });
      }
      const stage =
        s.stage === "slot_held" || s.stage === "intake_complete" ? stageWithHold(merged) : s.stage;
      return { intake: merged, stage };
    }),

  setCompanion: (companion) => set({ companion }),

  confirmBooking: (booking) => set({ booking, heldSlot: null, stage: "booked" }),

  markSlotTaken: (slotId) =>
    set((s) =>
      s.takenSlotIds.includes(slotId) ? s : { takenSlotIds: [...s.takenSlotIds, slotId] },
    ),

  appendAudit: (entry) => set((s) => ({ audit: [...s.audit, entry].slice(-AUDIT_CAP) })),

  setLiveTools: (names) => set({ liveTools: [...names] }),

  setLastToolChange: (change) => set({ lastToolChange: change }),

  reset: () => set(INITIAL),
}));

export function useBookingStore<T>(selector: (state: BookingStore) => T): T {
  return useStore(bookingStore, selector);
}
