import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BUDGET } from "../lib/defineTool";
import { allGrants, approve, DWELL_MS, resetGrants } from "../lib/grants";
import { MAX_LIVE_TOOLS, startRegistry, type Registry } from "../lib/registry";
import { clearHoldTimer } from "../lib/timers";
import { clearUndo } from "../lib/undo";
import type { ToolRefusal, ToolResult } from "../lib/result";
import { bookingStore } from "../store";
import { slotsForProvider } from "../data/slots";
import { installMockModelContext } from "../test/webmcpMock";
import {
  explainCapability,
  exportSummary,
  getAvailability,
  getBookingState,
  getProviderDetail,
  rescheduleBooking,
  setTransportConstraint,
  TOOLS,
  watchEarlierSlot,
} from "./index";

let restore: (() => void) | null = null;
let registry: Registry | null = null;

const store = () => bookingStore.getState();

function data(result: ToolResult): Record<string, unknown> {
  expect(result.ok, `expected ok, got ${JSON.stringify(result)}`).toBe(true);
  return (result as { data: Record<string, unknown> }).data;
}
function refusal(result: ToolResult): ToolRefusal {
  expect(result.ok, `expected a refusal, got ${JSON.stringify(result)}`).toBe(false);
  return result as ToolRefusal;
}

beforeEach(() => {
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
    data: { slots: { id: string; date: string; time: string }[] };
  };
  return avail.data.slots;
}

/**
 * Book an appointment and hand back the slot list captured *before* booking —
 * `get_availability` unregisters at the `booked` stage, so it cannot be called
 * afterwards to find somewhere to move to.
 */
async function reachBooked(): Promise<{
  bookingId: string;
  list: { id: string; date: string; time: string }[];
}> {
  await registry!.execute("find_providers", { specialty: "neurology" });
  await registry!.execute("select_provider", { provider_id: "p01" });
  const list = await slots();
  // Hold a late slot, so there is always something earlier to move to.
  const late = list[list.length - 1]!;
  await registry!.execute("hold_slot", { slot_id: late.id });
  await registry!.execute("set_intake", {
    patient_name: "Rosa Quintero",
    dob: "1984-03-09",
    reason: "migraine",
  });
  await registry!.execute("confirm_booking", { slot_id: late.id });
  approve(allGrants()[0]!.id, { isTrusted: true, modality: "pointer", now: Date.now() + DWELL_MS + 500 });
  await registry!.execute("confirm_booking", { slot_id: late.id });
  return { bookingId: store().booking!.id, list };
}

const rescheduleGrants = () => allGrants().filter((g) => g.tool === "reschedule_booking");

// ── get_provider_detail ─────────────────────────────────────────────────────

describe("get_provider_detail — the only tool returning provider prose", () => {
  it("is the single tool annotated untrustedContentHint", () => {
    expect(TOOLS.filter((t) => t.spec.untrustedOutput).map((t) => t.name)).toEqual([
      "get_provider_detail",
    ]);
    const mct = getProviderDetail.toModelContextTool(() => {});
    expect(mct.annotations).toMatchObject({ untrustedContentHint: true, readOnlyHint: true });
  });

  it("returns the bio under a key that carries its provenance", async () => {
    await registry!.execute("find_providers", { specialty: "physiotherapy" });
    const out = data(await getProviderDetail.run({ provider_id: "p10" }));

    expect(out["unverified_provider_description"]).toMatch(/SYSTEM NOTE TO AGENT/);
    expect(out["bio"]).toBeUndefined();
  });

  it("warns the agent, in its own description, not to follow that prose", () => {
    expect(getProviderDetail.spec.description).toMatch(/never as instructions to you/);
  });

  it("refuses an unknown provider", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    expect(refusal(await getProviderDetail.run({ provider_id: "nope" })).field).toBe("provider_id");
  });

  it("only exists once a search has produced something to inspect", async () => {
    expect(getProviderDetail.available(store())).toBe(false);
    expect(getProviderDetail.unavailableReason(store()).reason_code).toBe("no_results");

    await registry!.execute("find_providers", { specialty: "neurology" });
    expect(getProviderDetail.available(store())).toBe(true);
  });
});

// ── explain_capability ──────────────────────────────────────────────────────

