import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../data/providers";
import { slotsForProvider } from "../data/slots";
import { isToolError, type ToolError } from "../lib/defineTool";
import { GRANT_TTL_MS } from "../lib/grants";
import { bookingStore, HOLD_TTL_MS } from "../store";
import {
  confirmBooking,
  findProviders,
  getAvailability,
  getBookingState,
  holdSlot,
  listAccommodations,
  selectProvider,
  setIntake,
  TOOLS,
} from "./index";

const agent = { actor: "agent" as const };
const human = { actor: "human" as const };

function expectError(result: unknown): ToolError {
  expect(isToolError(result), `expected an error, got ${JSON.stringify(result)}`).toBe(true);
  return result as ToolError;
}
function expectOk<T>(result: T | ToolError): T {
  expect(isToolError(result), `expected success, got ${JSON.stringify(result)}`).toBe(false);
  return result as T;
}
const lastAnnouncement = () => bookingStore.getState().announcements.at(-1)?.text ?? "";

/** Drive the store to the given stage through the tools themselves. */
async function reach(stage: "provider_selected" | "availability" | "slot_held" | "intake_complete") {
  await findProviders.run({ specialty: "neurology" }, agent);
  await selectProvider.run({ provider_id: "p01" }, agent);
  if (stage === "provider_selected") return;
  const avail = expectOk(await getAvailability.run({}, agent));
  if (stage === "availability") return;
  const slot = avail.slots[0]!;
  await holdSlot.run({ slot_id: slot.id }, agent);
  if (stage === "slot_held") return slot;
  await setIntake.run({ patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine" }, agent);
  return slot;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-09-03T12:00:00Z") });
  bookingStore.getState().reset();
});
afterEach(() => vi.useRealTimers());

describe("Tier 1 inventory", () => {
  it("defines exactly the 8 Tier 1 tools with honest annotations", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "get_booking_state",
      "list_accommodations",
      "find_providers",
      "select_provider",
      "get_availability",
      "hold_slot",
      "set_intake",
      "confirm_booking",
    ]);
    const readOnly = TOOLS.filter((t) => t.spec.annotations.readOnlyHint).map((t) => t.name);
    expect(readOnly).toEqual(["get_booking_state", "list_accommodations", "find_providers", "get_availability"]);
    expect(confirmBooking.spec.gated).toBe(true);
    expect(confirmBooking.spec.reversible).toBe(false);
  });
});

describe("get_booking_state", () => {
  it("orients the agent at browsing", async () => {
    const r = expectOk(await getBookingState.run({}, agent));
    expect(r.stage).toBe("browsing");
    expect(r.selected_provider).toBeNull();
    expect(r.intake.missing).toEqual(["patient_name", "dob", "reason"]);
    expect(r.next_step).toMatch(/find_providers/);
  });

  it("reports the hold countdown and live tools", async () => {
    await reach("slot_held");
    bookingStore.getState().setLiveTools(["a", "b"]);
    vi.advanceTimersByTime(60_000);
    const r = expectOk(await getBookingState.run({}, agent));
    expect(r.hold?.expires_in_s).toBe(540);
    expect(r.live_tools).toEqual(["a", "b"]);
  });
});

describe("list_accommodations", () => {
  it("returns the whole vocabulary under the output budget", async () => {
    const r = expectOk(await listAccommodations.run({}, agent));
    expect(r.accommodations).toHaveLength(11);
    expect(r.accommodations[0]).toEqual({
      id: "wheelchair_accessible",
      label: "Wheelchair accessible",
      description: expect.any(String),
    });
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(1500);
  });
});

