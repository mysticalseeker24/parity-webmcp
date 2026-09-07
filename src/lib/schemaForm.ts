import type { JsonSchema } from "./webmcpInterop";

/**
 * Turns a JSON Schema into a description of a form.
 *
 * This is deliberately generic: it works from the schema alone, so the palette
 * can render a control for a tool it has never heard of. If it needed a local
 * definition it would be a second command list wearing a disguise, and the
 * whole "one registry" claim would be false (CLAUDE.md).
 *
 * Spec issue #286: the label is the field's `description`. A Stripe engineer
 * asked the declarative API to derive parameter descriptions from `aria-label`;
 * a spec editor replied it should follow the accessible name computation so the
 * generated schema can never disagree with the control's semantics. Parity does
 * the inverse — the accessible name *is* the parameter description, because
 * there is one source. They cannot disagree.
 */

export type FieldKind = "text" | "textarea" | "select" | "checkbox" | "checkboxGroup" | "number";

export interface FormField {
  readonly name: string;
  /** The accessible name. Always the schema's description (#286). */
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly options: readonly string[];
  readonly integer: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function enumOf(def: Record<string, unknown>): string[] {
  const values = def["enum"];
  if (Array.isArray(values)) return values.map(String);
  // Zod emits single-value enums and literals as `const`.
  if (typeof def["const"] === "string" || typeof def["const"] === "number") {
    return [String(def["const"])];
  }
  // A union of literals, e.g. z.literal([30, 60]).
  const anyOf = def["anyOf"];
  if (Array.isArray(anyOf)) {
    const consts = anyOf
      .map((entry) => asRecord(entry)?.["const"])
      .filter((v): v is string | number => typeof v === "string" || typeof v === "number");
    if (consts.length === anyOf.length && consts.length > 0) return consts.map(String);
  }
  return [];
}

function kindFor(def: Record<string, unknown>, options: readonly string[]): FieldKind {
  const type = def["type"];
  if (type === "array") {
    return "checkboxGroup";
  }
  if (options.length > 0) return "select";
  if (type === "boolean") return "checkbox";
  if (type === "number" || type === "integer") return "number";
  return "text";
}

export function fieldsFromSchema(schema: JsonSchema): FormField[] {
  const properties = asRecord(schema["properties"]) ?? {};
  const required = new Set(
    (Array.isArray(schema["required"]) ? schema["required"] : []).map(String),
  );

  return Object.entries(properties).map(([name, raw]) => {
    const def = asRecord(raw) ?? {};
    const items = asRecord(def["items"]) ?? {};
    const isArray = def["type"] === "array";
    const options = isArray ? enumOf(items) : enumOf(def);
    const kind = kindFor(def, options);

    return {
      name,
      // Falling back to the field name keeps an undescribed field usable rather
      // than rendering an unlabelled input. Our own tools cannot get here —
      // defineTool rejects a field with no .describe() — but a tool from
      // somewhere else might.
      label: typeof def["description"] === "string" && def["description"] !== ""
        ? def["description"]
        : name,
      kind: isArray && options.length === 0 ? "text" : kind,
      required: required.has(name),
      options,
      integer: def["type"] === "integer" || items["type"] === "integer",
    };
  });
}

/**
 * Build the arguments object from raw form values, dropping anything the user
 * left blank so an optional field is omitted rather than sent as "".
 */
export function valuesToArgs(
  fields: readonly FormField[],
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined || value === "" || value === null) continue;
    if (field.kind === "checkboxGroup") {
      if (Array.isArray(value) && value.length > 0) args[field.name] = value;
      continue;
    }
    if (field.kind === "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) args[field.name] = parsed;
      continue;
    }
    if (field.kind === "select" && field.integer) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) args[field.name] = parsed;
      continue;
    }
    args[field.name] = value;
  }
  return args;
}
