import * as z from "zod";
import type { BookingState } from "../store";
import { isToolResult, refuse, type ToolRefusal, type ToolResult } from "./result";

/**
 * The factory. One spec fans out to six consumers (CONVENTIONS.md §3):
 *
 *   1. WebMCP registration  — `inputSchema` via `z.toJSONSchema(spec.schema)`
 *   2. The command palette  — a form built from that same JSON Schema
 *   3. The voice grammar    — `voiceAliases` + enum values read off the schema
 *   4. Runtime validation   — `spec.schema.safeParse` in `run()`
 *   5. The live region      — `spec.announce(input, result)`
 *   6. The audit log        — written by the registry, with an actor
 *
 * Nothing here calls `document.modelContext`. That is `registry.ts`'s job.
 */

/**
 * Coarse-grained grouping, our answer to spec issue #255 (progressive
 * disclosure, filed by Sarah Drasner). The state machine already keeps the live
 * set small; `group` lets the palette and `get_booking_state` present six
 * headings instead of nineteen descriptions, built from existing primitives
 * with no spec change.
 */
export type ToolGroup = "orient" | "search" | "schedule" | "intake" | "commit" | "manage";

/**
 * Why a tool is not currently registered. Spec issue #262: unregistering a tool
 * tells the agent only that it vanished — not whether it is forbidden, not yet
 * ready, or irrelevant. We keep unregistration for enforcement and hand the
 * lost context back through `get_booking_state.unavailable[]`.
 *
 * `reason_code` is terse on purpose: all non-live tools must fit the 1.5K
 * output budget.
 */
export interface UnavailableReason {
  readonly reason_code: string;
  readonly reason: string;
  /** The tool to call to unlock this one. */
  readonly unlock_by: string;
}

export interface ExecuteContext {
  readonly signal: AbortSignal;
  /** Wall clock at the start of the call. Tools never read Date.now() directly. */
  readonly now: number;
}

export interface ToolSpec<Schema extends z.ZodObject, R> {
  readonly name: string;
  readonly description: string;
  readonly schema: Schema;
  readonly group: ToolGroup;
  /** Palette row label, and the verb in a refusal announcement. */
  readonly humanLabel: string;
  readonly voiceAliases?: readonly string[];
  readonly readOnly?: boolean;
  readonly reversible?: boolean;
  readonly requiresGrant?: boolean;
  /** Returns provider-submitted prose. Sets untrustedContentHint. */
  readonly untrustedOutput?: boolean;
  readonly available: (state: BookingState) => boolean;
  readonly unavailableReason: (state: BookingState) => UnavailableReason;
  /** A verb phrase; the announcer prefixes the actor. */
  readonly announce: (input: z.infer<Schema>, result: ToolResult) => string;
  readonly execute: (input: z.infer<Schema>, ctx: ExecuteContext) => R | Promise<R>;
}

export interface DefinedTool<Schema extends z.ZodObject, R> {
  readonly spec: ToolSpec<Schema, R>;
  readonly name: string;
  readonly group: ToolGroup;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly available: (state: BookingState) => boolean;
  readonly unavailableReason: (state: BookingState) => UnavailableReason;
  /** The one execute path: validate → run → envelope. Never throws. */
  readonly run: (rawInput: unknown, signal?: AbortSignal) => Promise<ToolResult>;
  /** The object handed to registerTool. Built by the registry, nowhere else. */
  readonly toModelContextTool: (
    onResult: (tool: DefinedTool<Schema, R>, input: unknown, result: ToolResult) => void,
  ) => WebMCP.ModelContextTool;
}

// A heterogeneous list of tools. `any` is the standard variance escape here:
// each tool's announce/execute take their own types, and under
// strictFunctionTypes no common supertype but `any` accepts them all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDefinedTool = DefinedTool<any, any>;

// ---------------------------------------------------------------------------
// Character budgets (TOOLS.md §6). Asserted at definition time in dev, so a
// violation fails the test run rather than quietly degrading agent behaviour.
// Counted in characters, and we say "characters" (spec issue #219).
// ---------------------------------------------------------------------------

export const BUDGET = {
  toolName: 30,
  toolDescription: 500,
  paramName: 30,
  paramDescription: 150,
  output: 1500,
} as const;

function budgetViolation(message: string): never {
  throw new Error(`[defineTool] budget violation: ${message}`);
}

function assertBudgets(name: string, description: string, schema: Record<string, unknown>): void {
  if (name.length > BUDGET.toolName) {
    budgetViolation(`tool name "${name}" is ${name.length} characters (max ${BUDGET.toolName})`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(name)) budgetViolation(`tool name "${name}" must be snake_case`);
  if (description.length > BUDGET.toolDescription) {
    budgetViolation(
      `${name}: description is ${description.length} characters (max ${BUDGET.toolDescription})`,
    );
  }
  const properties = (schema.properties ?? {}) as Record<string, { description?: unknown }>;
  for (const [param, def] of Object.entries(properties)) {
    if (param.length > BUDGET.paramName) {
      budgetViolation(`${name}.${param}: name is ${param.length} characters (max ${BUDGET.paramName})`);
    }
    const paramDescription = def.description;
    // Spec issue #286: the palette generates its form label from this text, so
    // a field without .describe() would render an unlabelled input. One source
    // means the accessible name and the parameter description cannot disagree.
    if (typeof paramDescription !== "string" || paramDescription.length === 0) {
      budgetViolation(`${name}.${param}: every field needs .describe() — it is also the form label`);
    }
    if (paramDescription.length > BUDGET.paramDescription) {
      budgetViolation(
        `${name}.${param}: description is ${paramDescription.length} characters (max ${BUDGET.paramDescription})`,
      );
    }
  }
}

/**
 * Zod → JSON Schema for the *input* side. Two corrections to the defaults:
 *
 *  - `io` defaults to "output", where a field carrying `.default()` is always
 *    present and so listed as `required` — telling the agent it must send a
 *    parameter it need not. "input" lists only true requirements.
 *  - "input" mode drops `additionalProperties: false`; we restore it so the
 *    agent is told not to invent parameters.
 *
 * `$schema` is stripped: the browser has no use for it.
 */
function toInputSchema(schema: z.ZodObject): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<
    string,
    unknown
  >;
  return { ...rest, additionalProperties: false };
}