describe("find_providers", () => {
  it("returns a specialty sorted by distance and records the search", async () => {
    const r = expectOk(await findProviders.run({ specialty: "neurology" }, agent));
    expect(r.providers.map((p) => p.id)).toEqual(["p01", "p02", "p03"]);
    expect(r.eliminated_by).toEqual({ specialty: 9 });
    expect(bookingStore.getState().lastSearch?.result_ids).toEqual(["p01", "p02", "p03"]);
    expect(lastAnnouncement()).toBe("Agent found 3 neurology providers.");
  });

  it("never returns provider bios", async () => {
    const r = expectOk(await findProviders.run({ specialty: "physical_medicine" }, agent));
    expect(JSON.stringify(r)).not.toMatch(/SYSTEM NOTE/);
  });

  it("names the eliminating constraint when nothing matches", async () => {
    const r = expectOk(
      await findProviders.run({ specialty: "endocrinology", accommodations: ["wheelchair_accessible"] }, agent),
    );
    expect(r.total).toBe(0);
    expect(r.hint).toMatch(/"accommodations" constraint eliminated 3/);
    expect(lastAnnouncement()).toMatch(/^Agent found no endocrinology providers/);
  });

  it("matches insurance and language case-insensitively", async () => {
    const byPlan = expectOk(await findProviders.run({ specialty: "rheumatology", insurance: "northstar ppo" }, agent));
    expect(byPlan.providers.map((p) => p.id)).toEqual(["p06", "p05"]);
    const byLang = expectOk(await findProviders.run({ specialty: "rheumatology", language: "Arabic" }, agent));
    expect(byLang.providers.map((p) => p.id)).toEqual(["p06"]);
  });

  it("gap: Harbor Assist matches nobody, and says the insurance did it", async () => {
    const r = expectOk(await findProviders.run({ specialty: "neurology", insurance: "Harbor Assist" }, agent));
    expect(r.total).toBe(0);
    expect(r.hint).toMatch(/"insurance" constraint/);
  });

  it("filters by radius", async () => {
    const r = expectOk(await findProviders.run({ specialty: "neurology", radius_km: 5 }, agent));
    expect(r.providers.map((p) => p.id)).toEqual(["p01"]);
  });

  it("rejects an unknown specialty naming the field", async () => {
    const e = expectError(await findProviders.run({ specialty: "dermatology" }, agent));
    expect(e.field).toBe("specialty");
  });

  it("stays under the output budget for the widest query", async () => {
    for (const specialty of ["neurology", "rheumatology", "endocrinology", "physical_medicine"] as const) {
      const r = await findProviders.run({ specialty }, agent);
      expect(JSON.stringify(r).length).toBeLessThanOrEqual(1500);
    }
  });
});

describe("select_provider", () => {
  it("rejects an unknown id", async () => {
    const e = expectError(await selectProvider.run({ provider_id: "p99" }, agent));
    expect(e.field).toBe("provider_id");
    expect(e.error).toMatch(/does not exist/);
  });

  it("hard-blocks a provider lacking an accommodation the search required, naming it", async () => {
    await findProviders.run({ specialty: "neurology", accommodations: ["asl_interpreter"] }, agent);
    const e = expectError(await selectProvider.run({ provider_id: "p02" }, agent));
    expect(e.error).toMatch(/lacks required accommodation: asl_interpreter/);
    expect(e.details?.missing_accommodations).toEqual(["asl_interpreter"]);
    expect(bookingStore.getState().stage).toBe("browsing");
  });

  it("selects and announces with the matched accommodations spelled out", async () => {
    await findProviders.run({ specialty: "neurology", accommodations: ["wheelchair_accessible", "asl_interpreter"] }, agent);
    const r = expectOk(await selectProvider.run({ provider_id: "p01" }, agent));
    expect(r.stage).toBe("provider_selected");
    expect(lastAnnouncement()).toBe(
      "Agent selected Dr. Amara Okafor, Neurology, Wheelchair accessible, ASL interpreter.",
    );
  });

  it("announces the human as 'You'", async () => {
    await selectProvider.run({ provider_id: "p04" }, human);
    expect(lastAnnouncement()).toBe("You selected Dr. Priya Raghunathan, Rheumatology.");
  });
});

