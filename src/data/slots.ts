import { PROVIDERS, type Provider } from "./providers";

/**
 * Appointment slots, generated deterministically from a seed over a fixed
 * 14-day window (TOOLS.md §10). Fixed dates rather than "today + n" so the demo
 * can be re-shot on any day and every slot id in the video still exists.
 *
 * Dates and times are plain strings. There is no time zone in this fixture and
 * introducing `Date` arithmetic would only invent one.
 */

export const SCHEDULE_START = "2026-10-05"; // a Monday
export const SCHEDULE_DAYS = 14;
export const SLOT_DURATIONS = [30, 60] as const;
export type SlotDuration = (typeof SLOT_DURATIONS)[number];

export interface Slot {
  readonly id: string;
  readonly provider_id: string;
  /** YYYY-MM-DD */
  readonly date: string;
  /** HH:MM, 24-hour */
  readonly time: string;
  readonly duration_min: SlotDuration;
}

/** mulberry32 — small, seedable, good enough for a fixture. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;

/** Every date in the window, as YYYY-MM-DD, weekends excluded. */
export const SCHEDULE_DATES: readonly string[] = (() => {
  const start = Date.UTC(2026, 9, 5); // must agree with SCHEDULE_START
  const dates: string[] = [];
  for (let i = 0; i < SCHEDULE_DAYS; i++) {
    const d = new Date(start + i * DAY_MS);
    const weekday = d.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
})();

export const SCHEDULE_END = SCHEDULE_DATES[SCHEDULE_DATES.length - 1] ?? SCHEDULE_START;

const HALF_HOURS = (() => {
  const times: string[] = [];
  for (let h = 9; h < 17; h++) {
    times.push(`${String(h).padStart(2, "0")}:00`, `${String(h).padStart(2, "0")}:30`);
  }
  return times;
})();

export function slotId(providerId: string, date: string, time: string): string {
  return `s_${providerId}_${date}_${time.replace(":", "")}`;
}

function generateForProvider(provider: Provider, index: number): Slot[] {
  const rng = seededRandom(1_000_003 * (index + 1));
  const offersExtended = provider.accommodations.includes("extended_appointment");
  const slots: Slot[] = [];

  for (const date of SCHEDULE_DATES) {
    let skipNext = false;
    for (const time of HALF_HOURS) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (rng() >= 0.4) continue; // ~40% of half-hours are open
      const extended = offersExtended && rng() < 0.3;
      const duration: SlotDuration = extended ? 60 : 30;
      if (extended) skipNext = true;
      slots.push({ id: slotId(provider.id, date, time), provider_id: provider.id, date, time, duration_min: duration });
    }
  }
  return slots;
}

export const SLOTS: readonly Slot[] = PROVIDERS.flatMap((p, i) => generateForProvider(p, i));

const SLOT_INDEX = new Map(SLOTS.map((s) => [s.id, s]));

export function findSlot(id: string): Slot | undefined {
  return SLOT_INDEX.get(id);
}

export function slotsForProvider(providerId: string): readonly Slot[] {
  return SLOTS.filter((s) => s.provider_id === providerId);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Tuesday 14 October, 10:30" — for announcements, never for tool output. */
export function slotLabel(slot: Pick<Slot, "date" | "time">): string {
  const [y, m, d] = slot.date.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return `${slot.date}, ${slot.time}`;
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${weekday} ${d} ${MONTHS[m - 1] ?? ""}, ${slot.time}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for a real calendar date in YYYY-MM-DD form. */
export function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  if (y === undefined || mo === undefined || d === undefined) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}