/** A concrete valid value for a field, so `invalid_input` can show one. */
function exampleFor(schema: Record<string, unknown>, field: string): string | undefined {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const def = properties[field.split(".")[0] ?? ""];
  if (!def) return undefined;
  const enumValues = def["enum"] ?? (def["items"] as Record<string, unknown> | undefined)?.["enum"];
  if (Array.isArray(enumValues) && enumValues.length > 0) {
    return `one of ${enumValues.slice(0, 6).map((v) => JSON.stringify(v)).join(", ")}`;
  }
  if (typeof def["pattern"] === "string" && def["pattern"].includes("\\d{4}")) return '"2026-10-14"';
  switch (def["type"]) {
    case "string":
      return '"text"';
    case "number":
    case "integer":
      return "10";
    case "boolean":
      return "true";
    case "array":
      return "[]";
    default:
      return undefined;
  }
}

/**
 * Spec issue #282: `invalid_input` always names the field and shows a valid
 * example, so the model can self-correct and retry rather than guess.
 */
function zodErrorToRefusal(error: z.ZodError, schema: Record<string, unknown>): ToolRefusal {
  const first = error.issues[0];
  if (!first) return refuse("invalid_input", "The input did not match the expected shape.");
  const field = first.path.map(String).join(".");
  const example = field ? exampleFor(schema, field) : undefined;
  const reason = example
    ? `${first.message}. Valid: ${example}.`
    : first.message;
  return refuse("invalid_input", reason, field ? { field } : undefined);
}

/** Never leak a stack or an internal path to the agent (CONVENTIONS.md §7). */
function safeMessage(error: unknown): string {
  if (error instanceof Error) {
    const firstLine = error.message.split("\n")[0] ?? "";
    // Strip anything that looks like a path or a URL.
    return firstLine.replace(/\s*(?:[A-Za-z]:)?[/\\][\w./\\-]+/g, "").trim() || "internal error";
  }
  return "internal error";
}

export function defineTool<Schema extends z.ZodObject, R extends ToolResult>(
  spec: ToolSpec<Schema, R>,
): DefinedTool<Schema, R> {
  const inputSchema = toInputSchema(spec.schema);
  if (import.meta.env.DEV) assertBudgets(spec.name, spec.description, inputSchema);

  const run: DefinedTool<Schema, R>["run"] = async (rawInput, signal) => {
    const parsed = spec.schema.safeParse(rawInput ?? {});
    if (!parsed.success) return zodErrorToRefusal(parsed.error, inputSchema);

    let result: ToolResult;
    try {
      result = await spec.execute(parsed.data, {
        signal: signal ?? new AbortController().signal,
        now: Date.now(),
      });
    } catch (error) {
      // A genuine defect. Refusals fulfil; only bugs land here, and the agent
      // gets a clean sentence rather than a stack trace (CONVENTIONS.md §7).
      console.error(`[${spec.name}] threw`, error);
      return refuse("refused", `${spec.humanLabel} failed: ${safeMessage(error)}`);
    }

    if (!isToolResult(result)) {
      console.error(`[${spec.name}] returned a non-envelope value`, result);
      return refuse("refused", `${spec.humanLabel} returned an unexpected result.`);
    }

    if (import.meta.env.DEV) {
      const size = JSON.stringify(result).length;
      if (size > BUDGET.output) {
        budgetViolation(`${spec.name}: output is ${size} characters (max ${BUDGET.output})`);
      }
    }
    return result;
  };

  const defined: DefinedTool<Schema, R> = {
    spec,
    name: spec.name,
    group: spec.group,
    inputSchema,
    available: spec.available,
    unavailableReason: spec.unavailableReason,
    run,
    toModelContextTool: (onResult) => ({
      name: spec.name,
      title: spec.humanLabel,
      description: spec.description,
      inputSchema,
      // Honest signals, never enforcement (CONVENTIONS.md §5). Enforcement is
      // state-machine registration plus the grant gate.
      annotations: {
        readOnlyHint: spec.readOnly ?? false,
        untrustedContentHint: spec.untrustedOutput ?? false,
      },
      // `options` is optional despite the typings: Chrome 152 calls execute
      // with a single argument, and destructuring `{ signal }` from an absent
      // second argument throws before the tool body runs — the browser then
      // reports every tool as failed. See .agent/PHASE1_FINDINGS.md §6.
      execute: async (input, options) => {
        const result = await run(input, options?.signal);
        onResult(defined, input, result);
        return result;
      },
    }),
  };

  return defined;
}