describe("get_availability", () => {
  it("requires a selected provider", async () => {
    expectError(await getAvailability.run({}, agent));
  });

  it("lists open slots, caps at 10, and marks availability fetched", async () => {
    await reach("provider_selected");
    const r = expectOk(await getAvailability.run({}, agent));
    expect(r.provider_id).toBe("p01");
    expect(r.showing).toBe(10);
    expect(r.total).toBeGreaterThan(10);
    expect(r.note).toMatch(/Showing 10 of/);
    expect(bookingStore.getState().hasFetchedAvailability).toBe(true);
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(1500);
  });

  it("filters by date range, time of day and duration", async () => {
    await reach("provider_selected");
    const morning = expectOk(await getAvailability.run({ date_from: "2026-10-12", date_to: "2026-10-13", time_of_day: "morning" }, agent));
    for (const s of morning.slots) {
      expect(s.date >= "2026-10-12" && s.date <= "2026-10-13").toBe(true);
      expect(Number(s.time.slice(0, 2))).toBeLessThan(12);
    }
    const hour = expectOk(await getAvailability.run({ duration_min: 60 }, agent));
    expect(hour.total).toBeGreaterThan(0);
    for (const s of hour.slots) expect(s.duration_min).toBe(60);
  });

  it("returns no 60-minute slots for a provider without extended appointments", async () => {
    await findProviders.run({ specialty: "neurology" }, agent);
    await selectProvider.run({ provider_id: "p02" }, agent);
    const r = expectOk(await getAvailability.run({ duration_min: 60 }, agent));
    expect(r.total).toBe(0);
    expect(r.next_step).toMatch(/Widen/);
  });

  it("rejects malformed and out-of-window dates with actionable errors", async () => {
    await reach("provider_selected");
    expect(expectError(await getAvailability.run({ date_from: "14/10/2026" }, agent))).toMatchObject({ field: "date_from" });
    expect(expectError(await getAvailability.run({ date_from: "2026-10-14", date_to: "2026-10-10" }, agent)).error).toMatch(/after/);
    expect(expectError(await getAvailability.run({ date_from: "2027-01-01" }, agent)).error).toMatch(/booking window/);
  });

  it("hides slots that were taken", async () => {
    await reach("provider_selected");
    const first = slotsForProvider("p01")[0]!;
    bookingStore.getState().markSlotTaken(first.id);
    const r = expectOk(await getAvailability.run({}, agent));
    expect(r.slots.map((s) => s.id)).not.toContain(first.id);
  });
});

describe("hold_slot", () => {
  it("rejects unknown ids and other providers' slots", async () => {
    await reach("availability");
    expect(expectError(await holdSlot.run({ slot_id: "s_nope" }, agent)).field).toBe("slot_id");
    const other = slotsForProvider("p02")[0]!;
    expect(expectError(await holdSlot.run({ slot_id: other.id }, agent)).error).toMatch(/belongs to provider p02/);
  });

  it("holds for 10 minutes and moves to slot_held", async () => {
    const avail = expectOk((await reach("availability"), await getAvailability.run({}, agent)));
    const slot = avail.slots[0]!;
    const r = expectOk(await holdSlot.run({ slot_id: slot.id }, agent));
    expect(r).toMatchObject({ held: true, already_held: false, expires_in_s: 600, stage: "slot_held" });
    expect(lastAnnouncement()).toMatch(/^Agent held \w+ \d+ October, \d\d:\d\d, \d+ minutes\. Hold expires in ten minutes\.$/);
  });

  it("is idempotent — a second identical call returns the existing hold", async () => {
    const slot = (await reach("slot_held"))!;
    vi.advanceTimersByTime(30_000);
    const r = expectOk(await holdSlot.run({ slot_id: slot.id }, agent));
    expect(r.already_held).toBe(true);
    expect(r.expires_in_s).toBe(570);
    expect(bookingStore.getState().audit.filter((a) => a.tool === "hold_slot")).toHaveLength(2);
  });

  it("expires on its own and falls back to provider_selected", async () => {
    await reach("slot_held");
    vi.advanceTimersByTime(HOLD_TTL_MS + 1);
    const s = bookingStore.getState();
    expect(s.hold).toBeNull();
    expect(s.stage).toBe("provider_selected");
    expect(s.announcements.at(-1)).toMatchObject({ actor: "system", politeness: "assertive" });
  });

  it("refuses a slot that was taken", async () => {
    const avail = expectOk((await reach("availability"), await getAvailability.run({}, agent)));
    const slot = avail.slots[0]!;
    bookingStore.getState().markSlotTaken(slot.id);
    expect(expectError(await holdSlot.run({ slot_id: slot.id }, agent)).error).toMatch(/no longer available/);
  });
});

