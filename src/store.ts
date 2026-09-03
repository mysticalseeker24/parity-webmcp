import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import type { Accommodation } from "./data/accommodations";
import type { Specialty } from "./data/providers";

/**
 * The single store (CONVENTIONS.md §8). The registry subscribes to it outside
 * the React tree; components subscribe inside. Every tool's `available(state)`
 * predicate is a pure function of `BookingState` — so the *only* way a tool
 * becomes callable is a transition recorded here.
 *
 * State machine (PROJECT_SPEC.md §6):
 *
 *   browsing → provider_selected → slot_held → intake_complete → booked
 *
 * `stage` is stored, not derived, so a transition is a single explicit line in
 * an action below rather than a computation scattered across predicates.
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

export interface Hold {
  readonly slot_id: string;
  readonly provider_id: string;
  readonly expires_at: number;
}

export interface Intake {
  readonly patient_name?: string;
  readonly dob?: string;
  readonly reason?: string;
  readonly accommodations?: readonly Accommodation[];
}

export const INTAKE_REQUIRED = ["patient_name", "dob", "reason"] as const;
export type IntakeRequiredField = (typeof INTAKE_REQUIRED)[number];

export interface Booking {
  readonly id: string;
  readonly slot_id: string;
  readonly provider_id: string;
  readonly confirmed_at: number;
  readonly intake: Intake;
}

export type GrantStatus = "pending" | "approved" | "denied" | "consumed";

export interface Grant {
  readonly id: string;
  readonly tool: string;
  readonly args_hash: string;
  readonly issued_at: number;
  readonly expires_at: number;
  readonly status: GrantStatus;
}

export interface AuditEntry {
  readonly id: string;
  readonly at: number;
  readonly tool: string;
  readonly actor: Actor;
  readonly input: unknown;
  readonly ok: boolean;
  readonly summary: string;
  readonly reversible: boolean;
}

export interface Announcement {
  readonly id: string;
  readonly at: number;
  readonly text: string;
  readonly actor: Actor | "system";
  readonly politeness: "polite" | "assertive";
}

export interface BookingState {
  readonly stage: Stage;
  readonly lastSearch: LastSearch | null;
  readonly selectedProviderId: string | null;
  readonly hasFetchedAvailability: boolean;
  readonly hold: Hold | null;
  readonly intake: Intake;
  readonly booking: Booking | null;
  /** Slots booked "by someone else" — drives the hold→confirm conflict case. */
  readonly takenSlotIds: readonly string[];
  readonly grants: readonly Grant[];
  readonly audit: readonly AuditEntry[];
  readonly announcements: readonly Announcement[];
  /** Names of the tools currently registered. Written by the registry only. */
  readonly liveTools: readonly string[];
}

export interface BookingActions {
  recordSearch(search: LastSearch): void;
  selectProvider(providerId: string): void;
  markAvailabilityFetched(): void;
  holdSlot(hold: Hold): void;
  /** Release the hold and fall back to provider_selected. Used by expiry too. */
  releaseHold(reason: "expired" | "released" | "conflict"): void;
  setIntake(patch: Intake): void;
  confirmBooking(booking: Booking): void;
  markSlotTaken(slotId: string): void;
  addGrant(grant: Grant): void;
  updateGrant(id: string, status: GrantStatus): void;
  appendAudit(entry: AuditEntry): void;
  announce(announcement: Announcement): void;
  setLiveTools(names: readonly string[]): void;
  reset(): void;
}

export type BookingStore = BookingState & BookingActions;

export const HOLD_TTL_MS = 10 * 60 * 1000;
const AUDIT_CAP = 50;
const ANNOUNCEMENT_CAP = 20;

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
  lastSearch: null,
  selectedProviderId: null,
  hasFetchedAvailability: false,
  hold: null,
  intake: {},
  booking: null,
  takenSlotIds: [],
  grants: [],
  audit: [],
  announcements: [],
  liveTools: [],
};

let nextId = 0;
export function newId(prefix: string): string {
  nextId += 1;
  return `${prefix}_${Date.now().toString(36)}_${nextId}`;
}

// Hold expiry lives here, not in a component, because the hold must expire
// whether or not anything is mounted — the registry has to see it and
// unregister confirm_booking (PROJECT_SPEC.md §10, "hold expires").
let holdTimer: ReturnType<typeof setTimeout> | null = null;

function clearHoldTimer(): void {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

function stageAfterHold(intake: Intake): Stage {
  return isIntakeComplete(intake) ? "intake_complete" : "slot_held";
}

export const bookingStore = createStore<BookingStore>()((set, get) => ({
  ...INITIAL,

  recordSearch: (search) => set({ lastSearch: search }),

  selectProvider: (providerId) => {
    clearHoldTimer();
    set({
      stage: "provider_selected",
      selectedProviderId: providerId,
      hasFetchedAvailability: false,
      hold: null,
    });
  },

  markAvailabilityFetched: () => set({ hasFetchedAvailability: true }),

  holdSlot: (hold) => {
    clearHoldTimer();
    set((s) => ({ hold, stage: stageAfterHold(s.intake) }));
    holdTimer = setTimeout(
      () => {
        holdTimer = null;
        if (get().hold?.slot_id === hold.slot_id) get().releaseHold("expired");
      },
      Math.max(0, hold.expires_at - Date.now()),
    );
  },

  releaseHold: (reason) => {
    clearHoldTimer();
    const { hold } = get();
    if (!hold) return;
    set({ hold: null, stage: "provider_selected" });
    if (reason === "expired") {
      get().announce({
        id: newId("ann"),
        at: Date.now(),
        text: "Your hold on the appointment slot has expired. Hold a slot again to continue.",
        actor: "system",
        politeness: "assertive",
      });
    }
  },

  setIntake: (patch) =>
    set((s) => {
      // Drop undefined keys so a partial update never erases a field.
      const merged: Intake = { ...s.intake };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) Object.assign(merged, { [key]: value });
      }
      const stage =
        s.stage === "slot_held" || s.stage === "intake_complete" ? stageAfterHold(merged) : s.stage;
      return { intake: merged, stage };
    }),

  confirmBooking: (booking) => {
    clearHoldTimer();
    set({ booking, hold: null, stage: "booked" });
  },

  markSlotTaken: (slotId) =>
    set((s) => (s.takenSlotIds.includes(slotId) ? s : { takenSlotIds: [...s.takenSlotIds, slotId] })),

  addGrant: (grant) => set((s) => ({ grants: [...s.grants, grant] })),

  updateGrant: (id, status) =>
    set((s) => ({ grants: s.grants.map((g) => (g.id === id ? { ...g, status } : g)) })),

  appendAudit: (entry) => set((s) => ({ audit: [...s.audit, entry].slice(-AUDIT_CAP) })),

  announce: (announcement) =>
    set((s) => ({ announcements: [...s.announcements, announcement].slice(-ANNOUNCEMENT_CAP) })),

  setLiveTools: (names) => set({ liveTools: [...names] }),

  reset: () => {
    clearHoldTimer();
    set(INITIAL);
  },
}));

export function useBookingStore<T>(selector: (state: BookingStore) => T): T {
  return useStore(bookingStore, selector);
}
