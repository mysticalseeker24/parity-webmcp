import { describe, expect, it } from "vitest";
import { ACCOMMODATION, ACCOMMODATION_LABELS } from "./accommodations";
import { INSURANCE_PLANS, PROVIDERS, SPECIALTY } from "./providers";
import { isRealDate, SCHEDULE_DATES, SCHEDULE_END, SCHEDULE_START, SLOTS, slotLabel, slotsForProvider } from "./slots";

describe("accommodation vocabulary", () => {
  it("has a label and description for every enum member", () => {
    for (const id of ACCOMMODATION.options) {
      expect(ACCOMMODATION_LABELS[id].label.length).toBeGreaterThan(0);
      expect(ACCOMMODATION_LABELS[id].description.length).toBeGreaterThan(0);
    }
  });
});

describe("providers fixture", () => {
  it("has 12 providers, 3 per specialty, with unique ids", () => {
    expect(PROVIDERS).toHaveLength(12);
    expect(new Set(PROVIDERS.map((p) => p.id)).size).toBe(12);
    for (const specialty of SPECIALTY.options) {
      expect(PROVIDERS.filter((p) => p.specialty === specialty)).toHaveLength(3);
    }
  });

  it("only uses accommodations and plans from the shared vocabularies", () => {
    for (const p of PROVIDERS) {
      for (const a of p.accommodations) expect(ACCOMMODATION.options).toContain(a);
      for (const plan of p.insurance) expect(INSURANCE_PLANS).toContain(plan);
    }
  });

  it("gap: endocrinology has no wheelchair-accessible provider", () => {
    const accessible = PROVIDERS.filter(
      (p) => p.specialty === "endocrinology" && p.accommodations.includes("wheelchair_accessible"),
    );
    expect(accessible).toHaveLength(0);
  });

  it("gap: Harbor Assist is accepted by nobody", () => {
    expect(PROVIDERS.some((p) => p.insurance.includes("Harbor Assist"))).toBe(false);
  });

  it("gap: at least one provider has a long interpreter lead time", () => {
    expect(PROVIDERS.some((p) => p.interpreter_lead_time_days >= 14)).toBe(true);
  });

  it("gap: exactly one bio carries the injection fixture, and it names a tool", () => {
    const injected = PROVIDERS.filter((p) => /confirm_booking/i.test(p.bio));
    expect(injected).toHaveLength(1);
    expect(injected[0]?.id).toBe("p10");
  });

  it("contains no phone numbers or street addresses", () => {
    for (const p of PROVIDERS) {
      expect(p.bio).not.toMatch(/\d{3}[-.\s]\d{3}[-.\s]\d{4}/);
      expect(p.bio).not.toMatch(/\d+\s+\w+\s+(street|st\.|avenue|ave\.|road|rd\.)/i);
    }
  });
});

describe("slots fixture", () => {
  it("is deterministic — the same ids on every generation", () => {
    expect({ count: SLOTS.length, first: SLOTS.slice(0, 5).map((s) => s.id) }).toMatchSnapshot();
  });

  it("covers a 14-day window of weekdays starting on a Monday", () => {
    expect(SCHEDULE_START).toBe("2026-10-05");
    expect(SCHEDULE_DATES).toHaveLength(10);
    expect(SCHEDULE_DATES[0]).toBe(SCHEDULE_START);
    expect(SCHEDULE_DATES.at(-1)).toBe(SCHEDULE_END);
  });

  it("has unique ids that encode provider, date and time", () => {
    expect(new Set(SLOTS.map((s) => s.id)).size).toBe(SLOTS.length);
    for (const s of SLOTS) {
      expect(s.id).toBe(`s_${s.provider_id}_${s.date}_${s.time.replace(":", "")}`);
      expect(SCHEDULE_DATES).toContain(s.date);
      expect(s.time >= "09:00" && s.time <= "16:30").toBe(true);
    }
  });

  it("gives every provider some availability", () => {
    for (const p of PROVIDERS) expect(slotsForProvider(p.id).length).toBeGreaterThan(5);
  });

  it("only offers 60-minute slots where the provider offers extended appointments", () => {
    const extended = new Set(
      PROVIDERS.filter((p) => p.accommodations.includes("extended_appointment")).map((p) => p.id),
    );
    for (const s of SLOTS) {
      if (s.duration_min === 60) expect(extended.has(s.provider_id)).toBe(true);
    }
    expect(SLOTS.some((s) => s.duration_min === 60)).toBe(true);
  });

  it("labels a slot for announcements in words, not ISO", () => {
    expect(slotLabel({ date: "2026-10-14", time: "10:30" })).toBe("Wednesday 14 October, 10:30");
  });
});

describe("isRealDate", () => {
  it("accepts real dates and rejects impostors", () => {
    expect(isRealDate("2026-10-14")).toBe(true);
    expect(isRealDate("2026-02-30")).toBe(false);
    expect(isRealDate("14/10/2026")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("")).toBe(false);
  });
});