describe("set_intake", () => {
  it("requires at least one field", async () => {
    await reach("slot_held");
    expectError(await setIntake.run({}, agent));
  });

  it("validates dob strictly in code with an ISO hint", async () => {
    await reach("slot_held");
    const e = expectError(await setIntake.run({ dob: "14/10/2026" }, agent));
    expect(e).toEqual({ error: 'dob must be ISO 8601 (YYYY-MM-DD); received "14/10/2026"', field: "dob" });
    expect(expectError(await setIntake.run({ dob: "2030-01-01" }, agent)).error).toMatch(/future/);
  });

  it("accepts partial updates and computes completeness", async () => {
    await reach("slot_held");
    const partial = expectOk(await setIntake.run({ patient_name: "Rosa Quintero" }, agent));
    expect(partial.complete).toBe(false);
    expect(partial.missing).toEqual(["dob", "reason"]);
    expect(lastAnnouncement()).toBe("Agent updated intake. Still missing: date of birth, reason for visit.");
    expect(bookingStore.getState().stage).toBe("slot_held");

    const done = expectOk(await setIntake.run({ dob: "1984-03-09", reason: "migraine", accommodations: ["asl_interpreter"] }, agent));
    expect(done.complete).toBe(true);
    expect(done.intake.patient_name).toBe("Rosa Quintero");
    expect(done.stage).toBe("intake_complete");
    expect(lastAnnouncement()).toBe("Agent completed intake for Rosa Quintero.");
  });

  it("rejects an accommodation outside the vocabulary", async () => {
    await reach("slot_held");
    expect(expectError(await setIntake.run({ accommodations: ["wheelchair"] }, agent)).field).toBe("accommodations.0");
  });
});

