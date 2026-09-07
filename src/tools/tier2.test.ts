import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUDGET } from "../lib/defineTool";
import { allGrants, approve, DWELL_MS, resetGrants } from "../lib/grants";
import { MAX_LIVE_TOOLS, startRegistry, type Registry } from "../lib/registry";
import { clearHoldTimer } from "../lib/timers";
import { clearUndo } from "../lib/undo";
import { REASONS } from "../lib/reasons";
import type { ToolRefusal, ToolResult } from "../lib/result";
import { bookingStore } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import {
  cancelBooking,
  checkCoverage,
  explainNoResults,
  getAvailability,
  getBookingState,
  releaseSlot,
  setCompanionConstraint,
  TOOLS,
} from "./index";

let restore: (() => void) | null = null;
let registry: Registry | null = null;

const store = () => bookingStore.getState();
const NOW = new Date("2026-09-04T12:00:00Z").getTime();

function data(result: ToolResult): Record<string, unknown> {
  expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
  return (result as { data: Record<string, unknown> }).data;
}
function refusal(result: ToolResult): ToolRefusal {
  expect(result.ok, `expected a refusal, got ${JSON.stringify(result)}`).toBe(false);
  return result as ToolRefusal;
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  clearHoldTimer();
  clearUndo();
  resetGrants();
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
});

afterEach(() => {
  registry?.stop();
  registry = null;
  clearHoldTimer();
  clearUndo();
  resetGrants();
  restore?.();
  restore = null;
  vi.useRealTimers();
});

async function slots() {
  const avail = (await registry!.execute("get_availability", {})) as {
    data: { slots: { id: string; time: string; min: number }[] };
  };
  return avail.data.slots;
}

async function reachBooked(): Promise<string> {
  await registry!.execute("find_providers", { specialty: "neurology" });
  await registry!.execute("select_provider", { provider_id: "p01" });
  const list = await slots();
  await registry!.execute("hold_slot", { slot_id: list[0]!.id });
  await registry!.execute("set_intake", {
    patient_name: "Rosa Quintero",
    dob: "1984-03-09",
    reason: "migraine",
  });
  await cancelOrConfirm();
  return store().booking!.id;
}

/** Mint + approve + commit confirm_booking. */
async function cancelOrConfirm() {
  await registry!.execute("confirm_booking", { slot_id: store().heldSlot!.slotId });
  approve(allGrants()[0]!.id, {
    isTrusted: true,
    modality: "pointer",
    now: NOW + DWELL_MS + 500,
  });
  await registry!.execute("confirm_booking", { slot_id: store().heldSlot!.slotId });
}

// ── explain_no_results ──────────────────────────────────────────────────────

describe("explain_no_results", () => {
  it("does not exist before a search", () => {
    expect(explainNoResults.available(store())).toBe(false);
    expect(explainNoResults.unavailableReason(store())).toMatchObject({
      reason_code: "no_search",
      unlock_by: "find_providers",
    });
  });

  it("does not exist when the search found something", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    expect(explainNoResults.available(store())).toBe(false);
    expect(explainNoResults.unavailableReason(store()).reason_code).toBe("search_had_results");
  });

  it("registers only after a search that matched nobody", async () => {
    await registry!.execute("find_providers", {
      specialty: "audiology",
      accommodations: ["wheelchair_accessible"],
    });
    expect(store().lastSearch?.total_matches).toBe(0);
    expect(explainNoResults.available(store())).toBe(true);
    expect(store().liveTools).toContain("explain_no_results");
  });

  it("names the constraint that eliminated the most providers", async () => {
    await registry!.execute("find_providers", {
      specialty: "audiology",
      accommodations: ["wheelchair_accessible"],
    });
    const out = data(await explainNoResults.run({}));

    expect(out["relax"]).toBe("accommodations");
    expect(out["constraints"]).toEqual([{ constraint: "accommodations", eliminated: 3 }]);
    // The gap in the fixture: audiology has no wheelchair-accessible provider.
    expect((await explainNoResults.run({})) as { human_summary: string }).toMatchObject({
      human_summary: expect.stringContaining("required accommodations ruled out 3"),
    });
  });

  it("ranks constraints when several eliminated candidates", async () => {
    await registry!.execute("find_providers", {
      specialty: "neurology",
      accommodations: ["hoist_transfer"],
      insurance: "Harbor Assist",
    });
    const out = data(await explainNoResults.run({}));
    const constraints = out["constraints"] as { constraint: string; eliminated: number }[];
    expect(constraints.length).toBeGreaterThan(0);
    // Sorted by how much each removed, so "relax" is the highest-value change.
    for (let i = 1; i < constraints.length; i++) {
      expect(constraints[i - 1]!.eliminated).toBeGreaterThanOrEqual(constraints[i]!.eliminated);
    }
    expect(out["relax"]).toBe(constraints[0]!.constraint);
  });
});

// ── check_coverage ──────────────────────────────────────────────────────────

