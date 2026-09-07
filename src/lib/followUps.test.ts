import { describe, expect, it } from "vitest";
import { followUpsFor, type FollowUpTarget } from "./followUps";
import type { FormField } from "./schemaForm";

const field = (name: string, required: boolean): FormField => ({
  name,
  label: name,
  kind: "text",
  required,
  options: [],
  integer: false,
});

const tool = (name: string, fields: FormField[], readOnly = false): FollowUpTarget => ({
  name,
  fields,
  readOnly,
});

const selectProvider = tool("select_provider", [field("provider_id", true)]);
const providerDetail = tool("get_provider_detail", [field("provider_id", true)], true);
const holdSlot = tool("hold_slot", [field("slot_id", true)]);

const PROVIDERS = {
  showing: 2,
  total: 2,
  providers: [
    { id: "p10", name: "Dr. Ana Petrova" },
    { id: "p03", name: "Dr. Fatima El-Amin" },
  ],
};

describe("followUpsFor — what you can do with what a tool returned", () => {
  it("offers every live tool that takes that kind of id", () => {
    const out = followUpsFor(PROVIDERS, [selectProvider, providerDetail, holdSlot]);
    expect(out.map((e) => e.id)).toEqual(["p10", "p03"]);
    expect(out[0]?.label).toBe("Dr. Ana Petrova");
    // hold_slot takes slot_id, so it is not offered for a provider.
    expect(out[0]?.tools.map((t) => t.name)).toEqual(["select_provider", "get_provider_detail"]);
  });

  it("leads with the action that advances the flow, whatever order it arrives in", () => {
    // Read-only lookups are still offered — this is ordering, not a gate.
    const out = followUpsFor(PROVIDERS, [providerDetail, selectProvider]);
    expect(out[0]?.tools.map((t) => t.name)).toEqual(["select_provider", "get_provider_detail"]);
  });

  it("matches the array key to the id field, not a hardcoded list", () => {
    // Nothing in followUps.ts names a domain: a tool invented here is picked up
    // purely because `clinics` singularises to the `clinic_id` it requires.
    const out = followUpsFor(
      { clinics: [{ id: "c1", name: "Northgate" }] },
      [tool("book_clinic", [field("clinic_id", true)])],
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.tools[0]?.name).toBe("book_clinic");
  });

  it("skips a tool that needs more than the id", () => {
    // Pre-filling one field of three would just move the typing elsewhere.
    const out = followUpsFor(PROVIDERS, [
      tool("reschedule", [field("provider_id", true), field("reason", true)]),
    ]);
    expect(out).toEqual([]);
  });

  it("ignores optional extras when deciding a tool is runnable", () => {
    const out = followUpsFor(PROVIDERS, [
      tool("select_provider", [field("provider_id", true), field("note", false)]),
    ]);
    expect(out).toHaveLength(2);
  });

  it("names a slot by its date and time, since a slot has no name", () => {
    const out = followUpsFor(
      { slots: [{ id: "s1", date: "Mon 14 Sep", time: "09:30", min: 45 }] },
      [holdSlot],
    );
    expect(out[0]?.label).toBe("Mon 14 Sep 09:30");
  });

  it("falls back to the id when there is nothing else to call it", () => {
    const out = followUpsFor({ providers: [{ id: "p99" }] }, [selectProvider]);
    expect(out[0]?.label).toBe("p99");
  });

  it("returns nothing for results that are not lists of actionable things", () => {
    expect(followUpsFor({ stage: "browsing", live: [] }, [selectProvider])).toEqual([]);
    expect(followUpsFor({ text: "a summary" }, [selectProvider])).toEqual([]);
    expect(followUpsFor(null, [selectProvider])).toEqual([]);
    expect(followUpsFor(PROVIDERS, [])).toEqual([]);
  });

  it("does not offer a tool that is not live", () => {
    // The live set is the whole gate: an action that is not registered right
    // now must not be reachable from here either.
    expect(followUpsFor(PROVIDERS, [holdSlot])).toEqual([]);
  });

  it("skips entries without a usable string id", () => {
    const out = followUpsFor(
      { providers: [{ name: "no id" }, { id: 7 }, { id: "", name: "empty" }, { id: "p1" }] },
      [selectProvider],
    );
    expect(out.map((e) => e.id)).toEqual(["p1"]);
  });

  it("caps how many it offers so a long result cannot flood the palette", () => {
    const many = { providers: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}` })) };
    expect(followUpsFor(many, [selectProvider]).length).toBeLessThanOrEqual(8);
  });
});