describe("confirm_booking", () => {
  it("rejects a slot_id that is not the held slot", async () => {
    await reach("intake_complete");
    const e = expectError(await confirmBooking.run({ slot_id: "s_other" }, agent));
    expect(e.error).toMatch(/must match the held slot/);
  });

  it("first call mints a pending grant and returns pending_authorization, assertively", async () => {
    const slot = (await reach("intake_complete"))!;
    const r = expectOk(await confirmBooking.run({ slot_id: slot.id }, agent));
    expect(r).toMatchObject({ status: "pending_authorization", expires_in_s: 120 });
    expect(bookingStore.getState().grants).toHaveLength(1);
    expect(bookingStore.getState().grants[0]?.status).toBe("pending");
    expect(bookingStore.getState().stage).toBe("intake_complete");
    const ann = bookingStore.getState().announcements.at(-1);
    expect(ann?.politeness).toBe("assertive");
    expect(ann?.text).toMatch(/^Agent requested authorization .* You must approve this on the page\.$/);
  });

  it("a repeat call while pending does not mint a second grant", async () => {
    const slot = (await reach("intake_complete"))!;
    await confirmBooking.run({ slot_id: slot.id }, agent);
    vi.advanceTimersByTime(30_000);
    const r = expectOk(await confirmBooking.run({ slot_id: slot.id }, agent));
    expect(r).toMatchObject({ status: "pending_authorization", expires_in_s: 90 });
    expect(bookingStore.getState().grants).toHaveLength(1);
  });

  it("reports grant_expired after 120s and does not silently retry", async () => {
    const slot = (await reach("intake_complete"))!;
    await confirmBooking.run({ slot_id: slot.id }, agent);
    vi.advanceTimersByTime(GRANT_TTL_MS);
    const r = expectOk(await confirmBooking.run({ slot_id: slot.id }, agent));
    expect(r.status).toBe("grant_expired");
    expect(bookingStore.getState().grants).toHaveLength(1);
    expect(bookingStore.getState().booking).toBeNull();
  });

  it("re-checks the slot at commit: a conflict releases the hold and names it", async () => {
    const slot = (await reach("intake_complete"))!;
    bookingStore.getState().markSlotTaken(slot.id);
    const e = expectError(await confirmBooking.run({ slot_id: slot.id }, agent));
    expect(e.error).toMatch(/^slot_conflict/);
    expect(bookingStore.getState().hold).toBeNull();
    expect(bookingStore.getState().stage).toBe("provider_selected");
  });

  it("commits only through an approved, unexpired, argument-bound grant", async () => {
    const slot = (await reach("intake_complete"))!;
    await confirmBooking.run({ slot_id: slot.id }, agent);
    const grant = bookingStore.getState().grants[0]!;

    // Simulate what the Phase 6 GrantCard will do — the only approval channel.
    bookingStore.getState().updateGrant(grant.id, "approved");

    const r = expectOk(await confirmBooking.run({ slot_id: slot.id }, agent));
    expect(r.status).toBe("booked");
    const s = bookingStore.getState();
    expect(s.stage).toBe("booked");
    expect(s.booking?.slot_id).toBe(slot.id);
    expect(s.grants[0]?.status).toBe("consumed");
    expect(lastAnnouncement()).toMatch(/^Agent confirmed the booking with Dr\. Amara Okafor on /);
  });

  it("an approval is void once the arguments change", async () => {
    const slot = (await reach("intake_complete"))!;
    await confirmBooking.run({ slot_id: slot.id }, agent);
    bookingStore.getState().updateGrant(bookingStore.getState().grants[0]!.id, "approved");

    // Switch to a different slot: the held slot (and therefore the argument) changes.
    const avail = expectOk(await getAvailability.run({}, agent));
    const other = avail.slots.find((s) => s.id !== slot.id)!;
    await holdSlot.run({ slot_id: other.id }, agent);

    const r = expectOk(await confirmBooking.run({ slot_id: other.id }, agent));
    expect(r.status).toBe("pending_authorization");
    expect(bookingStore.getState().booking).toBeNull();
  });

  it("a consumed grant cannot be replayed", async () => {
    const slot = (await reach("intake_complete"))!;
    await confirmBooking.run({ slot_id: slot.id }, agent);
    bookingStore.getState().updateGrant(bookingStore.getState().grants[0]!.id, "approved");
    await confirmBooking.run({ slot_id: slot.id }, agent);
    // Force the state back as if an attacker replayed the call.
    bookingStore.getState().holdSlot({ slot_id: slot.id, provider_id: "p01", expires_at: Date.now() + HOLD_TTL_MS });
    const e = expectError(await confirmBooking.run({ slot_id: slot.id }, agent));
    expect(e.error).toMatch(/already used/);
  });
});

describe("output budgets across the fixture", () => {
  it("every provider's default availability fits the budget", async () => {
    for (const p of PROVIDERS) {
      bookingStore.getState().reset();
      await findProviders.run({ specialty: p.specialty }, agent);
      await selectProvider.run({ provider_id: p.id }, agent);
      const r = await getAvailability.run({}, agent);
      expect(JSON.stringify(r).length, p.id).toBeLessThanOrEqual(1500);
    }
  });
});
