/**
 * The one result envelope every tool returns.
 *
 * Spec issue #282: `execute()` currently returns the same shape for success,
 * refusal, and failure, so a competitor was reduced to a prose convention
 * ("Refused: …") and hoping the model reads it. A spec editor confirmed
 * WebMCP's `execute` is a plain Promise — fulfilment serialises as success,
 * rejection routes to the error path. So a refusal must be a **fulfilled**
 * result carrying structure, never a thrown error.
 *
 * The rule, enforced by `defineTool`: anything the tool *decides* fulfils with
 * `ok: false`. Only genuine defects throw.
 */

export type RefusalKind =
  | "refused"
  | "unavailable"
  | "invalid_input"
  | "conflict"
  | "pending_authorization"
  | "grant_expired"
  | "grant_mismatch";

export interface ToolOk<T = unknown> {
  readonly ok: true;
  readonly data: T;
  /** One sentence a human can read. Also the basis of the announcement. */
  readonly human_summary: string;
}

export interface ToolRefusal {
  readonly ok: false;
  readonly kind: RefusalKind;
  readonly reason: string;
  /** The offending input field, for `invalid_input`. */
  readonly field?: string;
  /** The tool to call next to make progress. Lets the model self-correct. */
  readonly next?: string;
}

export type ToolResult<T = unknown> = ToolOk<T> | ToolRefusal;

export function ok<T>(data: T, human_summary: string): ToolOk<T> {
  return { ok: true, data, human_summary };
}

export function refuse(
  kind: RefusalKind,
  reason: string,
  extra?: { field?: string; next?: string },
): ToolRefusal {
  return {
    ok: false,
    kind,
    reason,
    ...(extra?.field !== undefined ? { field: extra.field } : {}),
    ...(extra?.next !== undefined ? { next: extra.next } : {}),
  };
}

export function isOk<T>(result: ToolResult<T>): result is ToolOk<T> {
  return result.ok;
}

export function isRefusal<T>(result: ToolResult<T>): result is ToolRefusal {
  return !result.ok;
}

/** True for anything shaped like the envelope — used to validate at the boundary. */
export function isToolResult(value: unknown): value is ToolResult {
  if (typeof value !== "object" || value === null || !("ok" in value)) return false;
  const candidate = value as { ok: unknown };
  return typeof candidate.ok === "boolean";
}
