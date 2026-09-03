import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockModelContext } from "../test/webmcpMock";
import { GET_PAGE_TITLE, listRegisteredTools, runSpike } from "./spike";
import { encodeToolArgs, parseToolResult, readInputSchema } from "./webmcpInterop";

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  vi.unstubAllGlobals();
});

describe("get_page_title definition", () => {
  it("respects the TOOLS.md §6 character budgets", () => {
    expect(GET_PAGE_TITLE.name.length).toBeLessThanOrEqual(30);
    expect(GET_PAGE_TITLE.description.length).toBeLessThanOrEqual(500);
  });

  it("declares an empty, closed object input schema", () => {
    expect(GET_PAGE_TITLE.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("is annotated read-only", () => {
    expect(GET_PAGE_TITLE.annotations.readOnlyHint).toBe(true);
  });

  it("emits JSON Schema the browser will accept — no $ref, no $schema", () => {
    const serialized = JSON.stringify(GET_PAGE_TITLE.inputSchema);
    expect(serialized).not.toContain("$ref");
    expect(serialized).not.toContain("$schema");
  });

  it("returns the live document title, capped well under the 1.5K output budget", () => {
    document.title = "Parity — WebMCP spike";
    const result = GET_PAGE_TITLE.execute();
    expect(result).toEqual({ title: "Parity — WebMCP spike" });
    expect(JSON.stringify(result).length).toBeLessThan(1500);
  });
});

describe("runSpike — feature detection", () => {
  it("reports unsupported when document.modelContext is absent", async () => {
    ({ restore } = installMockModelContext(false));

    const status = await runSpike(new AbortController().signal);

    expect(status.kind).toBe("unsupported");
    // The message has to tell a judge what to do next, not just that it failed.
    if (status.kind === "unsupported") {
      expect(status.detail).toMatch(/ChatGPT desktop|enable-webmcp-testing/);
    }
  });

  it("reports unsupported when modelContext exists but registerTool does not", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(document, "modelContext");
    Object.defineProperty(document, "modelContext", {
      value: {} as WebMCP.ModelContext,
      configurable: true,
      writable: true,
    });
    restore = () => {
      if (descriptor) Object.defineProperty(document, "modelContext", descriptor);
      else Reflect.deleteProperty(document, "modelContext");
    };

    const status = await runSpike(new AbortController().signal);
    expect(status.kind).toBe("unsupported");
  });

  it("never touches navigator.modelContext", async () => {
    const { restore: undo } = installMockModelContext(true);
    restore = undo;

    const navigatorGetter = vi.fn(() => undefined);
    Object.defineProperty(navigator, "modelContext", {
      get: navigatorGetter,
      configurable: true,
    });

    await runSpike(new AbortController().signal);

    expect(navigatorGetter).not.toHaveBeenCalled();
    Reflect.deleteProperty(navigator, "modelContext");
  });
});

describe("runSpike — registration", () => {
  it("registers get_page_title and surfaces it through getTools", async () => {
    const { context, restore: undo } = installMockModelContext(true);
    restore = undo;

    const status = await runSpike(new AbortController().signal);

    expect(status).toEqual({ kind: "registered", toolName: "get_page_title" });
    expect(await listRegisteredTools()).toEqual(["get_page_title"]);
    expect(context).toBeDefined();
  });

  it("round-trips through executeTool with a JSON string, the way the palette will", async () => {
    const { context, restore: undo } = installMockModelContext(true);
    restore = undo;
    document.title = "Parity — WebMCP spike";

    await runSpike(new AbortController().signal);

    const tools = await context!.getTools();
    const tool = tools[0];
    expect(tool).toBeDefined();

    const result = await context!.executeTool(tool!, encodeToolArgs({}));

    // Chrome returns a JSON *string*, not the object `execute` returned.
    expect(typeof result).toBe("string");
    expect(parseToolResult(result)).toEqual({ title: "Parity — WebMCP spike" });
    expect(context!.executeCalls).toEqual([{ name: "get_page_title", args: "{}" }]);
  });

  it("exposes inputSchema as a JSON string that readInputSchema recovers", async () => {
    const { context, restore: undo } = installMockModelContext(true);
    restore = undo;

    await runSpike(new AbortController().signal);
    const tool = (await context!.getTools())[0]!;

    // Matches Chrome 152: typed `object`, delivered as a string.
    expect(typeof tool.inputSchema).toBe("string");
    expect(readInputSchema(tool)).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("rejects an object argument the way Chrome does", async () => {
    const { context, restore: undo } = installMockModelContext(true);
    restore = undo;

    await runSpike(new AbortController().signal);
    const tool = (await context!.getTools())[0]!;

    await expect(
      // Deliberately violating the signature — this is the mistake the
      // encodeToolArgs helper exists to prevent.
      context!.executeTool(tool, {} as unknown as string),
    ).rejects.toThrow(/Failed to parse input arguments/);
  });

  it("fires toolchange so the palette can stay in lockstep with the agent's view", async () => {
    const { context, restore: undo } = installMockModelContext(true);
    restore = undo;

    const onToolChange = vi.fn();
    context!.addEventListener("toolchange", onToolChange);

    await runSpike(new AbortController().signal);

    expect(onToolChange).toHaveBeenCalledTimes(1);
  });

  it("unregisters when the AbortSignal fires", async () => {
    const { restore: undo } = installMockModelContext(true);
    restore = undo;

    const controller = new AbortController();
    await runSpike(controller.signal);
    expect(await listRegisteredTools()).toEqual(["get_page_title"]);

    controller.abort();
    expect(await listRegisteredTools()).toEqual([]);
  });

  it("refuses to register inside an iframe, with an explanation", async () => {
    const { restore: undo } = installMockModelContext(true);
    restore = undo;

    // ChatGPT's browser does not discover framed tools (TOOLS.md §1). Simulate
    // a framed document by making window.top differ from window.self.
    vi.stubGlobal("top", {} as Window);

    const status = await runSpike(new AbortController().signal);

    expect(status.kind).toBe("failed");
    if (status.kind === "failed") expect(status.detail).toMatch(/iframe|frame/i);
    expect(await listRegisteredTools()).toEqual([]);
  });

  it("reports a thrown registration error instead of crashing the page", async () => {
    const { context, restore: undo } = installMockModelContext(true);
    restore = undo;

    vi.spyOn(context!, "registerTool").mockRejectedValue(new Error("boom"));

    const status = await runSpike(new AbortController().signal);

    expect(status).toEqual({ kind: "failed", detail: "boom" });
  });
});

describe("listRegisteredTools", () => {
  it("returns an empty list rather than throwing when unsupported", async () => {
    ({ restore } = installMockModelContext(false));
    expect(await listRegisteredTools()).toEqual([]);
  });
});
