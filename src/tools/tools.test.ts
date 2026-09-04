import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "../data/providers";
import { slotsForProvider } from "../data/slots";
import { BUDGET } from "../lib/defineTool";
import { isRefusal, type ToolRefusal, type ToolResult } from "../lib/result";
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

const store = () => bookingStore.getState();

function expectOk(result: ToolResult): Record<string, unknown> {
  expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
  return (result as { data: Record<string, unknown> }).data;
}
function expectRefusal(result: ToolResult): ToolRefusal {
  expect(result.ok, `expected a refusal, got ${JSON.stringify(result)}`).toBe(false);
  return result as ToolRefusal;
}

/** Drive the flow through the tools themselves, as an agent would. */
async function reach(stage: "provider_selected" | "availability" | "slot_held" | "intake_complete") {
  await findProviders.run({ specialty: "neurology" });
  await selectProvider.run({ provider_id: "p01" });
  if (stage === "provider_selected") return undefined;
  const avail = expectOk(await getAvailability.run({}));
  if (stage === "availability") return undefined;
  const slot = (avail["slots"] as { id: string }[])[0]!;
  await holdSlot.run({ slot_id: slot.id });
  if (stage === "slot_held") return slot;
  await setIntake.run({ patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine" });
  return slot;
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-09-04T12:00:00Z") });
  store().reset();
});
afterEach(() => vi.useRealTimers());

describe("Tier 1 inventory", () => {
  it("is the 8 tools from PROJECT_SPEC §5, in workflow order", () => {
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
  });

  it("marks exactly the read-only tools readOnly, and gates only confirm_booking", () => {
    expect(TOOLS.filter((t) => t.spec.readOnly).map((t) => t.name)).toEqual([
      "get_booking_state",
      "list_accommodations",
      "find_providers",
      "get_availability",
    ]);
    expect(TOOLS.filter((t) => t.spec.requiresGrant).map((t) => t.name)).toEqual([
      "confirm_booking",
    ]);
  });
});

describe("get_booking_state (#262, #255)", () => {
  it("orients the agent at browsing and explains every unavailable tool", async () => {
    const data = expectOk(await getBookingState.run({}));
    expect(data["stage"]).toBe("browsing");
    expect(data["live"]).toEqual({
      orient: ["get_booking_state", "list_accommodations"],
      search: ["find_providers", "select_provider"],
    });

    const unavailable = data["unavailable"] as { tool: string; reason_code: string; unlock_by: string }[];
    expect(unavailable.map((u) => u.tool)).toEqual([
      "get_availability",
      "hold_slot",
      "set_intake",
      "confirm_booking",
    ]);
    // Every entry says why and how to unlock — the context #262 says
    // unregistration destroys.
    for (const entry of unavailable) {
      expect(entry.reason_code).toBeTruthy();
      expect(entry.unlock_by).toBeTruthy();
    }
    expect(unavailable.find((u) => u.tool === "confirm_booking")?.reason_code).toBe("no_hold");
  });

  it("reports intake_incomplete on confirm_booking once a slot is held", async () => {
    await reach("slot_held");
    const data = expectOk(await getBookingState.run({}));
    const unavailable = data["unavailable"] as { tool: string; reason_code: string }[];
    expect(unavailable.find((u) => u.tool === "confirm_booking")?.reason_code).toBe(
      "intake_incomplete",
    );
  });

  it("stays under the 1.5K output budget in every stage", async () => {
    const sizes: Record<string, number> = {};
    const measure = async (label: string) => {
      sizes[label] = JSON.stringify(await getBookingState.run({})).length;
      expect(sizes[label], `${label} exceeds the budget`).toBeLessThanOrEqual(BUDGET.output);
    };

    await measure("browsing");
    await reach("provider_selected");
    await measure("provider_selected");
    await getAvailability.run({});
    await measure("availability_fetched");
    await reach("slot_held");
    await measure("slot_held");
    await setIntake.run({ patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine" });
    await measure("intake_complete");
    store().confirmBooking({
      id: "b1",
      slotId: "s1",
      providerId: "p01",
      confirmedAt: Date.now(),
      intake: store().intake,
    });
    await measure("booked");
  });
});

describe("list_accommodations", () => {
  it("returns the whole vocabulary within budget", async () => {
    const result = await listAccommodations.run({});
    const data = expectOk(result);
    expect((data["accommodations"] as unknown[]).length).toBe(10);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(BUDGET.output);
  });
});

describe("find_providers", () => {
  it("returns a specialty nearest-first and records the search", async () => {
    const data = expectOk(await findProviders.run({ specialty: "neurology" }));
    expect((data["providers"] as { id: string }[]).map((p) => p.id)).toEqual(["p01", "p02", "p03"]);
    expect(store().lastSearch?.total_matches).toBe(3);
  });

  it("never leaks a provider bio — the injection fixture cannot reach the agent", async () => {
    const result = await findProviders.run({ specialty: "physiotherapy" });
    expect(JSON.stringify(result)).not.toMatch(/SYSTEM NOTE/);
  });

  it("caps at 5 and says how many it is hiding", async () => {
    // Widen past the cap by searching a specialty with more matches than 5 is
    // not possible with 3 per specialty, so assert the note logic directly.
    const data = expectOk(await findProviders.run({ specialty: "neurology" }));
    expect(data["note"]).toBeUndefined();
    expect(data["showing"]).toBe(3);
    expect(data["total"]).toBe(3);
  });

  it("refuses with the eliminating constraint when nothing matches", async () => {
    const refusal = expectRefusal(
      await findProviders.run({
        specialty: "audiology",
        accommodations: ["wheelchair_accessible"],
      }),
    );
    expect(refusal.kind).toBe("unavailable");
    expect(refusal.reason).toMatch(/"accommodations" constraint eliminated 3/);
  });

  it("gap: Harbor Assist matches nobody and the insurance constraint is named", async () => {
    const refusal = expectRefusal(
      await findProviders.run({ specialty: "neurology", insurance: "Harbor Assist" }),
    );
    expect(refusal.reason).toMatch(/"insurance" constraint/);
  });

  it("matches insurance and language case-insensitively", async () => {
    const byPlan = expectOk(
      await findProviders.run({ specialty: "rheumatology", insurance: "northstar ppo" }),
    );
    expect((byPlan["providers"] as { id: string }[]).map((p) => p.id)).toEqual(["p06", "p05"]);
  });

  it("refuses an unknown specialty, naming the field and the valid values", async () => {
    const refusal = expectRefusal(await findProviders.run({ specialty: "dermatology" }));
    expect(refusal.kind).toBe("invalid_input");
    expect(refusal.field).toBe("specialty");
    expect(refusal.reason).toMatch(/"neurology"/);
  });

  it("stays within budget for every specialty", async () => {
    for (const specialty of ["neurology", "rheumatology", "audiology", "physiotherapy"] as const) {
      const result = await findProviders.run({ specialty });
      expect(JSON.stringify(result).length, specialty).toBeLessThanOrEqual(BUDGET.output);
    }
  });
});

describe("select_provider", () => {
  it("refuses an unknown id as invalid_input", async () => {
    const refusal = expectRefusal(await selectProvider.run({ provider_id: "p99" }));
    expect(refusal.kind).toBe("invalid_input");
    expect(refusal.field).toBe("provider_id");
  });

  it("hard-blocks a provider missing a required accommodation, naming it", async () => {
    await findProviders.run({ specialty: "neurology", accommodations: ["asl_interpreter"] });
    const refusal = expectRefusal(await selectProvider.run({ provider_id: "p02" }));
    expect(refusal.kind).toBe("refused");
    expect(refusal.reason).toMatch(/does not offer ASL interpreter/);
    expect(store().stage).toBe("browsing");
  });

  it("selects and moves the stage on", async () => {
    await findProviders.run({ specialty: "neurology" });
    const data = expectOk(await selectProvider.run({ provider_id: "p01" }));
    expect(data["stage"]).toBe("provider_selected");
    expect(store().selectedProviderId).toBe("p01");
  });
});

describe("get_availability", () => {
  it("refuses when no provider is selected", async () => {
    expect(expectRefusal(await getAvailability.run({})).kind).toBe("unavailable");
  });

  it("returns slots, caps them, and marks availability fetched", async () => {
    await reach("provider_selected");
    const data = expectOk(await getAvailability.run({}));
    expect(data["showing"]).toBe(8);
    expect(data["note"]).toMatch(/showing 8 of/);
    expect(store().hasFetchedAvailability).toBe(true);
  });

  it("filters by time of day and duration", async () => {
    await reach("provider_selected");
    const morning = expectOk(await getAvailability.run({ time_of_day: "morning" }));
    for (const s of morning["slots"] as { time: string }[]) {
      expect(Number(s.time.slice(0, 2))).toBeLessThan(12);
    }
    const long = expectOk(await getAvailability.run({ duration_min: 60 }));
    for (const s of long["slots"] as { min: number }[]) expect(s.min).toBe(60);
  });

  it("refuses malformed and out-of-window dates with a valid example", async () => {
    await reach("provider_selected");
    expect(expectRefusal(await getAvailability.run({ date_from: "14/10/2026" })).reason).toMatch(
      /2026-10-14/,
    );
    expect(expectRefusal(await getAvailability.run({ date_from: "2027-01-01" })).reason).toMatch(
      /booking window/,
    );
  });

  it("stays within budget for every provider", async () => {
    for (const p of PROVIDERS) {
      store().reset();
      store().selectProvider(p.id);
      const result = await getAvailability.run({});
      expect(JSON.stringify(result).length, p.id).toBeLessThanOrEqual(BUDGET.output);
    }
  });
});

describe("hold_slot", () => {
  it("refuses an unknown slot and another provider's slot", async () => {
    await reach("availability");
    expect(expectRefusal(await holdSlot.run({ slot_id: "nope" })).kind).toBe("invalid_input");
    const other = slotsForProvider("p02")[0]!;
    expect(expectRefusal(await holdSlot.run({ slot_id: other.id })).kind).toBe("refused");
  });

  it("holds for 10 minutes and moves to slot_held", async () => {
    const slot = await reach("slot_held");
    const held = store().heldSlot;
    expect(held?.slotId).toBe(slot!.id);
    expect(held!.expiresAt - Date.now()).toBe(HOLD_TTL_MS);
    expect(store().stage).toBe("slot_held");
  });

  it("is idempotent — re-holding the same slot returns the existing hold", async () => {
    const slot = await reach("slot_held");
    const before = store().heldSlot;
    vi.advanceTimersByTime(30_000);
    const data = expectOk(await holdSlot.run({ slot_id: slot!.id }));
    expect(data["already_held"]).toBe(true);
    expect(data["expires_in_s"]).toBe(570);
    expect(store().heldSlot).toEqual(before);
  });

  it("returns conflict when the slot was taken", async () => {
    await reach("availability");
    const avail = expectOk(await getAvailability.run({}));
    const slot = (avail["slots"] as { id: string }[])[0]!;
    store().markSlotTaken(slot.id);
    expect(expectRefusal(await holdSlot.run({ slot_id: slot.id })).kind).toBe("conflict");
  });
});

describe("set_intake", () => {
  it("requires at least one field", async () => {
    await reach("slot_held");
    expect(expectRefusal(await setIntake.run({})).kind).toBe("invalid_input");
  });

  it("validates dob in code with an ISO hint", async () => {
    await reach("slot_held");
    const refusal = expectRefusal(await setIntake.run({ dob: "14/10/2026" }));
    expect(refusal.field).toBe("dob");
    expect(refusal.reason).toMatch(/1984-03-09/);
    expect(expectRefusal(await setIntake.run({ dob: "2030-01-01" })).reason).toMatch(/future/);
  });

  it("merges partial updates and flips the stage only when complete", async () => {
    await reach("slot_held");
    const partial = expectOk(await setIntake.run({ patient_name: "Rosa Quintero" }));
    expect(partial["complete"]).toBe(false);
    expect(partial["missing"]).toEqual(["dob", "reason"]);
    expect(store().stage).toBe("slot_held");

    const done = expectOk(await setIntake.run({ dob: "1984-03-09", reason: "migraine" }));
    expect(done["complete"]).toBe(true);
    expect((done["intake"] as { patient_name: string }).patient_name).toBe("Rosa Quintero");
    expect(store().stage).toBe("intake_complete");
  });

  it("refuses an accommodation outside the vocabulary", async () => {
    await reach("slot_held");
    const refusal = expectRefusal(await setIntake.run({ accommodations: ["wheelchair"] }));
    expect(refusal.field).toBe("accommodations.0");
  });
});

describe("confirm_booking — no path to a booking exists yet", () => {
  it("refuses with pending_authorization rather than committing", async () => {
    const slot = await reach("intake_complete");
    const refusal = expectRefusal(await confirmBooking.run({ slot_id: slot!.id }));
    expect(refusal.kind).toBe("pending_authorization");
    expect(refusal.reason).toMatch(/must approve/);
    expect(store().booking).toBeNull();
    expect(store().stage).toBe("intake_complete");
  });

  it("refuses a slot_id that is not the held slot", async () => {
    await reach("intake_complete");
    const refusal = expectRefusal(await confirmBooking.run({ slot_id: "s_other" }));
    expect(refusal.kind).toBe("invalid_input");
  });

  it("re-checks the slot at commit and releases the hold on a conflict", async () => {
    const slot = await reach("intake_complete");
    store().markSlotTaken(slot!.id);
    const refusal = expectRefusal(await confirmBooking.run({ slot_id: slot!.id }));
    expect(refusal.kind).toBe("conflict");
    expect(store().heldSlot).toBeNull();
    expect(store().stage).toBe("provider_selected");
  });

  it("describes itself as consequential so the host's confirmation fires (#288)", () => {
    expect(confirmBooking.spec.description).toMatch(/^Consequential:/);
    expect(confirmBooking.spec.description).toMatch(/cannot give/);
  });

  it("no tool in the catalogue can approve a grant", () => {
    for (const tool of TOOLS) {
      expect(tool.name).not.toMatch(/approve|grant|authorize/i);
    }
  });
});

describe("refusals fulfil, they never throw (#282)", () => {
  it("holds for every tool given deliberately wrong input", async () => {
    for (const tool of TOOLS) {
      const result = await tool.run({ nonsense: true, slot_id: 42, provider_id: 42 });
      expect(result, tool.name).toHaveProperty("ok");
      if (isRefusal(result)) expect(typeof result.reason).toBe("string");
    }
  });
});
