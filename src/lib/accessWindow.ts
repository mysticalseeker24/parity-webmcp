import type { Companion, Transport } from "../store";

/** Just the shape the windows are checked against, so callers are not forced
 *  into `Slot`'s literal duration union to ask the question. */
interface Timed {
  readonly time: string;
  readonly duration_min: number;
}

/**
 * Whether an appointment fits the access constraints currently set.
 *
 * One predicate, two callers: `get_availability` filters with it, and the
 * calendar grid greys cells with it. They used to disagree — the tool filtered
 * on the companion and paratransit windows while the grid built itself
 * straight from the fixture, so an agent asking for availability got twelve
 * slots and the person looking at the same screen saw sixty-four. Two answers
 * to one question, which is the duplication this project exists to argue
 * against.
 *
 * Both windows are checked against the *whole* appointment, not its start: a
 * slot you can reach but cannot leave is not a slot.
 */
export function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function fitsAccessWindows(
  slot: Timed,
  companion: Companion | null,
  transport: Transport | null,
): boolean {
  const end = addMinutes(slot.time, slot.duration_min);
  if (companion?.available_from && companion.available_to) {
    if (slot.time < companion.available_from || end > companion.available_to) return false;
  }
  if (transport) {
    if (slot.time < transport.earliest_pickup || end > transport.latest_return) return false;
  }
  return true;
}

/**
 * Why a slot is outside the windows, for the cell's accessible name. Returns
 * null when it fits — the caller says nothing in that case.
 */
export function accessWindowReason(
  slot: Timed,
  companion: Companion | null,
  transport: Transport | null,
): string | null {
  const end = addMinutes(slot.time, slot.duration_min);
  if (companion?.available_from && companion.available_to) {
    if (slot.time < companion.available_from || end > companion.available_to) {
      const who = companion.name ?? "your companion";
      return `outside ${who}'s window of ${companion.available_from} to ${companion.available_to}`;
    }
  }
  if (transport) {
    if (slot.time < transport.earliest_pickup || end > transport.latest_return) {
      return `outside your transport window of ${transport.earliest_pickup} to ${transport.latest_return}`;
    }
  }
  return null;
}
