import * as z from "zod";
import { bookingStore, newId, type Actor, type BookingState } from "../store";

/**
 * The factory. One spec fans out to six consumers (CONVENTIONS.md §3):
 *
 *   1. WebMCP registration  — `inputSchema` via `z.toJSONSchema(spec.schema)`
 *   2. The command palette  — reads the same JSON Schema back via getTools()
 *   3. The voice grammar    — `voiceAliases` + enum values on the schema
 *   4. Runtime validation   — `spec.schema.safeParse(input)` in `run()`
 *   5. The live region      — `spec.announce(input, result)`, actor prefixed
 *   6. The audit log        — every run, with `actor`
 *
 * Nothing here calls `document.modelContext`. That is `registry.ts`'s job and
 * its alone.
 */

export interface ExecuteContext {
  readonly actor: Actor;
  readonly signal: AbortSignal;
  /** Wall-clock at the start of the call. Pass it down; never read Date.now() in a tool. */
  readonly now: number;
}

/** What a tool returns when it cannot do its job. Name the field so the model
 *  can self-correct (CONVENTIONS.md §7). */
export interface ToolError {
  readonly error: string;
  readonly field?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function isToolError(value: unknown): value is ToolError {
  return typeof value === "object" && value !== null && typeof (value as ToolError).error === "string";
}

/** Everything `execute` can return except an error. What `announce` receives. */
export type Success<R> = Exclude<Awaited<R>, ToolError>;

/**
 * `R` is whatever `execute` returns — success shapes and `ToolError`s together.
 * It is inferred from `execute` alone; `announce` and `assertive` then see only
 * the success members. Declaring the union as `Result | ToolError` instead
 * would leave TypeScript unable to infer `Result` and every tool would see
 * `object`.
 *
 * ORDERING RULE: in a tool literal, `execute` must come before `announce` and
 * `assertive`. TypeScript infers `R` from context-sensitive properties in
 * source order; if `announce` is seen first, `R` is fixed as `unknown` and its
 * `result` parameter has no properties. The compiler error is immediate, so
 * the mistake cannot ship — but it looks baffling until you know this.
 */
export interface ToolSpec<Schema extends z.ZodObject, R> {
  readonly name: string;
  readonly description: string;
  readonly schema: Schema;
  /** Palette row label and the verb in error announcements. */
  readonly humanLabel: string;
  readonly voiceAliases?: readonly string[];
  readonly annotations: { readonly readOnlyHint: boolean; readonly untrustedContentHint?: boolean };
  readonly reversible: boolean;
  readonly gated?: boolean;
  readonly available: (state: BookingState) => boolean;
  /** A verb phrase; the factory prefixes the actor. "selected Dr. X" → "Agent selected Dr. X". */
  readonly announce: (input: z.infer<Schema>, result: Success<R>) => string;
  /** Results that must interrupt the screen reader — grant requests, conflicts. */
  readonly assertive?: (result: Success<R>) => boolean;
  readonly execute: (input: z.infer<Schema>, ctx: ExecuteContext) => R | Promise<R>;
}

export interface DefinedTool<Schema extends z.ZodObject, R> {
  readonly spec: ToolSpec<Schema, R>;
  readonly name: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly available: (state: BookingState) => boolean;
  /** The one execute path. Validates, runs, announces, audits, returns the agent-facing payload. */
  readonly run: (
    rawInput: unknown,
    ctx: { actor: Actor; signal?: AbortSignal },
  ) => Promise<Success<R> | ToolError>;
  /** The object handed to `registerTool`. Built by the registry, nowhere else. */
  readonly toModelContextTool: () => WebMCP.ModelContextTool;
}

// A heterogeneous list of tools. `any` here is the standard variance escape:
// every tool's `announce` takes its own input/result types, which no common
// supertype other than `any` accepts under strictFunctionTypes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDefinedTool = DefinedTool<any, any>;

// ---------------------------------------------------------------------------
// Actor attribution for calls that arrive through the browser.
//
// When the human palette calls `document.modelContext.executeTool()`, the
// browser invokes the same closure the agent's calls reach. The closure cannot
// tell who called. So the palette marks the next call as human just before
// executing, and the closure consumes that mark. Anything unmarked is the agent.
// ---------------------------------------------------------------------------

let pendingActor: Actor | null = null;

export function markNextCallAs(actor: Actor): void {
  pendingActor = actor;
}

function takePendingActor(): Actor {
  const actor = pendingActor ?? "agent";
  pendingActor = null;
  return actor;
}

// ---------------------------------------------------------------------------
// Character budgets (TOOLS.md §6). Asserted at definition time in dev so a
// violation fails the test run, not the demo.
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
  if (name.length > BUDGET.toolName) budgetViolation(`tool name "${name}" is ${name.length} chars (max ${BUDGET.toolName})`);
  if (!/^[a-z][a-z0-9_]*$/.test(name)) budgetViolation(`tool name "${name}" must be snake_case`);
  if (description.length > BUDGET.toolDescription) {
    budgetViolation(`${name}: description is ${description.length} chars (max ${BUDGET.toolDescription})`);
  }
  const properties = (schema.properties ?? {}) as Record<string, { description?: unknown }>;
  for (const [param, def] of Object.entries(properties)) {
    if (param.length > BUDGET.paramName) budgetViolation(`${name}.${param}: name is ${param.length} chars (max ${BUDGET.paramName})`);
    const paramDescription = def.description;
    if (typeof paramDescription !== "string" || paramDescription.length === 0) {
      budgetViolation(`${name}.${param}: every field needs .describe() (TOOLS.md §7)`);
    }
    if (paramDescription.length > BUDGET.paramDescription) {
      budgetViolation(`${name}.${param}: description is ${paramDescription.length} chars (max ${BUDGET.paramDescription})`);
    }
  }
}