describe("check_coverage", () => {
  it("returns the rule that fired, by id, not a paraphrase", async () => {
    const out = data(await checkCoverage.run({ insurance: "Harbor Assist", specialty: "neurology" }));
    expect(out).toMatchObject({
      effect: "not_covered",
      rule_id: "cov_harbor_none",
      can_book: false,
    });
    expect(out["rule"]).toBe("Harbor Assist has no in-network specialists on this site.");
  });

  it("reports a referral requirement as its own effect, not a refusal", async () => {
    const out = data(await checkCoverage.run({ insurance: "CivicCare Basic", specialty: "neurology" }));
    expect(out).toMatchObject({ effect: "referral_required", can_book: true });
    expect(out["rule_id"]).toBe("cov_civic_neuro_referral");
  });

  it("falls through to the default rule when nothing special applies", async () => {
    const out = data(await checkCoverage.run({ insurance: "Northstar PPO", specialty: "neurology" }));
    expect(out).toMatchObject({ effect: "covered", rule_id: "cov_default" });
  });

  it("refuses an unknown plan, naming the field", async () => {
    const bad = refusal(await checkCoverage.run({ insurance: "Nonesuch", specialty: "neurology" }));
    expect(bad.kind).toBe("invalid_input");
    expect(bad.field).toBe("insurance");
  });

  it("is a browsing-stage question and says so once a slot is held", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    expect(checkCoverage.available(store())).toBe(false);
    expect(checkCoverage.unavailableReason(store())).toMatchObject({
      reason_code: "picking_times",
      unlock_by: "release_slot",
    });
  });
});

// ── set_companion_constraint ────────────────────────────────────────────────

describe("set_companion_constraint", () => {
  it("rejects malformed times with a valid example", async () => {
    const bad = refusal(
      await setCompanionConstraint.run({ available_from: "9am", available_to: "14:00" }),
    );
    expect(bad.field).toBe("available_from");
    expect(bad.reason).toMatch(/09:30/);
  });

  it("rejects a window that ends before it starts", async () => {
    const bad = refusal(
      await setCompanionConstraint.run({ available_from: "15:00", available_to: "09:00" }),
    );
    expect(bad.reason).toMatch(/must be earlier than/);
  });

  it("records the window on the store", async () => {
    await setCompanionConstraint.run({
      name: "Marta",
      available_from: "10:00",
      available_to: "12:00",
    });
    expect(store().companion).toEqual({
      name: "Marta",
      available_from: "10:00",
      available_to: "12:00",
    });
  });

  it("actually narrows get_availability — the promise is kept, not just announced", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    // Compare totals, not the returned page: the result is capped at 8 slots,
    // so the displayed list is the same length either way.
    const before = data(await getAvailability.run({}))["total"] as number;

    await setCompanionConstraint.run({ available_from: "10:00", available_to: "12:00" });
    const after = data(await getAvailability.run({}));
    const narrowed = after["slots"] as { time: string; min: number }[];

    expect(narrowed.length).toBeGreaterThan(0);
    expect(after["total"] as number).toBeLessThan(before);
    for (const slot of narrowed) {
      expect(slot.time >= "10:00").toBe(true);
      // The companion must cover the whole appointment, not just its start.
      const [h, m] = slot.time.split(":").map(Number);
      const end = (h ?? 0) * 60 + (m ?? 0) + slot.min;
      expect(end).toBeLessThanOrEqual(12 * 60);
    }
  });

  it("blames the companion window when it is what emptied the results", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    await setCompanionConstraint.run({ available_from: "05:00", available_to: "05:30" });
    const out = refusal(await getAvailability.run({}));
    expect(out.reason).toMatch(/companion window 05:00–05:30/);
    expect(out.next).toBe("set_companion_constraint");
  });
});

// ── release_slot ────────────────────────────────────────────────────────────

describe("release_slot", () => {
  it("exists only while a hold does", async () => {
    expect(releaseSlot.available(store())).toBe(false);
    expect(releaseSlot.unavailableReason(store()).reason_code).toBe("no_hold");

    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    expect(releaseSlot.available(store())).toBe(true);
  });

  it("frees the hold, returns to provider_selected, and clears the timer", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    expect(vi.getTimerCount()).toBe(1);

    const out = data(await releaseSlot.run({}));

    expect(out).toMatchObject({ released: list[0]!.id, stage: "provider_selected" });
    expect(store().heldSlot).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports hold_expired rather than no_hold after a timeout", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(releaseSlot.unavailableReason(store())).toMatchObject({
      reason_code: "hold_expired",
      reason: REASONS.hold_expired,
    });
  });
});

// ── cancel_booking ──────────────────────────────────────────────────────────