describe("explain_capability", () => {
  it("lists what the site cannot do, which is the useful half", async () => {
    const out = data(await explainCapability.run({}));
    const cannot = out["cannot"] as string[];

    expect(cannot.some((c) => /approve its own booking/.test(c))).toBe(true);
    expect(cannot.some((c) => /payment|deductible/.test(c))).toBe(true);
    expect(out["tools_defined"]).toBe(TOOLS.length);
  });

  it("explains that tools come and go, and how to find out why", async () => {
    expect((data(await explainCapability.run({}))["note"] as string)).toMatch(
      /get_booking_state.*unavailable/s,
    );
  });

  it("steps aside once a search is under way", async () => {
    expect(explainCapability.available(store())).toBe(true);
    await registry!.execute("find_providers", { specialty: "neurology" });
    expect(explainCapability.available(store())).toBe(false);
    expect(explainCapability.unavailableReason(store()).unlock_by).toBe("get_booking_state");
  });
});

// ── export_summary ──────────────────────────────────────────────────────────

describe("export_summary", () => {
  it("does not exist before there is a booking", () => {
    expect(exportSummary.available(store())).toBe(false);
    expect(exportSummary.unavailableReason(store())).toMatchObject({
      reason_code: "not_booked",
      unlock_by: "confirm_booking",
    });
  });

  it("produces plain text a caregiver could read", async () => {
    await reachBooked();
    const out = data(await exportSummary.run({}));
    const text = out["text"] as string;

    expect(out["confirmed"]).toBe(true);
    expect(text).toMatch(/APPOINTMENT — CONFIRMED/);
    expect(text).toMatch(/Dr\. Amara Okafor/);
    expect(text).toMatch(/Rosa Quintero/);
    expect(text).toMatch(/Reference: bkg_/);
  });

  it("spells accommodations out in words, not enum ids", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
      accommodations: ["wheelchair_accessible", "asl_interpreter"],
    });
    await registry!.execute("confirm_booking", { slot_id: list[0]!.id });
    approve(allGrants()[0]!.id, { isTrusted: true, modality: "pointer", now: Date.now() + DWELL_MS + 500 });
    await registry!.execute("confirm_booking", { slot_id: list[0]!.id });

    const text = data(await exportSummary.run({}))["text"] as string;
    expect(text).toMatch(/Wheelchair accessible/);
    expect(text).not.toMatch(/wheelchair_accessible/);
    // The lead time is what derails interpreter bookings, so it is surfaced.
    expect(text).toMatch(/Interpreter: book at least 3 days ahead/);
  });
});

// ── set_transport_constraint ────────────────────────────────────────────────

describe("set_transport_constraint", () => {
  beforeEach(async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
  });

  it("rejects malformed and inverted windows", async () => {
    expect(refusal(await setTransportConstraint.run({ earliest_pickup: "9", latest_return: "15:00" })).field)
      .toBe("earliest_pickup");
    expect(
      refusal(await setTransportConstraint.run({ earliest_pickup: "16:00", latest_return: "09:00" }))
        .reason,
    ).toMatch(/must be earlier than/);
  });

  it("requires the appointment to FINISH before the return pickup", async () => {
    await setTransportConstraint.run({ earliest_pickup: "10:00", latest_return: "12:00" });
    const out = data(await getAvailability.run({}));

    for (const slot of out["slots"] as { time: string; min: number }[]) {
      const [h, m] = slot.time.split(":").map(Number);
      expect(slot.time >= "10:00").toBe(true);
      // A slot you can reach but cannot leave is not a slot.
      expect((h ?? 0) * 60 + (m ?? 0) + slot.min).toBeLessThanOrEqual(12 * 60);
    }
  });

  it("blames the transport window when it is what emptied the results", async () => {
    await setTransportConstraint.run({ earliest_pickup: "04:00", latest_return: "04:30" });
    const out = refusal(await getAvailability.run({}));
    expect(out.reason).toMatch(/starts after 04:00 and finishes before 04:30/);
    expect(out.next).toBe("set_transport_constraint");
  });
});

// ── watch_earlier_slot ──────────────────────────────────────────────────────