/**
 * Zod → JSON Schema for the *input* side. Two things the defaults get wrong:
 *
 *  - `io` defaults to "output", where a field with `.default()` is always
 *    present and therefore listed as `required`. The agent would be told it
 *    must send `time_of_day` when it need not. "input" lists only true
 *    requirements.
 *  - "input" mode omits `additionalProperties: false`. We add it back so the
 *    agent is told not to invent parameters (Zod strips them anyway).
 *
 * The `$schema` key is dropped: the browser has no use for it.
 */
function toInputSchema(schema: z.ZodObject): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return { ...rest, additionalProperties: false };
}

function zodErrorToToolError(error: z.ZodError): ToolError {
  const first = error.issues[0];
  if (!first) return { error: "invalid input" };
  const field = first.path.map(String).join(".") || undefined;
  return field
    ? { error: `${field}: ${first.message}`, field }
    : { error: first.message };
}

/** Never leak a stack or an internal path to the agent (CONVENTIONS.md §7). */
function safeMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0] ?? "unexpected error";
  return "unexpected error";
}

const ACTOR_LABEL: Record<Actor, string> = { agent: "Agent", human: "You" };

export function defineTool<Schema extends z.ZodObject, R>(
  spec: ToolSpec<Schema, R>,
): DefinedTool<Schema, R> {
  const inputSchema = toInputSchema(spec.schema);
  if (import.meta.env.DEV) assertBudgets(spec.name, spec.description, inputSchema);

  const run: DefinedTool<Schema, R>["run"] = async (rawInput, ctx) => {
    const now = Date.now();
    const signal = ctx.signal ?? new AbortController().signal;
    const parsed = spec.schema.safeParse(rawInput ?? {});

    let payload: Success<R> | ToolError;
    if (!parsed.success) {
      payload = zodErrorToToolError(parsed.error);
    } else {
      try {
        // `execute` returns R, which may contain ToolError members; the
        // isToolError check below is the runtime split of that union.
        payload = (await spec.execute(parsed.data, { actor: ctx.actor, signal, now })) as Success<R> | ToolError;
      } catch (error) {
        payload = { error: safeMessage(error) };
      }
    }

    const ok = !isToolError(payload);
    let text: string;
    let assertive: boolean;
    if (isToolError(payload)) {
      text = `${ACTOR_LABEL[ctx.actor]} could not ${spec.humanLabel.toLowerCase()}: ${payload.error}`;
      assertive = true;
    } else {
      // A broken announce() must never turn a successful tool call into a
      // thrown one: the agent would see "invocation failed" for a booking that
      // actually happened (CONVENTIONS.md §7). Announce a fallback instead.
      const input = parsed.success ? parsed.data : ({} as z.infer<Schema>);
      try {
        text = `${ACTOR_LABEL[ctx.actor]} ${spec.announce(input, payload)}`;
        assertive = spec.assertive?.(payload) ?? false;
      } catch (error) {
        console.error(`[defineTool] ${spec.name}.announce threw`, error);
        text = `${ACTOR_LABEL[ctx.actor]} ran ${spec.humanLabel.toLowerCase()}.`;
        assertive = false;
      }
    }

    const store = bookingStore.getState();
    store.announce({ id: newId("ann"), at: now, text, actor: ctx.actor, politeness: assertive ? "assertive" : "polite" });
    store.appendAudit({
      id: newId("audit"),
      at: now,
      tool: spec.name,
      actor: ctx.actor,
      input: parsed.success ? parsed.data : rawInput,
      ok,
      summary: text,
      reversible: spec.reversible,
    });

    if (import.meta.env.DEV) {
      const size = JSON.stringify(payload).length;
      if (size > BUDGET.output) budgetViolation(`${spec.name}: output is ${size} chars (max ${BUDGET.output})`);
    }
    return payload;
  };

  return {
    spec,
    name: spec.name,
    inputSchema,
    available: spec.available,
    run,
    toModelContextTool: () => ({
      name: spec.name,
      title: spec.humanLabel,
      description: spec.description,
      inputSchema,
      annotations: {
        readOnlyHint: spec.annotations.readOnlyHint,
        untrustedContentHint: spec.annotations.untrustedContentHint ?? false,
      },
      // `options` is optional here even though the typings make it required:
      // destructuring `{ signal }` from an absent second argument throws
      // before `run()` starts, and the browser reports it as the tool having
      // failed. Verified against Chrome 152 — see PHASE1_FINDINGS.md.
      execute: (input, options) =>
        run(input, options?.signal ? { actor: takePendingActor(), signal: options.signal } : { actor: takePendingActor() }),
    }),
  };
}
