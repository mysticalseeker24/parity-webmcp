import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { bookingStore } from "../store";
import { TOOLS } from "../tools";
import { BUDGET, defineTool, type ToolSpec } from "./defineTool";
import { isOk, isRefusal, ok, refuse } from "./result";

beforeEach(() => bookingStore.getState().reset());

const base = {
  humanLabel: "Echo",
  group: "orient" as const,
  available: () => true,
  unavailableReason: () => ({ reason_code: "x", reason: "x", unlock_by: "y" }),
  announce: () => "echoed.",
};

const echo = defineTool({
  ...base,
  name: "echo_test",
  description: "Echo the input back.",
  schema: z.object({
    text: z.string().describe("Text to echo"),
    mode: z.enum(["loud", "quiet"]).default("quiet").describe("How to echo it"),
  }),
  readOnly: true,
  execute: (input) => {
    if (input.text === "throw") throw new Error("boom at E:/secret/internal/path.ts:12");
    if (input.text === "no") return refuse("refused", "text cannot be 'no'", { field: "text" });
    return ok({ echoed: input.mode === "loud" ? input.text.toUpperCase() : input.text }, "Echoed.");
  },
});

describe("every Tier 1 tool round-trips through z.toJSONSchema", () => {
  it.each(TOOLS.map((t) => [t.name, t] as const))("%s", (_name, tool) => {
    const schema = tool.inputSchema;
    // The browser has no use for $schema, and $ref would need flattening.
    expect(schema).not.toHaveProperty("$schema");
    expect(JSON.stringify(schema)).not.toContain("$ref");
    expect(schema["type"]).toBe("object");
    expect(schema["additionalProperties"]).toBe(false);

    // #286: the palette builds its form label from .describe(), so a missing
    // one would render an unlabelled input.
    const properties = (schema["properties"] ?? {}) as Record<string, { description?: string }>;
    for (const [field, def] of Object.entries(properties)) {
      expect(def.description, `${tool.name}.${field} needs .describe()`).toBeTruthy();
      expect(def.description!.length).toBeLessThanOrEqual(BUDGET.paramDescription);
    }
  });

  it("does not advertise defaulted fields as required", () => {
    const schema = TOOLS.find((t) => t.name === "get_availability")!.inputSchema;
    // time_of_day and duration_min both carry .default(); neither is required.
    expect(schema["required"]).toBeUndefined();
  });

  it("emits enums the agent is structurally constrained by (#239)", () => {
    const schema = TOOLS.find((t) => t.name === "find_providers")!.inputSchema;
    const properties = schema["properties"] as Record<string, Record<string, unknown>>;
    expect(properties["specialty"]!["enum"]).toEqual([
      "neurology",
      "rheumatology",
      "audiology",
      "physiotherapy",
    ]);
  });

  it("carries an honest annotation pair and a group on every tool", () => {
    for (const tool of TOOLS) {
      const mct = tool.toModelContextTool(() => {});
      expect(mct.annotations).toEqual({
        readOnlyHint: tool.spec.readOnly ?? false,
        untrustedContentHint: tool.spec.untrustedOutput ?? false,
      });
      expect(["orient", "search", "schedule", "intake", "commit", "manage"]).toContain(tool.group);
    }
  });
});

describe("budget assertions fire at definition time", () => {
  const oversized = (overrides: Partial<ToolSpec<z.ZodObject, never>>) =>
    defineTool({
      ...base,
      name: "ok_name",
      description: "ok",
      schema: z.object({}),
      execute: () => ok({}, "x"),
      ...overrides,
    } as Parameters<typeof defineTool>[0]);

  it("rejects a tool name over 30 characters", () => {
    expect(() => oversized({ name: "a".repeat(BUDGET.toolName + 1) })).toThrow(/tool name/);
  });

  it("rejects a non-snake_case name", () => {
    expect(() => oversized({ name: "GetThing" })).toThrow(/snake_case/);
  });

  it("rejects a description over 500 characters", () => {
    expect(() => oversized({ description: "d".repeat(BUDGET.toolDescription + 1) })).toThrow(
      /description is 501 characters/,
    );
  });

  it("rejects a parameter with no .describe()", () => {
    expect(() => oversized({ schema: z.object({ slot_id: z.string() }) })).toThrow(
      /needs \.describe\(\)/,
    );
  });

  it("rejects a parameter description over 150 characters", () => {
    expect(() =>
      oversized({ schema: z.object({ slot_id: z.string().describe("p".repeat(151)) }) }),
    ).toThrow(/description is 151 characters/);
  });

  it("rejects a parameter name over 30 characters", () => {
    expect(() =>
      oversized({ schema: z.object({ ["p".repeat(31)]: z.string().describe("ok") }) }),
    ).toThrow(/name is 31 characters/);
  });

  it("fires on oversized output at run time", async () => {
    const big = defineTool({
      ...base,
      name: "big_output",
      description: "ok",
      schema: z.object({}),
      execute: () => ok({ blob: "x".repeat(BUDGET.output) }, "big"),
    });
    await expect(big.run({})).rejects.toThrow(/output is \d+ characters/);
  });
});

describe("the ToolResult envelope (#282)", () => {
  it("returns ok:true with data and a human summary on success", async () => {
    const result = await echo.run({ text: "hi" });
    expect(result).toEqual({ ok: true, data: { echoed: "hi" }, human_summary: "Echoed." });
    expect(isOk(result)).toBe(true);
  });

  it("applies schema defaults before execute sees the input", async () => {
    expect(await echo.run({ text: "hi", mode: "loud" })).toMatchObject({ data: { echoed: "HI" } });
  });

  it("returns invalid_input naming the field, with a valid example", async () => {
    const result = await echo.run({ text: 42 });
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.kind).toBe("invalid_input");
      expect(result.field).toBe("text");
      expect(result.reason).toMatch(/Valid: "text"/);
    }
  });

  it("shows the enum members as the example when a field is an enum", async () => {
    const result = await echo.run({ text: "hi", mode: "shout" });
    expect(isRefusal(result) && result.field).toBe("mode");
    expect(isRefusal(result) && result.reason).toMatch(/"loud", "quiet"/);
  });

  it("passes a returned refusal through unchanged — it fulfils, never throws", async () => {
    const result = await echo.run({ text: "no" });
    expect(result).toEqual({ ok: false, kind: "refused", reason: "text cannot be 'no'", field: "text" });
  });

  it("turns a thrown defect into a clean refusal with no path or stack", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await echo.run({ text: "throw" });
    expect(isRefusal(result)).toBe(true);
    if (isRefusal(result)) {
      expect(result.reason).not.toMatch(/secret|internal|\.ts|[A-Z]:\//);
      expect(result.reason).toMatch(/^Echo failed:/);
    }
    spy.mockRestore();
  });

  it("refuses rather than returning a non-envelope value", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rogue = defineTool({
      ...base,
      name: "rogue_tool",
      description: "ok",
      schema: z.object({}),
      execute: () => ({ whatever: true }) as never,
    });
    expect(await rogue.run({})).toMatchObject({ ok: false, kind: "refused" });
    spy.mockRestore();
  });

  it("treats undefined input as {} so no-argument tools work", async () => {
    const noArgs = defineTool({
      ...base,
      name: "no_args",
      description: "ok",
      schema: z.object({}),
      execute: () => ok({ fine: true }, "fine"),
    });
    expect(await noArgs.run(undefined)).toMatchObject({ ok: true });
  });
});
