import { beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";
import { bookingStore } from "../store";
import { BUDGET, defineTool, isToolError, markNextCallAs } from "./defineTool";

beforeEach(() => bookingStore.getState().reset());

const echo = defineTool({
  name: "echo_test",
  humanLabel: "Echo",
  description: "Echo the input back.",
  schema: z.object({
    text: z.string().describe("Text to echo."),
    mode: z.enum(["loud", "quiet"]).default("quiet").describe("How to echo."),
  }),
  annotations: { readOnlyHint: true },
  reversible: false,
  available: () => true,
  execute: (input) => {
    if (input.text === "throw") throw new Error("boom\n    at secret/internal/path.ts:12");
    if (input.text === "fail") return { error: "text cannot be 'fail'", field: "text" };
    return { echoed: input.mode === "loud" ? input.text.toUpperCase() : input.text };
  },
  announce: (_input, result) => `echoed "${result.echoed}".`,
});

describe("defineTool — JSON Schema", () => {
  it("derives inputSchema from the Zod schema with no $schema key", () => {
    expect(echo.inputSchema).not.toHaveProperty("$schema");
    expect(echo.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        text: { type: "string", description: "Text to echo." },
        mode: { type: "string", enum: ["loud", "quiet"], description: "How to echo." },
      },
    });
    expect(JSON.stringify(echo.inputSchema)).not.toContain("$ref");
  });

  it("hands the same schema, title and honest annotations to WebMCP", () => {
    const mct = echo.toModelContextTool();
    expect(mct.name).toBe("echo_test");
    expect(mct.title).toBe("Echo");
    expect(mct.inputSchema).toBe(echo.inputSchema);
    expect(mct.annotations).toEqual({ readOnlyHint: true, untrustedContentHint: false });
  });
});

describe("defineTool — character budgets", () => {
  const base = {
    humanLabel: "X",
    annotations: { readOnlyHint: true },
    reversible: false,
    available: () => true,
    execute: () => ({}),
    announce: () => "did x.",
  };

  it("rejects a tool name over 30 chars", () => {
    expect(() =>
      defineTool({ ...base, name: "a".repeat(BUDGET.toolName + 1), description: "ok", schema: z.object({}) }),
    ).toThrow(/tool name/);
  });

  it("rejects a non-snake_case name", () => {
    expect(() => defineTool({ ...base, name: "GetThing", description: "ok", schema: z.object({}) })).toThrow(
      /snake_case/,
    );
  });

  it("rejects a description over 500 chars", () => {
    expect(() =>
      defineTool({ ...base, name: "ok_name", description: "d".repeat(BUDGET.toolDescription + 1), schema: z.object({}) }),
    ).toThrow(/description is 501/);
  });

  it("rejects a parameter with no .describe()", () => {
    expect(() =>
      defineTool({ ...base, name: "ok_name", description: "ok", schema: z.object({ slot_id: z.string() }) }),
    ).toThrow(/needs \.describe\(\)/);
  });

  it("rejects a parameter description over 150 chars", () => {
    expect(() =>
      defineTool({
        ...base,
        name: "ok_name",
        description: "ok",
        schema: z.object({ slot_id: z.string().describe("p".repeat(BUDGET.paramDescription + 1)) }),
      }),
    ).toThrow(/slot_id: description is 151/);
  });

  it("rejects a parameter name over 30 chars", () => {
    expect(() =>
      defineTool({
        ...base,
        name: "ok_name",
        description: "ok",
        schema: z.object({ ["p".repeat(31)]: z.string().describe("ok") }),
      }),
    ).toThrow(/name is 31/);
  });

  it("fails loudly in dev when a tool's output exceeds 1.5K", async () => {
    const big = defineTool({
      ...base,
      name: "big_output",
      description: "ok",
      schema: z.object({}),
      execute: () => ({ blob: "x".repeat(BUDGET.output) }),
    });
    await expect(big.run({}, { actor: "agent" })).rejects.toThrow(/output is \d+ chars/);
  });
});

