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
      "explain_capability",
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
    // Scheduling opens; the "what am I looking for" tools give way to the
    // "who is coming and how" ones.
    expect(mc!.log.filter((e) => e.op === "register").map((e) => e.name).sort()).toEqual([
      "get_availability",
      "set_companion_constraint",
      "set_transport_constraint",
    ]);
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name)).toContain(
      "explain_capability",
    );

    mc!.clearLog();
    store().markAvailabilityFetched();
    // Picking times begins: hold_slot arrives, and the pre-scheduling
    // constraint tools step aside.
    expect(mc!.log.filter((e) => e.op === "register").map((e) => e.name)).toEqual(["hold_slot"]);
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name).sort()).toEqual([
      "set_companion_constraint",
      "set_transport_constraint",
    ]);

    mc!.clearLog();
    store().holdSlot({ slotId: "s1", providerId: "p01", expiresAt: Date.now() + HOLD_TTL_MS });
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name).sort()).toEqual([
      "find_providers",
      "select_provider",
    ]);
    expect(mc!.log.filter((e) => e.op === "register").map((e) => e.name).sort()).toEqual([
      "release_slot",
      "set_intake",
      "watch_earlier_slot",
    ]);

    mc!.clearLog();
    store().setIntake({ patient_name: "A", dob: "1990-01-01", reason: "r" });
    // Confirming becomes legal; shopping for an earlier slot stops being
    // offered, which is what keeps the live set at its cap.
    expect(mc!.log.filter((e) => e.op === "register").map((e) => e.name)).toEqual([
      "confirm_booking",
    ]);
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name)).toEqual([
      "watch_earlier_slot",
    ]);
    expect(store().stage).toBe("intake_complete");

    mc!.clearLog();
    store().releaseHold();
    expect(mc!.log.filter((e) => e.op === "unregister").map((e) => e.name).sort()).toEqual([
      "confirm_booking",
      "release_slot",
      "set_intake",
    ]);
    expect(store().stage).toBe("provider_selected");
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
    expect(names()).toEqual([
      "cancel_booking",
      "export_summary",
      "get_booking_state",
      "list_accommodations",
      "reschedule_booking",
    ]);
  });

  it("stays within the cap in the fullest stage — a zero-result search", () => {
    registry = startRegistry(TOOLS);
    // explain_no_results only exists after a search that matched nobody, which
    // is the browsing stage at its most crowded.
    store().recordSearch({
      specialty: "audiology",
      accommodations: ["wheelchair_accessible"],
      result_ids: [],
      total_matches: 0,
      eliminated_by: { accommodations: 3 },
    });
    expect(names()).toContain("explain_no_results");
    expect(names().length).toBeLessThanOrEqual(MAX_LIVE_TOOLS);
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

  it("does not let a concurrent call steal another tool's human mark", async () => {
    registry = startRegistry(TOOLS);

    // Observed live: executeAsHuman marks the next call and then awaits
    // getTools(); a different tool executing during that await consumed the
    // mark and was mislabelled "human". The mark is keyed by tool name so the
    // wrong call cannot claim it.
    setNextActor("human", "list_accommodations");
    await registry.execute("get_booking_state", {});
    expect(store().audit.at(-1)).toMatchObject({
      tool: "get_booking_state",
      actor: "agent",
    });

    await registry.execute("list_accommodations", {});
    expect(store().audit.at(-1)).toMatchObject({
      tool: "list_accommodations",
      actor: "human",
    });
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
      "explain_capability",
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
    // Strip template literals and line comments first: a documentation snippet
    // that *shows* the call is not a call, and HowItWorks.tsx legitimately
    // prints one on the page.
    const stripped = (source: string) =>
      source.replace(/`[^`]*`/g, "``").replace(/\/\/[^\n]*/g, "");

    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$|\/test\/|\/types\//.test(path))
      .filter(([, source]) => /\.registerTool\s*\(/.test(stripped(source)))
      .map(([path]) => path.split("/").at(-1));
    expect(offenders).toEqual(["registry.ts"]);
  });
});
