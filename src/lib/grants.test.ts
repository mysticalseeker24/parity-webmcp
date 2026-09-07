import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allGrants,
  approve,
  AUTOMATION_SUSPICION_MS,
  canonicalJson,
  consume,
  deny,
  DWELL_MS,
  GRANT_TTL_MS,
  hashArgs,
  hostElicitationAvailable,
  mint,
  resetGrants,
  validate,
} from "./grants";
import { startRegistry, type Registry } from "./registry";
import { clearHoldTimer } from "./timers";
import { bookingStore } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";
import { confirmBooking } from "../tools";
import type { ToolRefusal, ToolResult } from "./result";

let restore: (() => void) | null = null;
let registry: Registry | null = null;

const store = () => bookingStore.getState();
const NOW = new Date("2026-09-04T12:00:00Z").getTime();

function refusalOf(result: ToolResult): ToolRefusal {
  expect(result.ok, `expected a refusal, got ${JSON.stringify(result)}`).toBe(false);
  return result as ToolRefusal;
}

/** Reach intake_complete with a real held slot, via the tools. */
async function reachReadyToConfirm(): Promise<string> {
  await registry!.execute("find_providers", { specialty: "neurology" });
  await registry!.execute("select_provider", { provider_id: "p01" });
  const avail = (await registry!.execute("get_availability", {})) as {
    data: { slots: { id: string }[] };
  };
  const slotId = avail.data.slots[0]!.id;
  await registry!.execute("hold_slot", { slot_id: slotId });
  await registry!.execute("set_intake", {
    patient_name: "Rosa Quintero",
    dob: "1984-03-09",
    reason: "migraine",
  });
  return slotId;
}

/** Approve the single pending grant as a real human would, after the dwell. */
function approveAsHuman(id: string, atMs = DWELL_MS + 500) {
  return approve(id, {
    isTrusted: true,
    modality: "pointer",
    pointerType: "mouse",
    now: NOW + atMs,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  clearHoldTimer();
  resetGrants();
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
});

afterEach(() => {
  registry?.stop();
  registry = null;
  clearHoldTimer();
  resetGrants();
  restore?.();
  restore = null;
  expect(vi.getTimerCount(), "a timer leaked past the test").toBe(0);
  vi.useRealTimers();
});

describe("argument hashing", () => {
  it("canonicalises key order, so re-ordered arguments are the same action", async () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: [{ y: 1, x: 2 }] })).toBe('{"z":[{"x":2,"y":1}]}');
    expect(await hashArgs("t", { a: 1, b: 2 })).toBe(await hashArgs("t", { b: 2, a: 1 }));
  });

  it("separates tools, so an approval cannot cross from one tool to another", async () => {
    expect(await hashArgs("confirm_booking", { x: 1 })).not.toBe(
      await hashArgs("cancel_booking", { x: 1 }),
    );
  });

  it("changes when any argument value changes", async () => {
    expect(await hashArgs("t", { slot_id: "a" })).not.toBe(await hashArgs("t", { slot_id: "b" }));
  });
});

// ---------------------------------------------------------------------------
// The invariants. Each is one named test.
// ---------------------------------------------------------------------------

