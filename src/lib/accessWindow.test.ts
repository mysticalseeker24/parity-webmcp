import { describe, expect, it } from "vitest";
import { accessWindowReason, addMinutes, fitsAccessWindows } from "./accessWindow";

const slot = (time: string, duration_min = 30) => ({ time, duration_min });

describe("addMinutes", () => {
  it("rolls over the hour", () => {
    expect(addMinutes("09:45", 30)).toBe("10:15");
    expect(addMinutes("23:30", 45)).toBe("24:15");
  });
});

describe("fitsAccessWindows — one predicate for the tool and the grid", () => {
  it("allows everything when no constraint is set", () => {
    expect(fitsAccessWindows(slot("08:00"), null, null)).toBe(true);
  });

  it("requires the whole appointment inside the transport window", () => {
    const transport = { earliest_pickup: "10:00", latest_return: "12:00" };
    expect(fitsAccessWindows(slot("10:00"), null, transport)).toBe(true);
    expect(fitsAccessWindows(slot("11:30"), null, transport)).toBe(true);
    // Starts inside the window but finishes after the return pickup. A slot
    // you can reach but cannot leave is not a slot.
    expect(fitsAccessWindows(slot("11:45"), null, transport)).toBe(false);
    expect(fitsAccessWindows(slot("09:30"), null, transport)).toBe(false);
  });

  it("requires the whole appointment inside the companion window", () => {
    const companion = { name: "Ruth", available_from: "09:00", available_to: "10:00" };
    expect(fitsAccessWindows(slot("09:30"), companion, null)).toBe(true);
    expect(fitsAccessWindows(slot("09:45"), companion, null)).toBe(false);
  });

  it("ignores a companion with no stated window", () => {
    expect(fitsAccessWindows(slot("06:00"), { name: "Ruth" }, null)).toBe(true);
  });

  it("applies both windows together", () => {
    const companion = { available_from: "09:00", available_to: "13:00" };
    const transport = { earliest_pickup: "11:00", latest_return: "12:00" };
    expect(fitsAccessWindows(slot("10:00"), companion, transport)).toBe(false);
    expect(fitsAccessWindows(slot("11:00"), companion, transport)).toBe(true);
  });

  it("respects a longer appointment needing more room", () => {
    const transport = { earliest_pickup: "10:00", latest_return: "11:00" };
    expect(fitsAccessWindows(slot("10:00", 60), null, transport)).toBe(true);
    expect(fitsAccessWindows(slot("10:00", 90), null, transport)).toBe(false);
  });
});

describe("accessWindowReason — say which constraint excluded it", () => {
  it("is null when the slot fits", () => {
    expect(accessWindowReason(slot("10:00"), null, null)).toBeNull();
  });

  it("names the companion by name when one was given", () => {
    const reason = accessWindowReason(
      slot("14:00"),
      { name: "Ruth", available_from: "09:00", available_to: "12:00" },
      null,
    );
    expect(reason).toMatch(/Ruth's window of 09:00 to 12:00/);
  });

  it("falls back to a neutral phrase with no name", () => {
    const reason = accessWindowReason(
      slot("14:00"),
      { available_from: "09:00", available_to: "12:00" },
      null,
    );
    expect(reason).toMatch(/your companion's window/);
  });

  it("names the transport window", () => {
    const reason = accessWindowReason(slot("08:00"), null, {
      earliest_pickup: "10:00",
      latest_return: "14:00",
    });
    expect(reason).toMatch(/transport window of 10:00 to 14:00/);
  });
});
