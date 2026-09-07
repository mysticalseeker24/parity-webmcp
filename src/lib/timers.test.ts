import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingStore, HOLD_TTL_MS } from "../store";
import { installMockModelContext, type MockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";
import { getAvailability, holdSlot, selectProvider, setIntake } from "../tools";
import { startRegistry, type Registry } from "./registry";
import { armedFor, clearHoldTimer, startHoldTimer } from "./timers";

let restore: (() => void) | null = null;
let registry: Registry | null = null;
let mc: MockModelContext | undefined;

const store = () => bookingStore.getState();
const names = () => [...(mc?.toolNames ?? [])].sort();

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-09-04T12:00:00Z") });
  clearHoldTimer();
  bookingStore.getState().reset();
  ({ context: mc, restore } = installMockModelContext(true));
});

afterEach(() => {
  registry?.stop();
  registry = null;
  clearHoldTimer();
  restore?.();
  restore = null;
  // Fails the test if any timer outlived it — a leaked hold timer would
  // unregister confirm_booking in the middle of the demo.
  expect(vi.getTimerCount(), "a timer leaked past the test").toBe(0);
  vi.useRealTimers();
});

/** Hold a real slot through the tools, as an agent would. */
async function holdRealSlot() {
  await selectProvider.run({ provider_id: "p01" });
  const avail = await getAvailability.run({});
  const slots = (avail as { data: { slots: { id: string }[] } }).data.slots;
  await holdSlot.run({ slot_id: slots[0]!.id });
  return slots;
}

describe("hold expiry", () => {
  it("arms one timer for the held slot", async () => {
    await holdRealSlot();
    expect(armedFor()).toBe(store().heldSlot?.slotId);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("clears the hold and returns to provider_selected after 10 minutes", async () => {
    await holdRealSlot();
    expect(store().stage).toBe("slot_held");

    vi.advanceTimersByTime(HOLD_TTL_MS);

    expect(store().heldSlot).toBeNull();
    expect(store().stage).toBe("provider_selected");
    expect(store().holdExpired).toBe(true);
    expect(armedFor()).toBeNull();
  });

  it("does not fire early", async () => {
    await holdRealSlot();
    vi.advanceTimersByTime(HOLD_TTL_MS - 1);
    expect(store().heldSlot).not.toBeNull();
  });

  it("records a system audit entry with reason_code hold_expired", async () => {
    await holdRealSlot();
    vi.advanceTimersByTime(HOLD_TTL_MS);

    const entry = store().audit.at(-1);
    expect(entry).toMatchObject({ tool: "system", actor: "system" });
    expect(entry?.result).toEqual({ reason_code: "hold_expired" });
  });

  it("replaces the timer when a different slot is held — no double expiry", async () => {
    const slots = await holdRealSlot();
    vi.advanceTimersByTime(60_000);
    await holdSlot.run({ slot_id: slots[1]!.id });

    expect(vi.getTimerCount()).toBe(1);
    expect(armedFor()).toBe(slots[1]!.id);

    // The first hold's original deadline passes; the second must survive it.
    vi.advanceTimersByTime(HOLD_TTL_MS - 60_000);
    expect(store().heldSlot?.slotId).toBe(slots[1]!.id);

    vi.advanceTimersByTime(60_000);
    expect(store().heldSlot).toBeNull();
  });

  it("re-holding the same slot does not stack timers", async () => {
    const slots = await holdRealSlot();
    await holdSlot.run({ slot_id: slots[0]!.id });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("does nothing if the hold was already released", async () => {
    await holdRealSlot();
    store().releaseHold();
    const auditBefore = store().audit.length;

    vi.advanceTimersByTime(HOLD_TTL_MS);

    expect(store().audit).toHaveLength(auditBefore);
    expect(store().holdExpired).toBe(false);
  });

  it("clearHoldTimer stops a pending expiry", async () => {
    await holdRealSlot();
    clearHoldTimer();
    vi.advanceTimersByTime(HOLD_TTL_MS);
    expect(store().heldSlot).not.toBeNull();
  });

  it("ignores a stale timer whose slot is no longer held", () => {
    startHoldTimer("s_ghost", Date.now() + 1000);
    vi.advanceTimersByTime(2000);
    expect(store().audit).toHaveLength(0);
  });
});

describe("expiry, seen from both surfaces", () => {
  it("unregisters confirm_booking and set_intake when the hold expires", async () => {
    registry = startRegistry(TOOLS);
    await holdRealSlot();
    await setIntake.run({ patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine" });
    expect(names()).toContain("confirm_booking");

    mc!.clearLog();
    vi.advanceTimersByTime(HOLD_TTL_MS);

    expect(names()).not.toContain("confirm_booking");
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name).sort()).toEqual([
      "confirm_booking",
      "release_slot",
      "set_intake",
    ]);
  });

  it("records why each tool left, for the announcer to read (#262)", async () => {
    registry = startRegistry(TOOLS);
    await holdRealSlot();
    await setIntake.run({ patient_name: "Rosa Quintero", dob: "1984-03-09", reason: "migraine" });

    vi.advanceTimersByTime(HOLD_TTL_MS);

    const change = store().lastToolChange;
    const confirm = change?.removed.find((r) => r.tool === "confirm_booking");
    expect(confirm).toMatchObject({
      reason_code: "hold_expired",
      unlock_by: "hold_slot",
    });
    expect(confirm?.reason).toBe("The hold on the slot expired.");
    // The browsing-stage tools come back once the hold is gone.
    // find_providers and select_provider return; the companion and transport
    // tools do not, because availability has already been fetched for this
    // provider and those are set before times are picked.
    expect([...(change?.added ?? [])].sort()).toEqual(["find_providers", "select_provider"]);
  });

  it("distinguishes an expired hold from one that never existed", async () => {
    registry = startRegistry(TOOLS);

    const beforeAnyHold = TOOLS.find((t) => t.name === "confirm_booking")!.unavailableReason(store());
    expect(beforeAnyHold.reason_code).toBe("no_hold");

    await holdRealSlot();
    vi.advanceTimersByTime(HOLD_TTL_MS);

    const afterExpiry = TOOLS.find((t) => t.name === "confirm_booking")!.unavailableReason(store());
    expect(afterExpiry.reason_code).toBe("hold_expired");
  });
});
