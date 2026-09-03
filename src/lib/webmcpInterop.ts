/**
 * The seam between what `webmcp-types` promises and what Chrome actually does.
 *
 * Both facts below were observed against Chrome 152 over CDP on 2026-09-03 with
 * `--enable-blink-features=WebMCP`, running our own production bundle. They are
 * recorded in `.agent/PHASE1_FINDINGS.md`. Neither is in the typings.
 *
 *  1. `RegisteredTool.inputSchema` is typed `object` but arrives as a **JSON
 *     string**. The Phase 5 palette renders a form from that schema, so reading
 *     it as an object yields `undefined` for every field and an empty form.
 *
 *  2. `executeTool()` resolves to a **JSON string**, not the value `execute`
 *     returned. Chrome serializes it on the way out.
 *
 * Both helpers accept either shape, so if a later Chrome starts returning real
 * objects nothing here breaks.
 */

/** A parsed JSON Schema. Deliberately loose — Phase 5 narrows it per field. */
export type JsonSchema = Record<string, unknown>;

function parseMaybeJson(value: unknown, what: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Could not parse ${what} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Read a registered tool's input schema as an object, whatever the browser
 * handed us. Returns an empty schema for a tool that declared none.
 */
export function readInputSchema(tool: WebMCP.RegisteredTool): JsonSchema {
  const raw = parseMaybeJson(tool.inputSchema, `inputSchema for "${tool.name}"`);
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`inputSchema for "${tool.name}" is not a JSON Schema object`);
  }
  return raw as JsonSchema;
}

/**
 * Read an `executeTool()` result. `null` (navigation) passes through unchanged;
 * a JSON string is parsed; anything else is returned as-is.
 */
export function parseToolResult(result: string | null): unknown {
  if (result === null) return null;
  return parseMaybeJson(result, "tool result");
}

/**
 * Serialize arguments for `executeTool()`. Exists so no call site is tempted to
 * pass an object — Chrome rejects that with "Failed to parse input arguments",
 * and the failure looks like a tool bug rather than a calling-convention bug.
 */
export function encodeToolArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args ?? {});
}
