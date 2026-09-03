import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { bookingStore, HOLD_TTL_MS } from "../store";
import { installMockModelContext, type MockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";
import { defineTool } from "./defineTool";
import { MAX_LIVE_TOOLS, startRegistry, type Registry } from "./registry";

let restore: (() => void) | null = null;
let registry: Registry | null = null;
let mc: MockModelContext | undefined;

beforeEach(() => {
  bookingStore.getState().reset();
  ({ context: mc, restore } = installMockModelContext(true));
});

afterEach(() => {
  registry?.stop();
  registry = null;
  restore?.();
  restore = null;
  vi.useRealTimers();
});

const names = async () => (await mc!.getTools()).map((t) => t.name);

describe("registry — registration is a function of store state", () => {
  it("registers exactly the browsing-stage tools on start", async () => {
    registry = startRegistry(TOOLS);
    expect(await names()).toEqual([
      "find_providers",
      "get_booking_state",
      "list_accommodations",
      "select_provider",
    ]);
    expect(bookingStore.getState().liveTools).toEqual(await names());
  });

  it("walks the state machine, diffing the live set at every transition", async () => {
    registry = startRegistry(TOOLS);
    const store = bookingStore.getState();

    store.selectProvider("p01");
    expect(await names()).toContain("get_availability");
    expect(await names()).not.toContain("hold_slot");

    store.markAvailabilityFetched();
    expect(await names()).toContain("hold_slot");

    store.holdSlot({ slot_id: "s_p01_x", provider_id: "p01", expires_at: Date.now() + HOLD_TTL_MS });
    expect(await names()).toContain("set_intake");
    expect(await names()).not.toContain("confirm_booking");
    expect(await names()).not.toContain("find_providers");

    store.setIntake({ patient_name: "A", dob: "1990-01-01", reason: "r" });
    expect(bookingStore.getState().stage).toBe("intake_complete");
    expect(await names()).toContain("confirm_booking");

    store.releaseHold("expired");
    expect(await names()).not.toContain("confirm_booking");
    expect(await names()).not.toContain("set_intake");
    expect(await names()).toContain("hold_slot");
  });

  it("never has more than MAX_LIVE_TOOLS live in any stage", async () => {
    registry = startRegistry(TOOLS);
    const store = bookingStore.getState();
    const check = async () => expect((await names()).length).toBeLessThanOrEqual(MAX_LIVE_TOOLS);

    await check();
    store.selectProvider("p01");
    await check();
    store.markAvailabilityFetched();
    await check();
    store.holdSlot({ slot_id: "s", provider_id: "p01", expires_at: Date.now() + HOLD_TTL_MS });
    await check();
    store.setIntake({ patient_name: "A", dob: "1990-01-01", reason: "r" });
    await check();
    store.confirmBooking({ id: "b", slot_id: "s", provider_id: "p01", confirmed_at: 0, intake: {} });
    await check();
    expect(await names()).toEqual(["get_booking_state", "list_accommodations"]);
  });

  it("unregisters by AbortSignal, so the agent sees a toolchange", async () => {
    registry = startRegistry(TOOLS);
    const onChange = vi.fn();
    mc!.addEventListener("toolchange", onChange);

    bookingStore.getState().selectProvider("p01");

    expect(onChange).toHaveBeenCalled();
    expect(await names()).not.toContain("select_provider_placeholder");
  });

  it("unregisters confirm_booking when the hold timer expires", async () => {
    vi.useFakeTimers();
    registry = startRegistry(TOOLS);
    const store = bookingStore.getState();
    store.selectProvider("p01");
    store.markAvailabilityFetched();
    store.setIntake({ patient_name: "A", dob: "1990-01-01", reason: "r" });
    store.holdSlot({ slot_id: "s", provider_id: "p01", expires_at: Date.now() + HOLD_TTL_MS });
    expect(await names()).toContain("confirm_booking");

    vi.advanceTimersByTime(HOLD_TTL_MS + 1);

    expect(await names()).not.toContain("confirm_booking");
    expect(bookingStore.getState().stage).toBe("provider_selected");
    expect(bookingStore.getState().announcements.at(-1)?.text).toMatch(/expired/);
  });

  it("stop() unregisters everything", async () => {
    registry = startRegistry(TOOLS);
    registry.stop();
    registry = null;
    expect(await names()).toEqual([]);
  });

  it("rejects duplicate tool names", () => {
    const dup = defineTool({
      name: "get_booking_state",
      humanLabel: "Dup",
      description: "dup",
      schema: z.object({}),
      annotations: { readOnlyHint: true },
      reversible: false,
      available: () => true,
      execute: () => ({}),
      announce: () => "x",
    });
    expect(() => startRegistry([...TOOLS, dup])).toThrow(/duplicate/);
  });

  it("throws in dev if a stage would exceed MAX_LIVE_TOOLS", () => {
    const extras = Array.from({ length: MAX_LIVE_TOOLS }, (_, i) =>
      defineTool({
        name: `extra_${i}`,
        humanLabel: "Extra",
        description: "extra",
        schema: z.object({}),
        annotations: { readOnlyHint: true },
        reversible: false,
        available: () => true,
        execute: () => ({}),
        announce: () => "x",
      }),
    );
    expect(() => startRegistry([...TOOLS, ...extras])).toThrow(/tools live in stage "browsing"/);
  });
});

describe("registry — without WebMCP", () => {
  it("still tracks the live set locally for the palette fallback", () => {
    restore?.();
    ({ restore } = installMockModelContext(false));

    registry = startRegistry(TOOLS);

    expect(registry.hasModelContext).toBe(false);
    expect(registry.getLiveTools().map((t) => t.name).sort()).toEqual([
      "find_providers",
      "get_booking_state",
      "list_accommodations",
      "select_provider",
    ]);
    expect(bookingStore.getState().liveTools).toHaveLength(4);
  });
});

describe("registry — the only caller of registerTool", () => {
  it("no other production source file calls document.modelContext.registerTool", () => {
    const sources = import.meta.glob<string>("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$|\/test\/|\/types\//.test(path))
      .filter(([, source]) => /\.registerTool\s*\(/.test(source))
      .map(([path]) => path.split("/").at(-1));
    expect(offenders).toEqual(["registry.ts"]);
  });
});
