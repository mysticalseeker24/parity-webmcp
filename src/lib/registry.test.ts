import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { bookingStore, HOLD_TTL_MS } from "../store";
import { installMockModelContext, type MockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";
import { defineTool } from "./defineTool";
import { ok } from "./result";
import { MAX_LIVE_TOOLS, setNextActor, startRegistry, type Registry } from "./registry";

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
});

const names = () => [...(mc?.toolNames ?? [])].sort();
const store = () => bookingStore.getState();

/** Move to provider_selected + availability fetched, without running tools. */
function reachAvailability() {
  store().selectProvider("p01");
  store().markAvailabilityFetched();
}

describe("registry — the live set is a pure function of state", () => {
  it("registers exactly the browsing-stage tools on start", () => {
    registry = startRegistry(TOOLS);
    expect(names()).toEqual([
      "find_providers",
      "get_booking_state",
      "list_accommodations",
      "select_provider",
    ]);
    expect([...store().liveTools]).toEqual(names());
  });

  it("adds and removes exactly the expected tools at each transition", () => {
    registry = startRegistry(TOOLS);

    mc!.clearLog();
    store().selectProvider("p01");
    expect(mc!.log).toEqual([{ op: "register", name: "get_availability" }]);

    mc!.clearLog();
    store().markAvailabilityFetched();
    expect(mc!.log).toEqual([{ op: "register", name: "hold_slot" }]);

    mc!.clearLog();
    store().holdSlot({ slotId: "s1", providerId: "p01", expiresAt: Date.now() + HOLD_TTL_MS });
    // find_providers and select_provider leave; set_intake arrives.
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name).sort()).toEqual([
      "find_providers",
      "select_provider",
    ]);
    expect(mc!.log.filter((e) => e.op === "register").map((e) => e.name)).toEqual(["set_intake"]);

    mc!.clearLog();
    store().setIntake({ patient_name: "A", dob: "1990-01-01", reason: "r" });
    expect(mc!.log).toEqual([{ op: "register", name: "confirm_booking" }]);
    expect(store().stage).toBe("intake_complete");

    mc!.clearLog();
    store().releaseHold();
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name).sort()).toEqual([
      "confirm_booking",
      "set_intake",
    ]);
  });

  it("does not churn tools that stay live across a transition", () => {
    registry = startRegistry(TOOLS);
    mc!.clearLog();
    store().selectProvider("p01");
    // get_booking_state and list_accommodations are live before and after; a
    // registry that rebuilt the whole set would show them here.
    expect(mc!.log.map((e) => e.name)).not.toContain("get_booking_state");
    expect(mc!.log.map((e) => e.name)).not.toContain("list_accommodations");
  });

  it("never exceeds MAX_LIVE_TOOLS in any stage", () => {
    registry = startRegistry(TOOLS);
    const check = () => expect(names().length).toBeLessThanOrEqual(MAX_LIVE_TOOLS);

    check();
    store().selectProvider("p01");
    check();
    store().markAvailabilityFetched();
    check();
    store().holdSlot({ slotId: "s1", providerId: "p01", expiresAt: Date.now() + HOLD_TTL_MS });
    check();
    store().setIntake({ patient_name: "A", dob: "1990-01-01", reason: "r" });
    check();
    store().confirmBooking({
      id: "b1",
      slotId: "s1",
      providerId: "p01",
      confirmedAt: 0,
      intake: {},
    });
    check();
    expect(names()).toEqual(["get_booking_state", "list_accommodations"]);
  });

  it("fires toolchange so the agent and the palette see the same diff", () => {
    registry = startRegistry(TOOLS);
    const onChange = vi.fn();
    mc!.addEventListener("toolchange", onChange);
    store().selectProvider("p01");
    expect(onChange).toHaveBeenCalled();
  });

  it("stop() unregisters everything", () => {
    registry = startRegistry(TOOLS);
    registry.stop();
    registry = null;
    expect(names()).toEqual([]);
  });

  it("rejects duplicate tool names", () => {
    const dup = defineTool({
      name: "get_booking_state",
      humanLabel: "Dup",
      group: "orient",
      description: "dup",
      schema: z.object({}),
      available: () => true,
      unavailableReason: () => ({ reason_code: "x", reason: "x", unlock_by: "" }),
      execute: () => ok({}, "x"),
      announce: () => "x",
    });
    expect(() => startRegistry([...TOOLS, dup])).toThrow(/duplicate/);
  });

  it("throws in dev if a stage would exceed MAX_LIVE_TOOLS", () => {
    const extras = Array.from({ length: MAX_LIVE_TOOLS }, (_, i) =>
      defineTool({
        name: `extra_${i}`,
        humanLabel: "Extra",
        group: "manage",
        description: "extra",
        schema: z.object({}),
        available: () => true,
        unavailableReason: () => ({ reason_code: "x", reason: "x", unlock_by: "" }),
        execute: () => ok({}, "x"),
        announce: () => "x",
      }),
    );
    expect(() => startRegistry([...TOOLS, ...extras])).toThrow(/tools live in stage "browsing"/);
  });
});

describe("registry — audit and actor attribution", () => {
  it("defaults the actor to agent", async () => {
    registry = startRegistry(TOOLS);
    await registry.execute("get_booking_state", {});
    expect(store().audit.at(-1)).toMatchObject({ tool: "get_booking_state", actor: "agent" });
  });

  it("setNextActor('human') applies to exactly one call, then resets", async () => {
    registry = startRegistry(TOOLS);
    setNextActor("human");
    await registry.execute("get_booking_state", {});
    await registry.execute("get_booking_state", {});
    const [first, second] = store().audit;
    expect(first?.actor).toBe("human");
    expect(second?.actor).toBe("agent");
  });

  it("records the input and the envelope for every call", async () => {
    registry = startRegistry(TOOLS);
    await registry.execute("find_providers", { specialty: "neurology" });
    const entry = store().audit.at(-1);
    expect(entry?.input).toEqual({ specialty: "neurology" });
    expect(entry?.result).toMatchObject({ ok: true });
  });

  it("attributes a call arriving through the browser, and audits it", async () => {
    registry = startRegistry(TOOLS);
    const tool = (await mc!.getTools()).find((t) => t.name === "get_booking_state")!;
    setNextActor("human");
    await mc!.executeTool(tool, "{}");
    expect(store().audit.at(-1)).toMatchObject({ tool: "get_booking_state", actor: "human" });
  });

  it("refuses an unregistered tool with its unavailable reason", async () => {
    registry = startRegistry(TOOLS);
    const result = await registry.execute("confirm_booking", { slot_id: "s1" });
    expect(result).toMatchObject({ ok: false, kind: "unavailable", next: "hold_slot" });
  });
});

describe("registry — without WebMCP", () => {
  it("maintains the same live set locally for the palette fallback", () => {
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

    reachAvailability();
    expect(registry.getLiveTools().map((t) => t.name)).toContain("hold_slot");
  });

  it("still executes and audits without a browser registry", async () => {
    restore?.();
    ({ restore } = installMockModelContext(false));
    registry = startRegistry(TOOLS);

    const result = await registry.execute("list_accommodations", {});
    expect(result).toMatchObject({ ok: true });
    expect(store().audit).toHaveLength(1);
  });
});

describe("registry — the only caller of registerTool (CONVENTIONS.md §3)", () => {
  it("no other production source file calls registerTool", () => {
    const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$|\/test\/|\/types\//.test(path))
      .filter(([, source]) => /\.registerTool\s*\(/.test(source))
      .map(([path]) => path.split("/").at(-1));
    expect(offenders).toEqual(["registry.ts"]);
  });
});