describe("INVARIANT: no tool can approve a grant", () => {
  it("no tool in the catalogue is named like an approval", () => {
    for (const tool of TOOLS) expect(tool.name).not.toMatch(/approve|grant|authori[sz]e/i);
  });

  it("no file under src/tools calls approve() or deny()", () => {
    // Matches a call, not the word: a tool description *should* say the word
    // "approval" — that is how the host's own confirmation is triggered (#288).
    const sources = import.meta.glob<string>("../tools/**/*.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes(".test."))
      .filter(([, src]) => /\b(approve|deny)\s*\(/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("confirm_booking imports only mint, validate and consume from grants.ts", () => {
    const source = Object.entries(
      import.meta.glob<string>("../tools/confirmBooking.ts", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    )[0]![1];

    // [^{}] so the match cannot span from an earlier import statement.
    const importBlock = /import \{([^{}]*)\} from "\.\.\/lib\/grants";/.exec(source);
    expect(importBlock, "confirm_booking must import from lib/grants").not.toBeNull();

    const imported = importBlock![1]!
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .sort();
    expect(imported).toEqual([
      "GRANT_TTL_MS",
      "consume",
      "hostElicitationAvailable",
      "mint",
      "validate",
    ]);
    expect(imported).not.toContain("approve");
    expect(imported).not.toContain("deny");
  });
});

describe("INVARIANT: bound to the action — argument mismatch is refused", () => {
  it("an approval for slot A cannot commit slot B", async () => {
    const slotId = await reachReadyToConfirm();

    // Approve for the real slot.
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);

    // Now try to commit a different slot id.
    const check = await validate("confirm_booking", { slot_id: "s_p01_2026-10-06_0900" }, NOW + 2000);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.failure).toBe("grant_mismatch");
  });

  it("the tool reports grant_mismatch rather than committing", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);

    // Hold a different slot, so its id is the held one, then confirm it.
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    const other = avail.data.slots.find((s) => s.id !== slotId)!;
    await registry!.execute("hold_slot", { slot_id: other.id });

    const result = await confirmBooking.run({ slot_id: other.id });
    expect(refusalOf(result).kind).toBe("grant_mismatch");
    expect(store().booking).toBeNull();
  });
});

describe("INVARIANT: expiring — an expired grant is refused", () => {
  it("validate reports grant_expired after 120 seconds", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);

    const check = await validate("confirm_booking", { slot_id: slotId }, NOW + GRANT_TTL_MS + 1);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.failure).toBe("grant_expired");
  });

  it("the tool refuses with grant_expired and does not silently retry", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);

    vi.setSystemTime(NOW + GRANT_TTL_MS + 1000);
    const result = await confirmBooking.run({ slot_id: slotId });

    expect(refusalOf(result).kind).toBe("grant_expired");
    expect(store().booking).toBeNull();
  });

  it("approving after expiry is rejected", async () => {
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    const outcome = approve(grant.id, {
      isTrusted: true,
      modality: "pointer",
      now: NOW + GRANT_TTL_MS + 1,
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("INVARIANT: consumed once — replay is refused", () => {
  it("a second identical call after a successful commit does not book twice", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);

    const first = await confirmBooking.run({ slot_id: slotId });
    expect(first.ok).toBe(true);
    expect(store().stage).toBe("booked");
    const bookingId = store().booking?.id;

    // Replay the exact same call.
    const second = await confirmBooking.run({ slot_id: slotId });
    expect(second.ok).toBe(false);
    expect(store().booking?.id).toBe(bookingId);
  });

  it("validate reports grant_consumed", async () => {
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    approveAsHuman(grant.id);
    consume(grant.id);
    const check = await validate("confirm_booking", { slot_id: "s1" }, NOW + 2000);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.failure).toBe("grant_consumed");
  });
});

describe("INVARIANT: isTrusted false is rejected", () => {
  it("a synthesised approval event does not approve the grant", async () => {
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    const outcome = approve(grant.id, {
      isTrusted: false,
      modality: "pointer",
      now: NOW + DWELL_MS + 100,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/not user-generated/);
    const check = await validate("confirm_booking", { slot_id: "s1" }, NOW + DWELL_MS + 200);
    expect(check.ok).toBe(false);
  });
});

describe("INVARIANT: the 1.5 s dwell window rejects an instant approval", () => {
  it("approving before the dwell elapses is refused", async () => {
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    const outcome = approve(grant.id, {
      isTrusted: true,
      modality: "pointer",
      now: NOW + DWELL_MS - 1,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/before the control was enabled/);
  });

  it("approving after the dwell succeeds", async () => {
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    expect(approve(grant.id, { isTrusted: true, modality: "pointer", now: NOW + DWELL_MS }).ok).toBe(
      true,
    );
  });
});

describe("#288 detection: fast approvals are flagged, not blocked", () => {
  it("records delta_ms, isTrusted and modality on every approval", async () => {
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    const outcome = approveAsHuman(grant.id, 3000);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.grant.evidence).toMatchObject({
      delta_ms: 3000,
      isTrusted: true,
      modality: "pointer",
      pointerType: "mouse",
      channel: "page_card",
    });
    expect(outcome.grant.evidence?.flag).toBeUndefined();
  });

  it("flags an approval under 800 ms as possibly automated", async () => {
    // Reachable only through host elicitation, which skips the page dwell —
    // exactly the #288 shape where the host completes the human step.
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    const outcome = approve(grant.id, {
      isTrusted: true,
      modality: "host",
      channel: "host_elicitation",
      now: NOW + 340,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.grant.evidence?.delta_ms).toBe(340);
    expect(outcome.grant.evidence?.flag).toBe("possibly_automated");
    expect(AUTOMATION_SUSPICION_MS).toBe(800);
  });

  it("does not flag an approval at the threshold", async () => {
    const grant = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    const outcome = approve(grant.id, {
      isTrusted: true,
      modality: "host",
      channel: "host_elicitation",
      now: NOW + AUTOMATION_SUSPICION_MS,
    });
    expect(outcome.ok && outcome.grant.evidence?.flag).toBeUndefined();
  });
});

describe("PHANTOM TOOL: confirm_booking is not callable when intake is incomplete", () => {
  it("is not registered, so the browser never offers it", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });

    const mc = document.modelContext!;
    const names = (await mc.getTools()).map((t) => t.name);
    expect(names).not.toContain("confirm_booking");
  });

  it("refuses as unavailable with the reason and how to unlock it", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });

    const result = await registry!.execute("confirm_booking", {
      slot_id: avail.data.slots[0]!.id,
    });
    const refusal = refusalOf(result);
    expect(refusal.kind).toBe("unavailable");
    expect(refusal.next).toBe("set_intake");
  });

  it("mints no grant while it is unregistered", async () => {
    await registry!.execute("confirm_booking", { slot_id: "anything" });
    expect(allGrants()).toHaveLength(0);
  });
});

