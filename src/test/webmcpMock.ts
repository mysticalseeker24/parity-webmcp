/**
 * An in-memory stand-in for the browser's WebMCP implementation.
 *
 * This exists because the real registry lives in the browser, not in our page —
 * so there is nothing to unit test unless we supply the client half. The mock
 * mirrors the behaviours TOOLS.md §3 documents and that our code depends on:
 *
 *  - `registerTool` is async
 *  - `AbortSignal` unregisters, and an already-aborted signal registers nothing
 *  - `getTools()` returns results in alphabetical order
 *  - `getTools()[i].inputSchema` comes back as a **JSON string**
 *  - `executeTool()` takes arguments as a **JSON string**, not an object, and
 *    rejects an object with "Failed to parse input arguments"
 *  - `executeTool()` resolves to a **JSON string**, not the returned value
 *  - `annotations` are defaulted, so `untrustedContentHint` is always present
 *  - `toolchange` fires whenever the tool list changes
 *
 * The serialization behaviours are not in `webmcp-types`; they were observed
 * against Chrome 152 and are recorded in `.agent/PHASE1_FINDINGS.md`. A mock
 * that returned convenient objects instead would let Phase 5 pass its tests and
 * still break in the browser, which is worse than having no mock at all.
 *
 * It is a test double, never shipped: nothing under `src/test/` is imported by
 * `main.tsx`, so it cannot reach the bundle.
 */

type ToolRecord = {
  definition: WebMCP.ModelContextTool;
  registered: WebMCP.RegisteredTool;
};

export class MockModelContext extends EventTarget implements WebMCP.ModelContext {
  #tools = new Map<string, ToolRecord>();

  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;

  /** Every `executeTool` call, in order — lets tests assert the JSON-string contract. */
  readonly executeCalls: { name: string; args: string }[] = [];

  registerTool(
    tool: WebMCP.ModelContextTool,
    options?: WebMCP.ModelContextRegisterToolOptions,
  ): Promise<void> {
    if (options?.signal?.aborted) return Promise.resolve();

    this.#tools.set(tool.name, {
      definition: tool,
      registered: {
        name: tool.name,
        title: tool.title ?? tool.name,
        description: tool.description,
        // Chrome hands back a JSON *string* here despite the `object` typing.
        ...(tool.inputSchema === undefined
          ? {}
          : { inputSchema: JSON.stringify(tool.inputSchema) as unknown as object }),
        window: globalThis.window,
        origin: globalThis.location?.origin ?? "http://localhost",
        // Chrome fills in the defaults rather than echoing what was supplied.
        annotations: {
          readOnlyHint: tool.annotations?.readOnlyHint ?? false,
          untrustedContentHint: tool.annotations?.untrustedContentHint ?? false,
        },
      },
    });

    options?.signal?.addEventListener(
      "abort",
      () => {
        this.#tools.delete(tool.name);
        this.#emitToolChange();
      },
      { once: true },
    );

    this.#emitToolChange();
    return Promise.resolve();
  }

  getTools(): Promise<WebMCP.RegisteredTool[]> {
    // Alphabetical, matching the real implementation (TOOLS.md §3).
    return Promise.resolve(
      [...this.#tools.values()]
        .map((record) => record.registered)
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async executeTool(
    tool: WebMCP.RegisteredTool,
    args: string,
    options?: { signal?: AbortSignal },
  ): Promise<string | null> {
    // Chrome's exact failure when handed an object instead of a JSON string.
    if (typeof args !== "string") {
      throw new Error("UnknownError: Failed to parse input arguments");
    }
    this.executeCalls.push({ name: tool.name, args });

    const record = this.#tools.get(tool.name);
    if (!record) throw new Error(`No such tool: ${tool.name}`);

    let input: unknown;
    try {
      input = args === "" ? {} : JSON.parse(args);
    } catch {
      throw new Error("UnknownError: Failed to parse input arguments");
    }

    const result = await record.definition.execute(input as Record<string, unknown>, {
      signal: options?.signal ?? new AbortController().signal,
    });
    // Chrome serializes the return value on the way back to the caller.
    return JSON.stringify(result ?? null);
  }

  #emitToolChange(): void {
    const event = new Event("toolchange");
    this.ontoolchange?.call(this, event);
    this.dispatchEvent(event);
  }
}

/**
 * Install a mock on `document.modelContext` and return it plus a restore fn.
 * Pass `present: false` to simulate a browser with no WebMCP support at all.
 */
export function installMockModelContext(present = true): {
  context: MockModelContext | undefined;
  restore: () => void;
} {
  const descriptor = Object.getOwnPropertyDescriptor(document, "modelContext");
  const context = present ? new MockModelContext() : undefined;

  Object.defineProperty(document, "modelContext", {
    value: context,
    configurable: true,
    writable: true,
  });

  return {
    context,
    restore: () => {
      if (descriptor) Object.defineProperty(document, "modelContext", descriptor);
      else Reflect.deleteProperty(document, "modelContext");
    },
  };
}
