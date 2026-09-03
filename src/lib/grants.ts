import { bookingStore, newId, type Grant } from "../store";

/**
 * Grant primitives for the gated tools (PROJECT_SPEC.md §7).
 *
 * This file can mint a grant and check one. It cannot approve one. Approval
 * arrives in Phase 6 through page UI — `GrantCard` — which is the only channel
 * the agent cannot originate, render, or replay. Until that exists there is no
 * code path anywhere from `confirm_booking` to a committed booking, which is the
 * structural property the spec demands, and the tests assert it.
 */

export const GRANT_TTL_MS = 120_000;

/** JSON with object keys sorted at every level, so equal inputs hash equal. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJSON(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 of the canonical arguments, hex. Native — no dependency (TOOLS.md §8). */
export async function hashArgs(input: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function requestGrant(tool: string, argsHash: string, now: number): Grant {
  const grant: Grant = {
    id: newId("grant"),
    tool,
    args_hash: argsHash,
    issued_at: now,
    expires_at: now + GRANT_TTL_MS,
    status: "pending",
  };
  bookingStore.getState().addGrant(grant);
  return grant;
}

export type GrantCheck =
  | { readonly status: "none" }
  | { readonly status: "pending" | "approved" | "denied" | "consumed" | "expired"; readonly grant: Grant };

/**
 * Find the most recent grant for this tool + argument hash and report its
 * state *as of `now`*. Expiry is computed here, at check time, never trusted
 * from a timer — a grant approved at 119s and used at 121s is expired.
 */
export function checkGrant(tool: string, argsHash: string, now: number): GrantCheck {
  const grant = [...bookingStore.getState().grants]
    .reverse()
    .find((g) => g.tool === tool && g.args_hash === argsHash);
  if (!grant) return { status: "none" };
  if (grant.status === "pending" || grant.status === "approved") {
    if (now >= grant.expires_at) return { status: "expired", grant };
  }
  return { status: grant.status, grant };
}

export function consumeGrant(id: string): void {
  bookingStore.getState().updateGrant(id, "consumed");
}
