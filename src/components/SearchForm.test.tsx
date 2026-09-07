import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { SearchForm } from "./SearchForm";
import { ConstraintSummary } from "./ConstraintSummary";
import { startRegistry, type Registry } from "../lib/registry";
import { bookingStore } from "../store";
import { installMockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;
let user: UserEvent;

const store = () => bookingStore.getState();

beforeEach(() => {
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  registry?.stop();
  registry = null;
  restore?.();
  restore = null;
});

const specialty = () => screen.getByLabelText("Specialty") as HTMLSelectElement;
const insurance = () => screen.getByLabelText("Insurance plan") as HTMLSelectElement;

describe("SearchForm — one copy of the search, not two", () => {
  it("mirrors a search run from anywhere else", async () => {
    render(<SearchForm />);
    expect(specialty().value).toBe("neurology");

    // The agent or the palette searches. This form must not go on claiming
    // criteria nobody searched for while the results below it show another
    // specialty — that was the bug: form said Neurology, list said Physio.
    await registry!.execute("find_providers", {
      specialty: "physiotherapy",
      insurance: "Lantern Plus",
      accommodations: ["hoist_transfer"],
    });

    await waitFor(() => expect(specialty().value).toBe("physiotherapy"));
    expect(insurance().value).toBe("Lantern Plus");
    expect(
      (screen.getByLabelText(/Hoist transfer/) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it("keeps its own summary after its own submit", async () => {
    render(<SearchForm />);
    await user.selectOptions(specialty(), "physiotherapy");
    await user.click(screen.getByRole("button", { name: "Find providers" }));

    // The mirror must not wipe the status line this form just wrote.
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/physiotherapy provider/),
    );
  });

  it("drops a stale summary when someone else searches", async () => {
    render(<SearchForm />);
    await user.click(screen.getByRole("button", { name: "Find providers" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toBe(""));

    // The registry has already announced the new search; repeating an older
    // one here would be both stale and a second announcement.
    await registry!.execute("find_providers", { specialty: "audiology" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
  });

  it("returns to its starting state on reset", async () => {
    render(<SearchForm />);
    await registry!.execute("find_providers", { specialty: "audiology" });
    await waitFor(() => expect(specialty().value).toBe("audiology"));

    store().reset();
    await waitFor(() => expect(specialty().value).toBe("neurology"));
    expect(insurance().value).toBe("");
  });

  it("does not clobber edits the user has not submitted yet", async () => {
    render(<SearchForm />);
    await user.selectOptions(specialty(), "rheumatology");
    // No search has happened, so nothing should overwrite the choice.
    store().appendAudit({
      id: "a1",
      at: 0,
      actor: "agent",
      tool: "get_booking_state",
      input: {},
      result: { ok: true, data: {}, human_summary: "x" },
    });
    expect(specialty().value).toBe("rheumatology");
  });
});

describe("ConstraintSummary — constraints that filter the calendar are visible", () => {
  it("shows nothing until a constraint exists", () => {
    render(<ConstraintSummary />);
    expect(screen.queryByRole("region", { name: /Narrowing these times/i })).toBeNull();
  });

  it("states the paratransit window that is hiding slots", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    await registry!.execute("set_transport_constraint", {
      earliest_pickup: "10:00",
      latest_return: "14:00",
      note: "Kerbside pickup only",
    });

    render(<ConstraintSummary />);
    // Without this the window silently removes half the calendar and nothing
    // on the page says why.
    const panel = screen.getByRole("region", { name: /Narrowing these times/i });
    expect(panel.textContent).toMatch(/10:00/);
    expect(panel.textContent).toMatch(/14:00/);
    expect(panel.textContent).toMatch(/Kerbside pickup only/);
  });

  it("names the companion and their window", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    await registry!.execute("set_companion_constraint", {
      name: "Ruth",
      available_from: "09:00",
      available_to: "12:00",
    });

    render(<ConstraintSummary />);
    const panel = screen.getByRole("region", { name: /Narrowing these times/i });
    expect(panel.textContent).toMatch(/Ruth can attend/);
    expect(panel.textContent).toMatch(/09:00/);
  });

  it("says the constraints are fixed once availability has been fetched", async () => {
    await registry!.execute("select_provider", { provider_id: "p01" });
    await registry!.execute("set_transport_constraint", {
      earliest_pickup: "10:00",
      latest_return: "14:00",
    });
    await registry!.execute("get_availability", {});

    render(<ConstraintSummary />);
    expect(
      screen.getByRole("region", { name: /Narrowing these times/i }).textContent,
    ).toMatch(/fixed for this booking/);
  });
});