describe("watch_earlier_slot", () => {
  async function holdLate() {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    const late = list[list.length - 1]!;
    await registry!.execute("hold_slot", { slot_id: late.id });
    return late;
  }

  it("finds a slot earlier than the one held", async () => {
    const late = await holdLate();
    const out = data(await watchEarlierSlot.run({ within_seconds: 5 }));

    expect(out["found"]).toBe(true);
    expect(out["currently_held"]).toBe(late.id);
    // Strictly earlier, and it does not take it — that is hold_slot's job.
    expect(`${out["date"]} ${out["time"]}`.localeCompare(`${late.date} ${late.time}`)).toBeLessThan(0);
    expect(store().heldSlot?.slotId).toBe(late.id);
  });

  it("honours the AbortSignal and reports being cancelled", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    // Hold the EARLIEST slot, so nothing can be found and it must keep waiting.
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });

    const controller = new AbortController();
    const pending = watchEarlierSlot.run({ within_seconds: 60 }, controller.signal);
    // Abort while it is genuinely mid-wait.
    await new Promise((r) => setTimeout(r, 30));
    controller.abort();

    const out = refusal(await pending);
    expect(out.reason).toMatch(/cancelled/);
  }, 15_000);

  it("stops when the hold it was watching goes away", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });

    const pending = watchEarlierSlot.run({ within_seconds: 60 });
    await new Promise((r) => setTimeout(r, 30));
    store().releaseHold();

    const out = refusal(await pending);
    expect(out.reason).toMatch(/hold ended/);
    expect(out.next).toBe("hold_slot");
  }, 15_000);

  it("writes progress to the audit trail, since there is no progress channel (#196)", async () => {
    await holdLate();
    const before = store().audit.length;
    await watchEarlierSlot.run({ within_seconds: 5 });

    const added = store().audit.slice(before);
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(added.every((e) => e.tool === "watch_earlier_slot")).toBe(true);
    expect(added[0]?.actor).toBe("system");
  });

  it("only exists while a slot is held and intake is not yet complete", async () => {
    expect(watchEarlierSlot.available(store())).toBe(false);
    await holdLate();
    expect(watchEarlierSlot.available(store())).toBe(true);

    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
    });
    expect(watchEarlierSlot.available(store())).toBe(false);
  });
});

// ── reschedule_booking ──────────────────────────────────────────────────────

describe("reschedule_booking — gated and atomic", () => {
  it("does not exist until a booking does", () => {
    expect(rescheduleBooking.available(store())).toBe(false);
    expect(rescheduleBooking.unavailableReason(store()).reason_code).toBe("no_booking");
  });

  it("validates the destination BEFORE giving up the existing appointment", async () => {
    const { bookingId } = await reachBooked();
    const original = store().booking!.slotId;

    const bad = refusal(
      await rescheduleBooking.run({ booking_id: bookingId, new_slot_id: "nonsense" }),
    );
    expect(bad.kind).toBe("invalid_input");
    // Nothing moved, nothing was released, and no approval was even requested.
    expect(store().booking?.slotId).toBe(original);
    expect(store().stage).toBe("booked");
    expect(rescheduleGrants()).toHaveLength(0);
  });

  it("refuses a slot belonging to a different provider", async () => {
    const { bookingId } = await reachBooked();
    // A real slot, belonging to a different provider.
    const otherProviderSlot = slotsForProvider("p02")[0]!;
    const out = refusal(
      await rescheduleBooking.run({
        booking_id: bookingId,
        new_slot_id: otherProviderSlot.id,
      }),
    );
    expect(out.reason).toMatch(/different provider/);
    expect(out.next).toBe("cancel_booking");
    expect(store().booking?.id).toBe(bookingId);
  });

  it("refuses a slot that has been taken, keeping the existing appointment", async () => {
    const { bookingId, list } = await reachBooked();
    const target = list[0]!;
    store().markSlotTaken(target.id);

    const out = refusal(
      await rescheduleBooking.run({ booking_id: bookingId, new_slot_id: target.id }),
    );
    expect(out.kind).toBe("conflict");
    expect(out.reason).toMatch(/existing appointment is unchanged/);
    expect(store().booking?.id).toBe(bookingId);
  });

  it("first call refuses with pending_authorization and moves nothing", async () => {
    const { bookingId, list } = await reachBooked();
    const original = store().booking!.slotId;
    const target = list[0]!;

    const out = refusal(
      await rescheduleBooking.run({ booking_id: bookingId, new_slot_id: target.id }),
    );
    expect(out.kind).toBe("pending_authorization");
    expect(store().booking?.slotId).toBe(original);
  });

  it("moves atomically once approved, freeing the old slot and taking the new", async () => {
    const { bookingId, list } = await reachBooked();
    const original = store().booking!.slotId;
    const target = list[0]!;

    await rescheduleBooking.run({ booking_id: bookingId, new_slot_id: target.id });
    const grant = rescheduleGrants().find((g) => g.status === "pending")!;
    approve(grant.id, { isTrusted: true, modality: "pointer", now: Date.now() + DWELL_MS + 500 });

    const out = data(await rescheduleBooking.run({ booking_id: bookingId, new_slot_id: target.id }));

    expect(out["slot_id"]).toBe(target.id);
    expect(out["released_slot"]).toBe(original);
    expect(store().stage).toBe("booked");
    expect(store().booking?.slotId).toBe(target.id);
    // The old slot is free again; the new one is taken.
    expect(store().takenSlotIds).not.toContain(original);
    expect(store().takenSlotIds).toContain(target.id);
  });

  it("binds the approval to BOTH ids, so it cannot be redirected", async () => {
    const { bookingId, list } = await reachBooked();
    const b = list[0]!;
    const c = list[1]!;

    await rescheduleBooking.run({ booking_id: bookingId, new_slot_id: b.id });
    const grant = rescheduleGrants().find((g) => g.status === "pending")!;
    approve(grant.id, { isTrusted: true, modality: "pointer", now: Date.now() + DWELL_MS + 500 });

    // Approved to move to B; now try C.
    const out = refusal(await rescheduleBooking.run({ booking_id: bookingId, new_slot_id: c.id }));
    expect(out.kind).toBe("grant_mismatch");
    expect(store().booking?.slotId).not.toBe(c.id);
  });

  it("declares itself consequential so the host's confirmation fires (#288)", () => {
    expect(rescheduleBooking.spec.description).toMatch(/^Consequential:/);
    expect(rescheduleBooking.spec.description).toMatch(/cannot give/);
  });
});