describe("cancel_booking — gated, through the same grants path", () => {
  it("does not exist until a booking does", () => {
    expect(cancelBooking.available(store())).toBe(false);
    expect(cancelBooking.unavailableReason(store())).toMatchObject({
      reason_code: "no_booking",
      unlock_by: "confirm_booking",
    });
  });

  it("first call refuses with pending_authorization and commits nothing", async () => {
    const bookingId = await reachBooked();
    const out = refusal(await cancelBooking.run({ booking_id: bookingId }));

    expect(out.kind).toBe("pending_authorization");
    expect(out.next).toMatch(/approve on the page, then call cancel_booking again/);
    expect(store().booking?.id).toBe(bookingId);
  });

  it("cancels only after approval, then consumes the grant", async () => {
    const bookingId = await reachBooked();
    await cancelBooking.run({ booking_id: bookingId });

    const pending = allGrants().find((g) => g.tool === "cancel_booking" && g.status === "pending")!;
    approve(pending.id, { isTrusted: true, modality: "keyboard", key: "Enter", now: NOW + 5000 });

    const out = data(await cancelBooking.run({ booking_id: bookingId }));

    expect(out).toMatchObject({ cancelled: bookingId, stage: "browsing" });
    expect(store().booking).toBeNull();
    expect(allGrants().find((g) => g.id === pending.id)?.status).toBe("consumed");
  });

  it("frees the slot again so it can be rebooked", async () => {
    const bookingId = await reachBooked();
    const slotId = store().booking!.slotId;
    expect(store().takenSlotIds).toContain(slotId);

    await cancelBooking.run({ booking_id: bookingId });
    const pending = allGrants().find((g) => g.tool === "cancel_booking" && g.status === "pending")!;
    approve(pending.id, { isTrusted: true, modality: "pointer", now: NOW + 5000 });
    await cancelBooking.run({ booking_id: bookingId });

    expect(store().takenSlotIds).not.toContain(slotId);
  });

  it("keeps the audit trail across a cancellation", async () => {
    const bookingId = await reachBooked();
    const before = store().audit.length;
    await cancelBooking.run({ booking_id: bookingId });
    const pending = allGrants().find((g) => g.tool === "cancel_booking" && g.status === "pending")!;
    approve(pending.id, { isTrusted: true, modality: "pointer", now: NOW + 5000 });
    await cancelBooking.run({ booking_id: bookingId });

    // The record of what happened must survive the thing being undone.
    expect(store().audit.length).toBeGreaterThanOrEqual(before);
  });

  it("refuses a booking_id that is not the current booking", async () => {
    await reachBooked();
    const bad = refusal(await cancelBooking.run({ booking_id: "bkg_nope" }));
    expect(bad.kind).toBe("invalid_input");
    expect(bad.field).toBe("booking_id");
  });

  it("declares itself consequential so the host's confirmation fires (#288)", () => {
    expect(cancelBooking.spec.description).toMatch(/^Consequential:/);
    expect(cancelBooking.spec.description).toMatch(/cannot give/);
  });
});

// ── whole-set invariants ────────────────────────────────────────────────────

describe("Tier 2 keeps the whole-set invariants", () => {
  it("never exceeds the live-tool cap in any reachable stage", async () => {
    const seen: Record<string, number> = {};
    const note = (label: string) => {
      seen[label] = store().liveTools.length;
      expect(store().liveTools.length, `${label}: ${store().liveTools.join(", ")}`)
        .toBeLessThanOrEqual(MAX_LIVE_TOOLS);
    };

    note("browsing");
    await registry!.execute("find_providers", {
      specialty: "audiology",
      accommodations: ["wheelchair_accessible"],
    });
    note("browsing_zero_results");
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    note("provider_selected");
    const list = await slots();
    note("availability_fetched");
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    note("slot_held");
    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
    });
    note("intake_complete");
    await cancelOrConfirm();
    note("booked");

    expect(seen["booked"]).toBe(3);
  });

  it("keeps get_booking_state under budget with all 13 tools accounted for", async () => {
    const check = async (label: string) => {
      const result = await getBookingState.run({});
      const size = JSON.stringify(result).length;
      expect(size, `${label} is ${size} chars`).toBeLessThanOrEqual(BUDGET.output);
      const d = (result as { data: { live: object; unavailable: unknown[] } }).data;
      const liveCount = Object.values(d.live).flat().length;
      expect(liveCount + d.unavailable.length).toBe(TOOLS.length);
    };

    await check("browsing");
    await registry!.execute("select_provider", { provider_id: "p01" });
    await check("provider_selected");
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    await check("slot_held");
    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
    });
    await check("intake_complete");
    await cancelOrConfirm();
    await check("booked");
  });

  it("gives every Tier 2 tool a group, a describe() on every field, and an announce", () => {
    for (const name of [
      "explain_no_results",
      "check_coverage",
      "set_companion_constraint",
      "release_slot",
      "cancel_booking",
    ]) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.group, name).toBeTruthy();
      const props = (tool.inputSchema["properties"] ?? {}) as Record<string, { description?: string }>;
      for (const [field, def] of Object.entries(props)) {
        expect(def.description, `${name}.${field}`).toBeTruthy();
      }
      expect(typeof tool.spec.announce).toBe("function");
    }
  });
});
