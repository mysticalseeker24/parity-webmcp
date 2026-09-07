import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAnnouncer, type Announcement } from "./announcer";
import { startRegistry, setNextActor, type Registry } from "./registry";
import { clearHoldTimer } from "./timers";
import { bookingStore, HOLD_TTL_MS } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;
let stop: (() => void) | null = null;
let heard: Announcement[] = [];

const store = () => bookingStore.getState();
const texts = () => heard.map((a) => a.text);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-09-04T12:00:00Z") });
  clearHoldTimer();
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
  heard = [];
  stop = startAnnouncer((a) => heard.push(a));
});

afterEach(() => {
  stop?.();
  stop = null;
  registry?.stop();
  registry = null;
  clearHoldTimer();
  restore?.();
  restore = null;
  vi.useRealTimers();
});

describe("announcer — names the actor on every execution", () => {
  it("says 'Agent' for an unattributed call", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    expect(texts()).toEqual(["Agent found 3 neurology providers."]);
  });

  it("says 'You' for a human-attributed call", async () => {
    setNextActor("human");
    await registry!.execute("find_providers", { specialty: "neurology" });
    expect(texts()[0]).toMatch(/^You found/);
  });

  it("announces an agent action, which is the whole point", async () => {
    // A screen-reader user is told nothing today when an agent fills a form.
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    expect(texts().at(-1)).toBe("Agent selected Dr. Amara Okafor, Neurology.");
  });

  it("takes its wording from the tool's own announce(), not a call site", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    heard = [];
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });
    // A stage change is also announced, so pick out the tool's own line.
    expect(texts().find((t) => t.startsWith("Agent held"))).toMatch(
      /^Agent held \w+day \d+ \w+, \d\d:\d\d, held for 10 minutes\.$/,
    );
  });
});

describe("announcer — politeness", () => {
  it("keeps ordinary results polite", async () => {
    await registry!.execute("list_accommodations", {});
    expect(heard[0]?.politeness).toBe("polite");
  });

  it("sends every refusal to the assertive region", async () => {
    // A refusal is always something the caller must respond to — relax a
    // constraint here, fix a field below.
    await registry!.execute("find_providers", {
      specialty: "audiology",
      accommodations: ["wheelchair_accessible"],
    });
    expect(heard.at(-1)?.politeness).toBe("assertive");

    heard = [];
    await registry!.execute("find_providers", { specialty: "dermatology" });
    expect(heard.at(-1)?.politeness).toBe("assertive");
  });

  it("sends a pending authorization to the assertive region", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });
    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
    });
    heard = [];
    await registry!.execute("confirm_booking", { slot_id: avail.data.slots[0]!.id });

    const assertive = heard.filter((a) => a.politeness === "assertive");
    expect(assertive.length).toBeGreaterThan(0);
    expect(assertive[0]?.text).toMatch(/approval/i);
  });
});

describe("announcer — tool disappearance (#262)", () => {
  it("says why a command left the palette, using the reasons table", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });
    await registry!.execute("set_intake", {
      patient_name: "Rosa Quintero",
      dob: "1984-03-09",
      reason: "migraine",
    });
    heard = [];

    vi.advanceTimersByTime(HOLD_TTL_MS);

    // The same context the agent gets from unavailable[], spoken.
    expect(texts()).toContain("Confirm booking is no longer available: the hold on the slot expired.");
    expect(texts()).toContain("Fill in intake is no longer available: the hold on the slot expired.");
  });

  it("announces the hold expiring as an interruption", () => {
    store().selectProvider("p01");
    store().markAvailabilityFetched();
    store().holdSlot({ slotId: "s1", providerId: "p01", expiresAt: Date.now() + 1000 });
    heard = [];

    store().appendAudit({
      id: "a_sys",
      at: Date.now(),
      tool: "system",
      actor: "system",
      input: {},
      result: { reason_code: "hold_expired" },
    });

    expect(heard.at(-1)).toEqual({
      text: "The hold on the slot expired.",
      politeness: "assertive",
    });
  });

  it("says nothing about tools that merely became available", () => {
    heard = [];
    store().selectProvider("p01");
    // get_availability arrived. Announcing arrivals would narrate the whole
    // registry at every step; only departures need explaining (#262).
    expect(texts().filter((t) => /no longer available/.test(t))).toEqual([]);
    expect(texts()).toEqual(["Now pick a time from the availability grid."]);
  });
});

describe("announcer — robustness", () => {
  it("survives a tool whose announce() throws", async () => {
    const tool = registry!.getTool("list_accommodations")!;
    const spy = vi.spyOn(tool.spec, "announce").mockImplementation(() => {
      throw new Error("bad announce");
    });
    await registry!.execute("list_accommodations", {});
    expect(texts()).toEqual([]);
    spy.mockRestore();
  });

  it("unsubscribes cleanly", async () => {
    stop?.();
    stop = null;
    await registry!.execute("list_accommodations", {});
    expect(texts()).toEqual([]);
  });
});
