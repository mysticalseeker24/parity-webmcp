import { bookingStore, newId, type BookingStore, type Intake } from "../store";
import { clearHoldTimer, startHoldTimer } from "./timers";
import type { StoreApi } from "zustand/vanilla";

/**
 * The undo stack.
 *
 * Only tools marked `reversible` push an entry: `select_provider`, `hold_slot`
 * and `set_intake`. **Gated tools are never undoable** — `confirm_booking`
 * commits a real appointment, and an undo that silently reversed it would be a
 * second commit path around the grant gate, which is exactly what
 * PROJECT_SPEC.md §7 forbids. Cancelling a booking is `cancel_booking`, a
 * separate gated tool, not an undo.
 *
 * An inverse is captured as a snapshot of the fields the tool touched, taken
 * *before* it ran. Replaying a snapshot is safer than trying to compute an
 * inverse operation: `set_intake` merges, so its true inverse is "the intake as
 * it was", not "unset these keys".
 */

export interface UndoEntry {
  readonly id: string;
  readonly tool: string;
  /** What the user sees on the button and hears announced. */
  readonly label: string;
  readonly at: number;
  readonly apply: (store: StoreApi<BookingStore>) => void;
}

const stack: UndoEntry[] = [];
const listeners = new Set<() => void>();
const MAX_UNDO = 20;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function peekUndo(): UndoEntry | undefined {
  return stack[stack.length - 1];
}

export function undoDepth(): number {
  return stack.length;
}

export function clearUndo(): void {
  stack.length = 0;
  emit();
}

function push(entry: UndoEntry): void {
  stack.push(entry);
  if (stack.length > MAX_UNDO) stack.shift();
  emit();
}

/** Tools whose effects can be reversed by restoring a snapshot. */
const REVERSIBLE = new Set(["select_provider", "hold_slot", "set_intake"]);

export function isReversible(tool: string): boolean {
  return REVERSIBLE.has(tool);
}

/**
 * Capture the inverse of `tool` *before* it runs. Returns a commit function to
 * call only if the tool actually succeeded — a refusal changed nothing, so
 * pushing an undo for it would make the button lie.
 */
export function captureInverse(
  tool: string,
  store: StoreApi<BookingStore> = bookingStore,
): (() => void) | null {
  if (!REVERSIBLE.has(tool)) return null;

  const before = store.getState();
  const snapshot = {
    stage: before.stage,
    selectedProviderId: before.selectedProviderId,
    hasFetchedAvailability: before.hasFetchedAvailability,
    heldSlot: before.heldSlot,
    holdExpired: before.holdExpired,
    intake: before.intake as Intake,
  };

  return () => {
    const after = store.getState();
    // Nothing observable changed (an idempotent re-hold, say). Don't offer to
    // undo something the user cannot perceive having happened.
    if (
      after.stage === snapshot.stage &&
      after.selectedProviderId === snapshot.selectedProviderId &&
      after.heldSlot?.slotId === snapshot.heldSlot?.slotId &&
      after.intake === snapshot.intake
    ) {
      return;
    }

    push({
      id: newId("undo"),
      tool,
      label: labelFor(tool),
      at: Date.now(),
      apply: (target) => {
        // Restoring a hold means restoring its timer too, or the hold would
        // sit there forever with nothing to expire it.
        clearHoldTimer();
        target.setState({
          stage: snapshot.stage,
          selectedProviderId: snapshot.selectedProviderId,
          hasFetchedAvailability: snapshot.hasFetchedAvailability,
          heldSlot: snapshot.heldSlot,
          holdExpired: snapshot.holdExpired,
          intake: snapshot.intake,
        });
        if (snapshot.heldSlot) {
          startHoldTimer(snapshot.heldSlot.slotId, snapshot.heldSlot.expiresAt, target);
        }
      },
    });
  };
}

function labelFor(tool: string): string {
  switch (tool) {
    case "select_provider":
      return "Undo choosing a provider";
    case "hold_slot":
      return "Undo holding the slot";
    case "set_intake":
      return "Undo the patient details change";
    default:
      return `Undo ${tool}`;
  }
}

/**
 * Pop and apply. The undo is itself audited and announced, so a screen-reader
 * user is told the page changed — the same rule that applies to agent actions.
 */
export function performUndo(
  store: StoreApi<BookingStore> = bookingStore,
): { ok: true; label: string } | { ok: false } {
  const entry = stack.pop();
  if (!entry) return { ok: false };
  emit();

  entry.apply(store);

  store.getState().appendAudit({
    id: newId("audit"),
    at: Date.now(),
    tool: "undo",
    actor: "human",
    input: { tool: entry.tool },
    result: { ok: true, data: { undone: entry.tool }, human_summary: entry.label },
  });

  return { ok: true, label: entry.label };
}
