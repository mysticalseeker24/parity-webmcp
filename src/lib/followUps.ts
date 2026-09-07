import type { FormField } from "./schemaForm";

/**
 * What you can do next with a thing a tool just returned.
 *
 * A result that lists providers and gives you no way to act on one is a dead
 * end: the ids are on screen, and the only way to use them is to read one, run
 * a second command, and retype it. That is exactly the retyping this product
 * exists to remove, and it lands hardest on the keyboard-only user the palette
 * is for.
 *
 * The match is derived, never listed: an array under `providers` offers the
 * live tools whose one required field is `provider_id`; `slots` offers
 * `slot_id`. Nothing here names a tool or a domain, so a tool added later — or
 * one `getTools()` offers that the local map has never seen — is picked up
 * without touching this file.
 *
 * The follow-up opens that tool's form pre-filled and waits. It does not
 * execute. That is the same rule voice follows: reaching the right form is the
 * win; skipping the confirmation is not.
 */

export interface FollowUpTarget {
  readonly name: string;
  readonly fields: readonly FormField[];
  /** Honest annotation, used only for ordering — never for access control. */
  readonly readOnly?: boolean;
}

export interface FollowUpEntity {
  /** The value that goes into the id field. */
  readonly id: string;
  /** What to call it on the button. */
  readonly label: string;
  /** Tools that take this kind of id and need nothing else. */
  readonly tools: readonly FollowUpTarget[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A tool qualifies when exactly one field is required and it is `<kind>_id`.
 * Requiring it to be the *only* required field is what makes the pre-filled
 * form immediately runnable — offering a button that opens a half-empty form
 * would just move the typing somewhere else.
 */
function idFieldKind(tool: FollowUpTarget): string | null {
  const required = tool.fields.filter((f) => f.required);
  if (required.length !== 1) return null;
  const match = /^(.+)_id$/.exec(required[0]!.name);
  return match ? match[1]! : null;
}

/** `providers` → `provider`. Plural keys only; a scalar key is not a list. */
function singular(key: string): string | null {
  if (key.endsWith("ies")) return `${key.slice(0, -3)}y`;
  if (key.endsWith("s") && !key.endsWith("ss")) return key.slice(0, -1);
  return null;
}

/**
 * Read a human label off an entity without knowing what kind of thing it is.
 * Falls back through the fields an entity is likely to carry, then to the id,
 * which is at least unambiguous.
 */
function labelOf(entity: Record<string, unknown>, id: string): string {
  const name = entity["name"] ?? entity["label"] ?? entity["title"];
  if (typeof name === "string" && name.trim() !== "") return name;

  // A slot has no name; date + time is what identifies it to a person.
  const parts = ["date", "day", "time", "start"]
    .map((key) => entity[key])
    .filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (parts.length > 0) return parts.join(" ");

  return id;
}

/**
 * Entities in `data` that a live tool can act on, in the order they appear.
 * Returns [] when nothing matches, which is the common case — most results are
 * not lists of actionable things.
 */
export function followUpsFor(
  data: unknown,
  liveTools: readonly FollowUpTarget[],
  limit = 8,
): FollowUpEntity[] {
  if (!isPlainObject(data)) return [];

  const byKind = new Map<string, FollowUpTarget[]>();
  for (const tool of liveTools) {
    const kind = idFieldKind(tool);
    if (!kind) continue;
    const bucket = byKind.get(kind);
    if (bucket) bucket.push(tool);
    else byKind.set(kind, [tool]);
  }
  if (byKind.size === 0) return [];

  const out: FollowUpEntity[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) continue;
    const kind = singular(key);
    const tools = kind ? byKind.get(kind) : undefined;
    if (!tools) continue;

    // The action that moves the booking forward leads; looking something up is
    // the secondary choice. Both are offered — this is ordering, not a gate.
    const ordered = [...tools].sort(
      (a, b) => Number(a.readOnly ?? false) - Number(b.readOnly ?? false),
    );

    for (const item of value) {
      if (out.length >= limit) return out;
      if (!isPlainObject(item)) continue;
      const id = item["id"];
      if (typeof id !== "string" || id === "") continue;
      out.push({ id, label: labelOf(item, id), tools: ordered });
    }
  }
  return out;
}