describe("defineTool — run()", () => {
  it("validates input and names the offending field without executing", async () => {
    const result = await echo.run({ text: 42 }, { actor: "agent" });
    expect(isToolError(result)).toBe(true);
    if (isToolError(result)) {
      expect(result.field).toBe("text");
      expect(result.error).toMatch(/^text: /);
    }
  });

  it("rejects an enum value outside the vocabulary, naming the field", async () => {
    const result = await echo.run({ text: "hi", mode: "shout" }, { actor: "agent" });
    expect(isToolError(result) && result.field).toBe("mode");
  });

  it("applies schema defaults before execute sees the input", async () => {
    expect(await echo.run({ text: "hi" }, { actor: "agent" })).toEqual({ echoed: "hi" });
    expect(await echo.run({ text: "hi", mode: "loud" }, { actor: "agent" })).toEqual({ echoed: "HI" });
  });

  it("turns a thrown error into a returned one, with no stack or path", async () => {
    const result = await echo.run({ text: "throw" }, { actor: "agent" });
    expect(result).toEqual({ error: "boom" });
  });

  it("passes a returned ToolError through unchanged", async () => {
    expect(await echo.run({ text: "fail" }, { actor: "agent" })).toEqual({
      error: "text cannot be 'fail'",
      field: "text",
    });
  });

  it("treats undefined input as an empty object so no-arg tools work", async () => {
    const noArgs = defineTool({
      name: "no_args",
      humanLabel: "No args",
      description: "ok",
      schema: z.object({}),
      annotations: { readOnlyHint: true },
      reversible: false,
      available: () => true,
      execute: () => ({ ok: true }),
      announce: () => "ran.",
    });
    expect(await noArgs.run(undefined, { actor: "agent" })).toEqual({ ok: true });
  });
});

describe("defineTool — announce and audit", () => {
  it("announces success with the actor named, politely", async () => {
    await echo.run({ text: "hi" }, { actor: "agent" });
    const last = bookingStore.getState().announcements.at(-1);
    expect(last?.text).toBe('Agent echoed "hi".');
    expect(last?.actor).toBe("agent");
    expect(last?.politeness).toBe("polite");
  });

  it("addresses the human as 'You'", async () => {
    await echo.run({ text: "hi" }, { actor: "human" });
    expect(bookingStore.getState().announcements.at(-1)?.text).toBe('You echoed "hi".');
  });

  it("announces failure assertively using the human label", async () => {
    await echo.run({ text: "fail" }, { actor: "agent" });
    const last = bookingStore.getState().announcements.at(-1);
    expect(last?.text).toBe("Agent could not echo: text cannot be 'fail'");
    expect(last?.politeness).toBe("assertive");
  });

  it("writes an audit entry for every run, success or not", async () => {
    await echo.run({ text: "hi" }, { actor: "human" });
    await echo.run({ text: "fail" }, { actor: "agent" });
    const audit = bookingStore.getState().audit;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ tool: "echo_test", actor: "human", ok: true, reversible: false });
    expect(audit[1]).toMatchObject({ tool: "echo_test", actor: "agent", ok: false });
  });
});

describe("defineTool — actor attribution through the browser", () => {
  const signal = new AbortController().signal;

  it("attributes an unmarked call to the agent", async () => {
    await echo.toModelContextTool().execute({ text: "hi" }, { signal });
    expect(bookingStore.getState().audit.at(-1)?.actor).toBe("agent");
  });

  it("survives being called without an options argument, as Chrome does", async () => {
    const execute = echo.toModelContextTool().execute;
    // Deliberately violating the typings: the real browser omits `options`.
    const result = await (execute as (input: unknown) => Promise<unknown>)({ text: "hi" });
    expect(result).toEqual({ echoed: "hi" });
  });

  it("attributes the next call to the human after markNextCallAs, then resets", async () => {
    const execute = echo.toModelContextTool().execute;
    markNextCallAs("human");
    await execute({ text: "one" }, { signal });
    await execute({ text: "two" }, { signal });
    const [first, second] = bookingStore.getState().audit;
    expect(first?.actor).toBe("human");
    expect(second?.actor).toBe("agent");
  });
});
