import { bookingStore, newId, type BookingStore } from "../store";
import type { StoreApi } from "zustand/vanilla";

/**
 * ─── Timer hygiene audit (CONVENTIONS.md §8: "timers are cleaned up") ────────
 *
 * Every `setTimeout` / `setInterval` in `src/`, and what clears it. A leaked
 * timer here does not merely waste a tick — it unregisters a tool underneath
 * the user, which in a demo looks exactly like WebMCP being broken.
 *
 * | # | Where | What | Cleared by |
 * |---|---|---|---|
 * | 1 | `lib/timers.ts` (this file) | hold expiry, 10 min | `clearHoldTimer()` from `startHoldTimer` (replace), `confirm_booking` (commit and conflict), `undo.performUndo` (restore), and itself on fire |
 * | 2 | `lib/grants.ts` `mint()` | grant expiry, 120 s | `clearGrantTimer()` via `deny`/`revoke`/`consume`/`resetGrants`, and itself on fire |
 * | 3 | `components/BookingSummary.tsx` | 1 s countdown tick | `clearInterval` in the effect's cleanup; re-armed only while a hold exists |
 * | 4 | `components/GrantCard.tsx` | 200 ms countdown tick | `clearInterval` in the effect's cleanup; effect is keyed on the grant, so it stops when the card closes |
 * | 5 | `components/LiveRegion.tsx` | `requestAnimationFrame`, not a timer | fires once on the next frame; nothing to clear |
 *
 * Enforced rather than trusted: every timer test asserts `vi.getTimerCount()`
 * is 0 on teardown, so a leak fails the suite rather than the demo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
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
