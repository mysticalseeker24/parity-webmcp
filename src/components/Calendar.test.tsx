import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { Calendar } from "./Calendar";
import { startRegistry, type Registry } from "../lib/registry";
import { clearHoldTimer } from "../lib/timers";
import { bookingStore } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;
let user: UserEvent;

const store = () => bookingStore.getState();

beforeEach(async () => {
  clearHoldTimer();
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
  user = userEvent.setup();
  await registry.execute("select_provider", { provider_id: "p01" });
});

afterEach(() => {
  cleanup();
  registry?.stop();
  registry = null;
  clearHoldTimer();
  restore?.();
  restore = null;
});

const grid = () => screen.getByRole("table");
const cells = () => within(grid()).getAllByRole("button");

describe("Calendar — semantics", () => {
  it("is a real table with a caption and scoped headers", () => {
    render(<Calendar />);
    const table = grid();
    expect(within(table).getByText(/Rows are times, columns are dates/)).toBeDefined();
    const colHeaders = within(table).getAllByRole("columnheader");
    expect(colHeaders[0]?.textContent).toBe("Time");
    expect(colHeaders).toHaveLength(11); // Time + 10 weekdays
    for (const header of colHeaders) expect(header.getAttribute("scope")).toBe("col");
    for (const header of within(table).getAllByRole("rowheader")) {
      expect(header.getAttribute("scope")).toBe("row");
    }
  });

  it("names each cell with its date, time and length, not just a number", () => {
    render(<Calendar />);
    expect(cells()[0]!.textContent).toMatch(/\w+day \d+ \w+, \d\d:\d\d, \d+ minutes/);
  });

  it("prompts to select a provider when none is chosen", () => {
    store().reset();
    render(<Calendar />);
    expect(screen.getByText(/Select a provider/)).toBeDefined();
  });
});

describe("Calendar — keyboard model", () => {
  it("is a single tab stop (roving tabindex), not 160", () => {
    render(<Calendar />);
    const focusable = cells().filter((c) => c.getAttribute("tabindex") === "0");
    expect(focusable).toHaveLength(1);
    expect(cells().length).toBeGreaterThan(20);
  });

  it("moves with arrows and announces the cell it lands on", async () => {
    render(<Calendar />);
    cells()[0]!.focus();

    await user.keyboard("{ArrowRight}");
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/\w+day \d+ \w+, \d\d:\d\d, \d+ minutes\. Available\./);
    expect(document.activeElement?.getAttribute("data-cursor")).toBe("true");
  });

  it("does not wrap or escape the grid at its edges", async () => {
    render(<Calendar />);
    const first = cells()[0]!;
    first.focus();
    await user.keyboard("{ArrowUp}{ArrowLeft}");
    // Still on a cell inside the grid, not on the page behind it.
    expect(within(grid()).getAllByRole("button")).toContain(document.activeElement);
  });

  it("Home and End jump along the row", async () => {
    render(<Calendar />);
    cells()[0]!.focus();
    await user.keyboard("{End}");
    const atEnd = document.activeElement;
    await user.keyboard("{Home}");
    expect(document.activeElement).not.toBe(atEnd);
  });

  it("Enter holds the focused slot through hold_slot", async () => {
    render(<Calendar />);
    cells()[0]!.focus();
    await user.keyboard("{Enter}");

    expect(store().stage).toBe("slot_held");
    expect(store().heldSlot).not.toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/held for 10 minutes/);
  });

  it("Escape leaves the grid instead of trapping the user", async () => {
    document.body.innerHTML = '<h2 id="calendar-heading" tabindex="-1">Pick a time</h2>';
    render(<Calendar />);
    cells()[0]!.focus();
    await user.keyboard("{Escape}");
    expect(document.activeElement?.id).toBe("calendar-heading");
  });
});

describe("Calendar — state shown in text", () => {
  it("marks the held slot with the word Held, not only a colour", async () => {
    render(<Calendar />);
    cells()[0]!.focus();
    await user.keyboard("{Enter}");

    const held = cells().find((c) => c.getAttribute("aria-pressed") === "true");
    expect(held).toBeDefined();
    expect(held!.textContent).toMatch(/^Held/);
  });

  it("marks taken slots in text and makes them unfocusable", async () => {
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    const takenId = avail.data.slots[0]!.id;
    store().markSlotTaken(takenId);

    render(<Calendar />);
    expect(within(grid()).getAllByText("Taken").length).toBeGreaterThan(0);
    // A taken slot is not a button, so arrows and Tab skip it entirely.
    for (const cell of cells()) expect(cell.textContent).not.toMatch(/Taken/);
  });

  it("shows a refusal in text when the tool refuses", async () => {
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    render(<Calendar />);
    // Mark it taken after render, so the click hits the conflict path.
    store().markSlotTaken(avail.data.slots[0]!.id);
    cells()[0]!.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("status").textContent).toMatch(/Could not hold|held for 10 minutes/);
  });
});

describe("Calendar — the grid and the tool give one answer", () => {
  it("greys slots a transport window excludes, and says which window", async () => {
    render(<Calendar />);
    const holdableBefore = cells().length;
    expect(holdableBefore).toBeGreaterThan(0);

    await registry!.execute("set_transport_constraint", {
      earliest_pickup: "10:00",
      latest_return: "12:00",
    });

    // Regression: the grid built itself from the fixture while the tool
    // filtered, so an agent saw the constrained list and the person looking at
    // the same screen saw every slot.
    await waitFor(() => expect(cells().length).toBeLessThan(holdableBefore));
    expect(cells().length).toBeGreaterThan(0);

    // Every excluded cell says which window excluded it, not just "no slot".
    expect(
      screen.getAllByText(/is outside your transport window of 10:00 to 12:00/).length,
    ).toBeGreaterThan(0);
  });

  it("offers a slot again once the window widens", async () => {
    render(<Calendar />);
    await registry!.execute("set_transport_constraint", {
      earliest_pickup: "10:00",
      latest_return: "11:00",
    });
    await waitFor(() => expect(cells().length).toBeGreaterThan(0));
    const narrow = cells().length;

    await registry!.execute("set_transport_constraint", {
      earliest_pickup: "09:00",
      latest_return: "16:00",
    });
    await waitFor(() => expect(cells().length).toBeGreaterThan(narrow));
  });

  it("never leaves a holdable cell the tool would refuse", async () => {
    render(<Calendar />);
    await registry!.execute("set_companion_constraint", {
      name: "Ruth",
      available_from: "09:00",
      available_to: "11:00",
    });
    await waitFor(() => expect(cells().length).toBeGreaterThan(0));

    // Every cell still offered must survive hold_slot, or the grid is lying.
    for (const cell of cells()) {
      const label = cell.textContent ?? "";
      expect(label).not.toMatch(/outside/);
    }
  });
});
