import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCHEDULE_DATES, slotLabel, slotsForProvider, type Slot } from "../data/slots";
import { executeAsHuman } from "../lib/registry";
import { isRefusal } from "../lib/result";
import { useBookingStore } from "../store";

/**
 * The availability grid.
 *
 * Chrome's own WebMCP docs name `date_pick` as the canonical control an agent
 * cannot understand; calendar grids are simultaneously among the most notorious
 * keyboard-accessibility failures on the web. That overlap is the entire
 * product argument, so this control has to be exemplary rather than adequate.
 *
 * What that means concretely:
 *  - a real `<table>` with `<caption>`, `<th scope="col">` dates and
 *    `<th scope="row">` times, so the relationship is in the markup
 *  - one tab stop for the whole grid (roving tabindex), so a keyboard user is
 *    not trapped tabbing through 160 cells
 *  - arrows move, Home/End jump within the row, PageUp/PageDown to the column
 *    ends, Enter or Space holds, Escape leaves the grid
 *  - the focused cell is announced, because a visual ring says nothing aloud
 *  - the held slot is marked in text, never by colour alone
 */

const TIMES: readonly string[] = (() => {
  const times: string[] = [];
  for (let h = 9; h < 17; h++) {
    times.push(`${String(h).padStart(2, "0")}:00`, `${String(h).padStart(2, "0")}:30`);
  }
  return times;
})();

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const weekday = WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${weekday} ${d}/${m}`;
}

function longDate(date: string): string {
  return slotLabel({ date, time: "00:00" }).replace(", 00:00", "");
}

interface Cursor {
  row: number;
  col: number;
}

export function Calendar() {
  const providerId = useBookingStore((s) => s.selectedProviderId);
  const heldSlot = useBookingStore((s) => s.heldSlot);
  const takenSlotIds = useBookingStore((s) => s.takenSlotIds);
  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: 0 });
  const [message, setMessage] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const gridRef = useRef<HTMLTableElement>(null);
  const shouldFocus = useRef(false);
  const fetchedFor = useRef<string | null>(null);

  /** times × dates → the slot in that cell, or null. */
  const matrix = useMemo(() => {
    const byKey = new Map<string, Slot>();
    if (providerId) {
      for (const slot of slotsForProvider(providerId)) byKey.set(`${slot.time}|${slot.date}`, slot);
    }
    return TIMES.map((time) => SCHEDULE_DATES.map((date) => byKey.get(`${time}|${date}`) ?? null));
  }, [providerId]);

  const isHoldable = useCallback(
    (row: number, col: number) => {
      const slot = matrix[row]?.[col];
      return slot !== null && slot !== undefined && !takenSlotIds.includes(slot.id);
    },
    [matrix, takenSlotIds],
  );

  /**
   * Rendering the grid *is* fetching availability, so it goes through the
   * `get_availability` tool rather than reading the fixture behind the tool's
   * back. Two reasons: `hold_slot` only registers once availability has been
   * fetched, so skipping this would leave every cell unclickable; and the human
   * looking at the grid belongs in the audit trail exactly as the agent's call
   * does. Same tool, same path, one entry per provider.
   */
  useEffect(() => {
    if (!providerId || fetchedFor.current === providerId) return;
    fetchedFor.current = providerId;
    void executeAsHuman("get_availability", {});
  }, [providerId]);

  /** Park the cursor on a real slot so the first Tab lands somewhere useful. */
  useEffect(() => {
    if (isHoldable(cursor.row, cursor.col)) return;
    for (let row = 0; row < TIMES.length; row++) {
      for (let col = 0; col < SCHEDULE_DATES.length; col++) {
        if (isHoldable(row, col)) {
          setCursor({ row, col });
          return;
        }
      }
    }
  }, [isHoldable, cursor.row, cursor.col]);

  // Move focus only after a key press, never on an unrelated re-render — that
  // would steal focus from whatever the user was actually using.
  useEffect(() => {
    if (!shouldFocus.current) return;
    shouldFocus.current = false;
    const cell = gridRef.current?.querySelector<HTMLButtonElement>('[data-cursor="true"]');
    cell?.focus();
  });

  function announce(row: number, col: number) {
    const slot = matrix[row]?.[col];
    const date = SCHEDULE_DATES[col];
    if (!date) return;
    if (!slot) {
      setMessage(`${longDate(date)}, ${TIMES[row]}. No slot.`);
      return;
    }
    const held = heldSlot?.slotId === slot.id;
    const taken = takenSlotIds.includes(slot.id);
    setMessage(
      `${slotLabel(slot)}, ${slot.duration_min} minutes. ${
        held ? "Currently held by you." : taken ? "Taken." : "Available."
      }`,
    );
  }

  /** Step through the grid, skipping cells that cannot be held. */
  function step(from: Cursor, dRow: number, dCol: number): Cursor {
    let { row, col } = from;
    for (let guard = 0; guard < TIMES.length * SCHEDULE_DATES.length; guard++) {
      row += dRow;
      col += dCol;
      if (row < 0 || row >= TIMES.length || col < 0 || col >= SCHEDULE_DATES.length) return from;
      if (isHoldable(row, col)) return { row, col };
    }
    return from;
  }

  function edge(from: Cursor, dRow: number, dCol: number): Cursor {
    let current = from;
    for (;;) {
      const next = step(current, dRow, dCol);
      if (next.row === current.row && next.col === current.col) return current;
      current = next;
    }
  }

  function moveTo(next: Cursor) {
    setCursor(next);
    shouldFocus.current = true;
    announce(next.row, next.col);
  }

  async function hold(slot: Slot) {
    setRefusal(null);
    const result = await executeAsHuman("hold_slot", { slot_id: slot.id });
    if (isRefusal(result)) {
      setRefusal(result.reason);
      setMessage(`Could not hold ${slotLabel(slot)}. ${result.reason}`);
    } else {
      setMessage(result.human_summary);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTableElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = moves[event.key];
    if (delta) {
      event.preventDefault();
      moveTo(step(cursor, delta[0], delta[1]));
      return;
    }
    switch (event.key) {
      case "Home":
        event.preventDefault();
        moveTo(edge(cursor, 0, -1));
        return;
      case "End":
        event.preventDefault();
        moveTo(edge(cursor, 0, 1));
        return;
      case "PageUp":
        event.preventDefault();
        moveTo(edge(cursor, -1, 0));
        return;
      case "PageDown":
        event.preventDefault();
        moveTo(edge(cursor, 1, 0));
        return;
      case "Escape": {
        // Leave the grid rather than trapping the user inside it.
        event.preventDefault();
        const heading = document.getElementById("calendar-heading");
        heading?.focus();
        setMessage("Left the availability grid.");
        return;
      }
      default:
    }
  }

  if (!providerId) {
    return <p className="text-slate-600">Select a provider to see their availability.</p>;
  }

  const anySlots = matrix.some((row) => row.some((slot) => slot !== null));
  if (!anySlots) {
    return <p className="text-slate-600">This provider has no open slots in the booking window.</p>;
  }

  return (
    <div>
      <p className="mb-2 text-sm text-slate-700">
        Arrow keys move between open slots, Home and End jump along the row, Page Up and Page Down
        along the column, Enter holds, Escape leaves the grid.
      </p>

      {refusal && (
        <p className="mb-2 flex gap-2 text-sm font-medium text-red-800">
          <span aria-hidden="true">✕</span>
          <span>{refusal}</span>
        </p>
      )}

      <div className="overflow-x-auto">
        <table
          ref={gridRef}
          onKeyDown={onKeyDown}
          className="border-collapse text-sm"
        >
          <caption className="sr-only">
            Appointment availability. Rows are times, columns are dates. Open slots are buttons.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-1 text-left font-semibold text-slate-700">
                Time
              </th>
              {SCHEDULE_DATES.map((date) => (
                <th
                  key={date}
                  scope="col"
                  className="whitespace-nowrap p-1 font-semibold text-slate-700"
                >
                  {shortDate(date)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIMES.map((time, row) => (
              <tr key={time}>
                <th scope="row" className="p-1 text-left font-normal text-slate-700">
                  {time}
                </th>
                {SCHEDULE_DATES.map((date, col) => {
                  const slot = matrix[row]?.[col] ?? null;
                  const held = slot !== null && heldSlot?.slotId === slot.id;
                  const taken = slot !== null && takenSlotIds.includes(slot.id);
                  const isCursor = cursor.row === row && cursor.col === col;

                  if (!slot || taken) {
                    return (
                      // slate-500, not slate-400: the marker is decorative but
                      // still read by sighted users, and 400 on white is ~2.6:1.
                      <td key={date} className="border border-slate-300 p-1 text-center text-slate-500">
                        <span aria-hidden="true">{taken ? "×" : "·"}</span>
                        <span className="sr-only">{taken ? "Taken" : "No slot"}</span>
                      </td>
                    );
                  }

                  return (
                    <td key={date} className="border border-slate-200 p-0">
                      <button
                        type="button"
                        data-cursor={isCursor ? "true" : undefined}
                        tabIndex={isCursor ? 0 : -1}
                        aria-pressed={held}
                        onClick={() => {
                          setCursor({ row, col });
                          void hold(slot);
                        }}
                        onFocus={() => setCursor({ row, col })}
                        className={`w-full px-2 py-1 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-slate-900 ${
                          held
                            ? "bg-emerald-700 font-semibold text-white"
                            : "bg-white text-slate-900 hover:bg-slate-200"
                        }`}
                      >
                        {/* Held state is text, not just the green fill. */}
                        <span aria-hidden="true">{held ? "Held" : slot.duration_min}</span>
                        <span className="sr-only">
                          {held ? "Held. " : ""}
                          {slotLabel(slot)}, {slot.duration_min} minutes.{" "}
                          {held ? "Press Enter to keep the hold." : "Press Enter to hold."}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The focused cell, spoken. A focus ring alone tells a screen-reader
          user nothing about which date and time they have landed on. */}
      <p role="status" aria-live="polite" className="mt-2 text-sm text-slate-700">
        {message}
      </p>
    </div>
  );
}
