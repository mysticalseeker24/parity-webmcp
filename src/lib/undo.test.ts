import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearUndo,
  isReversible,
  peekUndo,
  performUndo,
  undoDepth,
} from "./undo";
import { startRegistry, type Registry } from "./registry";
import { clearHoldTimer } from "./timers";
import { resetGrants } from "./grants";
import { bookingStore, HOLD_TTL_MS } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;

const store = () => bookingStore.getState();
const NOW = new Date("2026-09-04T12:00:00Z").getTime();

async function slots() {
  const avail = (await registry!.execute("get_availability", {})) as {
    data: { slots: { id: string }[] };
  };
  return avail.data.slots;
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
  expect(vi.getTimerCount(), "a timer leaked past the test").toBe(0);
  vi.useRealTimers();
});

describe("what is undoable", () => {
  it("covers exactly the reversible tools", () => {
    expect(isReversible("select_provider")).toBe(true);
    expect(isReversible("hold_slot")).toBe(true);
    expect(isReversible("set_intake")).toBe(true);
  });

  it("never covers a gated tool — confirm_booking is not undoable", async () => {
    expect(isReversible("confirm_booking")).toBe(false);
    expect(isReversible("cancel_booking")).toBe(false);

    // And the whole flow, end to end: nothing pushes an undo for the commit.
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
    });
    await registry!.execute("confirm_booking", { slot_id: list[0]!.id });

    expect(peekUndo()?.tool).not.toBe("confirm_booking");
  });

  it("does not record read-only tools", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("list_accommodations", {});
    expect(undoDepth()).toBe(0);
  });

  it("does not record a refused call, which changed nothing", async () => {
    await registry!.execute("find_providers", {
      specialty: "neurology",
      accommodations: ["asl_interpreter"],
    });
    // p02 lacks ASL, so select_provider refuses.
    await registry!.execute("select_provider", { provider_id: "p02" });
    expect(undoDepth()).toBe(0);
  });

  it("does not record an idempotent re-hold, which the user cannot perceive", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    const depth = undoDepth();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    expect(undoDepth()).toBe(depth);
  });
});

describe("undo inverses", () => {
  it("select_provider: restores the previous provider and stage", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    expect(store().stage).toBe("provider_selected");

    expect(performUndo().ok).toBe(true);

    expect(store().selectedProviderId).toBeNull();
    expect(store().stage).toBe("browsing");
  });

  it("hold_slot: releases the hold and returns to provider_selected", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    expect(store().stage).toBe("slot_held");

    expect(performUndo().ok).toBe(true);

    expect(store().heldSlot).toBeNull();
    expect(store().stage).toBe("provider_selected");
    // And the hold timer went with it, rather than firing on a dead hold.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("hold_slot: undoing a replacement restores the FIRST hold and its timer", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    vi.advanceTimersByTime(60_000);
    await registry!.execute("hold_slot", { slot_id: list[1]!.id });

    expect(performUndo().ok).toBe(true);

    expect(store().heldSlot?.slotId).toBe(list[0]!.id);
    // Exactly one timer, armed for the restored hold's original deadline.
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(HOLD_TTL_MS);
    expect(store().heldSlot).toBeNull();
  });

  it("set_intake: restores the previous intake, not a blank one", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    await registry!.execute("set_intake", { patient_name: "Rosa Quintero" });
    await registry!.execute("set_intake", { dob: "1984-03-09", reason: "migraine" });
    expect(store().stage).toBe("intake_complete");

    expect(performUndo().ok).toBe(true);

    // set_intake merges, so its inverse is the intake as it was — not "unset".
    expect(store().intake.patient_name).toBe("Rosa Quintero");
    expect(store().intake.dob).toBeUndefined();
    expect(store().stage).toBe("slot_held");
  });

  it("unwinds several steps in order", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const list = await slots();
    await registry!.execute("hold_slot", { slot_id: list[0]!.id });
    expect(undoDepth()).toBe(2);

    performUndo();
    expect(store().stage).toBe("provider_selected");
    performUndo();
    expect(store().stage).toBe("browsing");
    expect(performUndo().ok).toBe(false);
  });
});

describe("undo is itself audited and announced", () => {
  it("appends an audit entry attributed to the human", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    const before = store().audit.length;

    performUndo();

    const entry = store().audit.at(-1);
    expect(store().audit.length).toBe(before + 1);
    expect(entry).toMatchObject({ tool: "undo", actor: "human" });
    expect(entry?.input).toEqual({ tool: "select_provider" });
  });

  it("carries a human-readable label", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    expect(peekUndo()?.label).toBe("Undo choosing a provider");
    const outcome = performUndo();
    expect(outcome.ok && outcome.label).toBe("Undo choosing a provider");
  });
});

describe("undo captures an agent's action too", () => {
  it("records an inverse when the agent acts through the browser", async () => {
    const mc = document.modelContext!;
    const tool = (await mc.getTools()).find((t) => t.name === "select_provider")!;

    await mc.executeTool(tool, JSON.stringify({ provider_id: "p01" }));

    expect(store().selectedProviderId).toBe("p01");
    // The human must be able to undo what the agent did — that is the point.
    expect(peekUndo()?.tool).toBe("select_provider");
    expect(performUndo().ok).toBe(true);
    expect(store().selectedProviderId).toBeNull();
  });
});