describe("two-phase confirm_booking", () => {
  it("first call mints a grant and refuses with pending_authorization", async () => {
    const slotId = await reachReadyToConfirm();
    const result = await confirmBooking.run({ slot_id: slotId });
    const refusal = refusalOf(result);

    expect(refusal.kind).toBe("pending_authorization");
    expect(refusal.next).toMatch(/approve on the page, then call confirm_booking again/);
    expect(allGrants()).toHaveLength(1);
    expect(allGrants()[0]?.status).toBe("pending");
    expect(store().booking).toBeNull();
  });

  it("a pending grant alone does not commit — it must be approved", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    const second = await confirmBooking.run({ slot_id: slotId });

    // Still pending: the second call re-requests rather than committing.
    expect(second.ok).toBe(false);
    expect(store().booking).toBeNull();
  });

  it("second call after approval commits, consumes and moves to booked", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);

    const result = await confirmBooking.run({ slot_id: slotId });

    expect(result.ok).toBe(true);
    expect(store().stage).toBe("booked");
    expect(store().booking?.slotId).toBe(slotId);
    expect(allGrants()[0]?.status).toBe("consumed");
    expect(store().heldSlot).toBeNull();
  });

  it("a denied grant refuses rather than committing", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    deny(allGrants()[0]!.id);

    const result = await confirmBooking.run({ slot_id: slotId });
    expect(refusalOf(result).reason).toMatch(/declined/);
    expect(store().booking).toBeNull();
  });

  it("refuses with conflict if the slot was taken between hold and confirm", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);

    store().markSlotTaken(slotId);
    const result = await confirmBooking.run({ slot_id: slotId });

    expect(refusalOf(result).kind).toBe("conflict");
    expect(store().booking).toBeNull();
    expect(store().heldSlot).toBeNull();
  });

  it("declares itself consequential so the host's confirmation fires (#288)", () => {
    expect(confirmBooking.spec.description).toMatch(/^Consequential:/);
    expect(confirmBooking.spec.description).toMatch(/cannot give/);
  });

  it("unregisters itself once the booking exists", async () => {
    const slotId = await reachReadyToConfirm();
    await confirmBooking.run({ slot_id: slotId });
    approveAsHuman(allGrants()[0]!.id);
    await confirmBooking.run({ slot_id: slotId });

    const names = (await document.modelContext!.getTools()).map((t) => t.name).sort();
    // cancel_booking takes its place: reversing a booking is its own gated
    // action, not an undo of the one that created it.
    expect(names).toEqual(["cancel_booking", "get_booking_state", "list_accommodations"]);
  });
});

describe("host elicitation (#165)", () => {
  it("is feature-detected, never assumed", () => {
    expect(hostElicitationAvailable()).toBe(false);

    const mc = document.modelContext as unknown as Record<string, unknown>;
    mc["requestUserInteraction"] = () => Promise.resolve();
    expect(hostElicitationAvailable()).toBe(true);
    delete mc["requestUserInteraction"];
  });

  it("names the approval surface in the refusal so the agent tells the truth", async () => {
    const slotId = await reachReadyToConfirm();
    const refusal = refusalOf(await confirmBooking.run({ slot_id: slotId }));
    expect(refusal.reason).toMatch(/must approve this on the page/);
  });
});

describe("grant hygiene", () => {
  it("supersedes an earlier pending grant for the same tool", async () => {
    await mint("confirm_booking", { slot_id: "s1" }, NOW);
    await mint("confirm_booking", { slot_id: "s2" }, NOW);
    expect(allGrants()).toHaveLength(1);
    expect(allGrants()[0]?.args["slot_id"]).toBe("s2");
  });

  it("expires a pending grant on its own timer and leaks nothing", async () => {
    await mint("confirm_booking", { slot_id: "s1" }, NOW);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(GRANT_TTL_MS);
    expect(allGrants()[0]?.status).toBe("expired");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the expiry timer when a grant is consumed or denied", async () => {
    const a = await mint("confirm_booking", { slot_id: "s1" }, NOW);
    approveAsHuman(a.id);
    consume(a.id);
    expect(vi.getTimerCount()).toBe(0);

    const b = await mint("confirm_booking", { slot_id: "s2" }, NOW);
    deny(b.id);
    expect(vi.getTimerCount()).toBe(0);
  });
});
