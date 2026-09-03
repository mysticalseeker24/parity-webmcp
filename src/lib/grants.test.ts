import { beforeEach, describe, expect, it } from "vitest";
import { bookingStore } from "../store";
import * as grants from "./grants";
import { canonicalJSON, checkGrant, consumeGrant, GRANT_TTL_MS, hashArgs, requestGrant } from "./grants";

beforeEach(() => bookingStore.getState().reset());

describe("canonicalJSON", () => {
  it("sorts keys at every level and drops undefined", () => {
    expect(canonicalJSON({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[2,{"y":2,"z":1}]},"b":1}',
    );
  });
});

describe("hashArgs", () => {
  it("is order-independent and value-sensitive", async () => {
    const a = await hashArgs({ slot_id: "s_1", note: "x" });
    const b = await hashArgs({ note: "x", slot_id: "s_1" });
    const c = await hashArgs({ slot_id: "s_2", note: "x" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("grant lifecycle", () => {
  it("reports none, then pending, then expired — computed at check time", () => {
    const now = 1_000_000;
    expect(checkGrant("confirm_booking", "h", now)).toEqual({ status: "none" });

    const grant = requestGrant("confirm_booking", "h", now);
    expect(grant.status).toBe("pending");
    expect(checkGrant("confirm_booking", "h", now + GRANT_TTL_MS - 1).status).toBe("pending");
    expect(checkGrant("confirm_booking", "h", now + GRANT_TTL_MS).status).toBe("expired");
  });

  it("binds a grant to its argument hash", () => {
    requestGrant("confirm_booking", "hash_a", 0);
    expect(checkGrant("confirm_booking", "hash_b", 1).status).toBe("none");
  });

  it("binds a grant to its tool", () => {
    requestGrant("confirm_booking", "h", 0);
    expect(checkGrant("cancel_booking", "h", 1).status).toBe("none");
  });

  it("consumes a grant so it cannot be replayed", () => {
    const grant = requestGrant("confirm_booking", "h", 0);
    consumeGrant(grant.id);
    expect(checkGrant("confirm_booking", "h", 1).status).toBe("consumed");
  });

  it("exposes no way to approve a grant (Phase 6 supplies it through page UI only)", () => {
    expect(Object.keys(grants).some((name) => /approve|deny/i.test(name))).toBe(false);
  });
});
