import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GrantCard } from "./GrantCard";
import { allGrants, DWELL_MS, mint, resetGrants } from "../lib/grants";
import { startRegistry, type Registry } from "../lib/registry";
import { clearHoldTimer } from "../lib/timers";
import { bookingStore } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";
import { confirmBooking } from "../tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;

const store = () => bookingStore.getState();

async function reachReadyToConfirm(): Promise<string> {
  await registry!.execute("find_providers", { specialty: "neurology" });
  await registry!.execute("select_provider", { provider_id: "p01" });
  const avail = (await registry!.execute("get_availability", {})) as {
    data: { slots: { id: string }[] };
  };
  const slotId = avail.data.slots[0]!.id;
  await registry!.execute("hold_slot", { slot_id: slotId });
  await registry!.execute("set_intake", {
    patient_name: "Rosa Quintero",
    dob: "1984-03-09",
    reason: "migraine",
  });
  return slotId;
}

beforeEach(() => {
  clearHoldTimer();
  resetGrants();
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
});

afterEach(() => {
  cleanup();
  registry?.stop();
  registry = null;
  clearHoldTimer();
  resetGrants();
  restore?.();
  restore = null;
  vi.useRealTimers();
});

describe("GrantCard — what the human is shown", () => {
  it("renders nothing when no approval is pending", () => {
    render(<GrantCard />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("names the tool and every argument value in full", async () => {
    await mint("confirm_booking", { slot_id: "s_p01_2026-10-06_0930" });
    render(<GrantCard />);

    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(screen.getByText("confirm_booking")).toBeDefined();
    // The actual value, not a summary of it.
    expect(screen.getByText("s_p01_2026-10-06_0930")).toBeDefined();
  });

  it("takes focus when it appears and returns it when it goes", async () => {
    render(
      <>
        <button type="button">elsewhere</button>
        <GrantCard />
      </>,
    );
    const before = screen.getByRole("button", { name: "elsewhere" });
    before.focus();

    await act(async () => {
      await mint("confirm_booking", { slot_id: "s1" });
    });

    const dialog = await screen.findByRole("alertdialog");
    expect(document.activeElement).toBe(dialog);

    await act(async () => {
      resetGrants();
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.activeElement).toBe(before);
  });

  it("announces the request assertively, including the wait", async () => {
    await mint("confirm_booking", { slot_id: "s1" });
    render(<GrantCard />);

    const alerts = await screen.findAllByRole("alert");
    const text = alerts.map((a) => a.textContent).join(" ");
    expect(text).toMatch(/Approval required/);
    expect(text).toMatch(/Approve available in 1\.5 seconds/);
  });

  it("carries no CAPTCHA, puzzle, or challenge of any kind", async () => {
    await mint("confirm_booking", { slot_id: "s1" });
    render(<GrantCard />);
    const dialog = await screen.findByRole("alertdialog");

    // Approve, Deny. Nothing to solve (CONVENTIONS.md §5).
    const buttons = [...dialog.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons.some((b) => /^Approve/.test(b ?? ""))).toBe(true);
    expect(buttons.some((b) => b === "Deny")).toBe(true);
    expect(dialog.textContent).not.toMatch(/captcha|puzzle|verify you are human|type the/i);
    expect(dialog.querySelector("canvas")).toBeNull();
    expect(dialog.querySelector("img")).toBeNull();
  });
});

describe("GrantCard — the 1.5 s dwell", () => {
  it("disables Approve on render, without blocking the thread", async () => {
    await mint("confirm_booking", { slot_id: "s1" });
    render(<GrantCard />);

    const approveButton = await screen.findByTestId("grant-approve");
    expect((approveButton as HTMLButtonElement).disabled).toBe(true);
    // Deny stays available throughout: a user must always be able to say no.
    expect((screen.getByTestId("grant-deny") as HTMLButtonElement).disabled).toBe(false);
  });

  it("enables Approve once the dwell elapses", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    await mint("confirm_booking", { slot_id: "s1" }, now);
    render(<GrantCard />);

    expect((screen.getByTestId("grant-approve") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      vi.setSystemTime(now + DWELL_MS + 100);
      vi.advanceTimersByTime(300);
    });

    expect((screen.getByTestId("grant-approve") as HTMLButtonElement).disabled).toBe(false);
    vi.useRealTimers();
  });

  it("shows the wait as a countdown in text", async () => {
    await mint("confirm_booking", { slot_id: "s1" });
    render(<GrantCard />);
    expect((await screen.findByTestId("grant-countdown")).textContent).toMatch(
      /Approve available in \d\.\d seconds/,
    );
  });
});

describe("GrantCard — approval evidence", () => {
  it("rejects an untrusted event and says so, without approving", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    await mint("confirm_booking", { slot_id: "s1" }, now);
    render(<GrantCard />);

    await act(async () => {
      vi.setSystemTime(now + DWELL_MS + 100);
      vi.advanceTimersByTime(300);
    });

    // fireEvent dispatches a synthesised event: isTrusted is false, which is
    // exactly the JS-synthesised click this check exists to catch.
    fireEvent.click(screen.getByTestId("grant-approve"));

    expect(allGrants()[0]?.status).toBe("pending");
    expect(screen.getByText(/was not a real user action/)).toBeDefined();
    vi.useRealTimers();
  });

  it("Deny marks the grant denied and closes the card", async () => {
    await mint("confirm_booking", { slot_id: "s1" });
    render(<GrantCard />);

    fireEvent.click(await screen.findByTestId("grant-deny"));

    expect(allGrants()[0]?.status).toBe("denied");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("appears when confirm_booking mints a grant, end to end", async () => {
    const slotId = await reachReadyToConfirm();
    render(<GrantCard />);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    await act(async () => {
      await confirmBooking.run({ slot_id: slotId });
    });

    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(screen.getByText(slotId)).toBeDefined();
    expect(store().booking).toBeNull();
  });

  it("states plainly that the page cannot tell an automated click from yours", async () => {
    await mint("confirm_booking", { slot_id: "s1" });
    render(<GrantCard />);
    // The honest #288 position, on the card itself rather than only in the README.
    expect(
      await screen.findByText(/cannot tell an automated click from yours/),
    ).toBeDefined();
  });
});