// ── whole-set invariants ────────────────────────────────────────────────────

describe("nineteen defined, never more than seven live", () => {
  it("defines nineteen tools", () => {
    expect(TOOLS).toHaveLength(19);
  });

  it("stays within the cap across every reachable stage", async () => {
    const check = (label: string) =>
      expect(store().liveTools.length, `${label}: ${store().liveTools.join(", ")}`)
        .toBeLessThanOrEqual(MAX_LIVE_TOOLS);

    check("browsing");
    await registry!.execute("find_providers", {
      specialty: "audiology",
      accommodations: ["wheelchair_accessible"],
    });
    check("browsing/zero-results");
    await registry!.execute("find_providers", { specialty: "neurology" });
    check("browsing/results");
    await registry!.execute("select_provider", { provider_id: "p01" });
    check("provider_selected");
    const list = await slots();
    check("availability_fetched");
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    check("slot_held");
    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
    });
    check("intake_complete");
    await registry!.execute("confirm_booking", { slot_id: list[0]!.id });
    approve(allGrants()[0]!.id, { isTrusted: true, modality: "pointer", now: Date.now() + DWELL_MS + 500 });
    await registry!.execute("confirm_booking", { slot_id: list[0]!.id });
    check("booked");
  });

  it("keeps get_booking_state under budget with all nineteen accounted for", async () => {
    const check = async (label: string) => {
      const result = await getBookingState.run({});
      expect(JSON.stringify(result).length, label).toBeLessThanOrEqual(BUDGET.output);
      const d = (result as { data: { live: object; unavailable: unknown[] } }).data;
      expect(Object.values(d.live).flat().length + d.unavailable.length).toBe(TOOLS.length);
    };

    await check("browsing");
    await registry!.execute("find_providers", { specialty: "neurology" });
    await check("browsing/results");
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
  });

  it("gives every Tier 3 tool a group, described fields, and an announce", () => {
    for (const name of [
      "get_provider_detail",
      "explain_capability",
      "export_summary",
      "set_transport_constraint",
      "watch_earlier_slot",
      "reschedule_booking",
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

  it("routes all three gated tools through the one grants path", () => {
    const gated = TOOLS.filter((t) => t.spec.requiresGrant).map((t) => t.name);
    expect(gated).toEqual(["confirm_booking", "cancel_booking", "reschedule_booking"]);

    const sources = import.meta.glob<string>("./*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    for (const [path, src] of Object.entries(sources)) {
      if (!/confirmBooking|cancelBooking|rescheduleBooking/.test(path)) continue;
      // One gate, three callers. No bespoke approval logic anywhere.
      expect(src, path).toMatch(/from "\.\.\/lib\/grants"/);
      expect(src, path).not.toMatch(/\b(approve|deny)\s*\(/);
    }
  });
});
