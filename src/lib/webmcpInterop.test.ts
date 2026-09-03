import { describe, expect, it } from "vitest";
import { encodeToolArgs, parseToolResult, readInputSchema } from "./webmcpInterop";

const asTool = (inputSchema: unknown): WebMCP.RegisteredTool =>
  ({
    name: "get_page_title",
    title: "Get page title",
    description: "…",
    inputSchema,
    window: globalThis.window,
    origin: "http://localhost:4321",
  }) as unknown as WebMCP.RegisteredTool;

describe("readInputSchema", () => {
  it("parses the JSON string Chrome actually returns", () => {
    const raw = '{"type":"object","properties":{},"required":[],"additionalProperties":false}';
    expect(readInputSchema(asTool(raw))).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("passes through a real object, so a future Chrome that fixes this still works", () => {
    const schema = { type: "object", properties: { slot_id: { type: "string" } } };
    expect(readInputSchema(asTool(schema))).toEqual(schema);
  });

  it("returns an empty schema for a tool that declared none", () => {
    expect(readInputSchema(asTool(undefined))).toEqual({});
  });

  it("names the tool when the schema is unparseable, instead of a bare SyntaxError", () => {
    expect(() => readInputSchema(asTool("{not json"))).toThrow(/get_page_title/);
  });

  it("rejects a JSON array, which is not a schema object", () => {
    expect(() => readInputSchema(asTool("[1,2,3]"))).toThrow(/not a JSON Schema object/);
  });
});

describe("parseToolResult", () => {
  it("parses the JSON string executeTool resolves to", () => {
    expect(parseToolResult('{"title":"Parity — WebMCP spike"}')).toEqual({
      title: "Parity — WebMCP spike",
    });
  });

  it("preserves null, which signals a navigation rather than an empty result", () => {
    expect(parseToolResult(null)).toBeNull();
  });

  it("handles a bare JSON string result", () => {
    expect(parseToolResult('"done"')).toBe("done");
  });
});

describe("encodeToolArgs", () => {
  it("produces a JSON string, never an object", () => {
    expect(encodeToolArgs({})).toBe("{}");
    expect(typeof encodeToolArgs({ slot_id: "s_1030" })).toBe("string");
    expect(encodeToolArgs({ slot_id: "s_1030" })).toBe('{"slot_id":"s_1030"}');
  });
});
