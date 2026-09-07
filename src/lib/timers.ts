import { bookingStore, newId, type BookingStore } from "../store";
import type { StoreApi } from "zustand/vanilla";

/**
 * Hold expiry, owned here rather than by a component (CONVENTIONS.md §8).
 *
 * The hold has to expire whether or not anything is mounted: the registry must
 * see the transition and unregister `confirm_booking`, and a leaked timer would
 * unregister a tool in the middle of the demo video. A component-owned timer
 * would also die on unmount, leaving a hold that never expires.
 *
 * Exactly one timer exists at a time. Every path that releases a hold clears
 * it, so it cannot fire against a hold that is already gone.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let timerSlotId: string | null = null;

export function clearHoldTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
    timerSlotId = null;
  }
}

/** The slot the live timer is armed for, or null. Used by tests and by P5. */
export function armedFor(): string | null {
  return timerSlotId;
}

/**
 * Arm the expiry timer for the current hold. Replaces any existing timer, so
 * holding a second slot never leaves the first one's timer running.
 */
export function startHoldTimer(
  slotId: string,
  expiresAt: number,
  store: StoreApi<BookingStore> = bookingStore,
): void {
  clearHoldTimer();
  timerSlotId = slotId;
  timer = setTimeout(
    () => {
      timer = null;
      timerSlotId = null;
      const state = store.getState();
      // Re-check: the hold may have been released or replaced while we waited.
      if (state.heldSlot?.slotId !== slotId) return;
      // "expired", not the default "released": confirm_booking's unavailable
      // reason distinguishes the two, and only one of them means "try again".
      state.releaseHold("expired");
      // Nobody called a tool, so the audit needs an entry that says so —
      // otherwise the trail shows confirm_booking vanishing for no reason.
      state.appendAudit({
        id: newId("audit"),
        at: Date.now(),
        tool: "system",
        actor: "system",
        input: { slot_id: slotId },
        result: { reason_code: "hold_expired" },
      });
    },
    Math.max(0, expiresAt - Date.now()),
  );
}
