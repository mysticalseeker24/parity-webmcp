import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import App from "./App";
import { clearHoldTimer } from "./lib/timers";
import { startRegistry, type Registry } from "./lib/registry";
import { bookingStore } from "./store";
import { installMockModelContext } from "./test/webmcpMock";
import { TOOLS } from "./tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;
let user: UserEvent;

const store = () => bookingStore.getState();

beforeEach(() => {
  clearHoldTimer();
  bookingStore.getState().reset();
  ({ restore } = installMockModelContext(true));
  registry = startRegistry(TOOLS);
  user = userEvent.setup();
});

afterEach(() => {
  cleanup();
  registry?.stop();
  registry = null;
  clearHoldTimer();
  restore?.();
  restore = null;
});

describe("App shell", () => {
  it("states the WebMCP mode in words, not by colour", async () => {
    render(<App />);
    expect((await screen.findByTestId("detection")).textContent).toMatch(/WebMCP: detected/);
  });

  it("says so plainly when WebMCP is absent, and still offers the flow", async () => {
    registry?.stop();
    restore?.();
    ({ restore } = installMockModelContext(false));
    registry = startRegistry(TOOLS);

    render(<App />);
    expect((await screen.findByTestId("detection")).textContent).toMatch(/not detected/);
    expect(screen.getByRole("button", { name: "Find providers" })).toBeDefined();
  });

  it("mounts both live regions before any announcement arrives", () => {
    render(<App />);
    expect(screen.getByTestId("live-polite").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByTestId("live-assertive").getAttribute("aria-live")).toBe("assertive");
  });

  it("has a skip link as the first tab stop", async () => {
    render(<App />);
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Skip to main content");
  });

  it("gives every section a heading, in document order", () => {
    render(<App />);
    // The step number is an aria-hidden badge, so it is in the text content but
    // not in the accessible name.
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "How this page talks to an agent",
      "Your booking",
      "1Find a provider",
      "2Choose a provider",
      "3Pick a time",
      "4Patient details",
      "What just happened",
      "Activity trail",
      "Live tools",
    ]);
    expect(screen.getByRole("link", { name: "GitHub" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Choose a provider" })).toBeDefined();
  });
});

describe("the whole booking, keyboard only", () => {
  it("walks search → select → hold → intake → confirm with no mouse", async () => {
    render(<App />);

    // --- 1. Search. Tab to the specialty select and submit the form.
    const specialty = screen.getByLabelText("Specialty");
    specialty.focus();
    await user.selectOptions(specialty, "neurology");
    await user.keyboard("{Tab}"); // insurance
    await user.keyboard("{Tab}"); // first accommodation checkbox
    const wheelchair = screen.getByLabelText(/Wheelchair accessible/, {
      selector: "#search-acc-wheelchair_accessible",
    });
    expect(document.activeElement).toBe(wheelchair);
    await user.keyboard(" "); // check it
    expect((wheelchair as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("button", { name: "Find providers" }));
    expect(store().lastSearch?.result_ids.length).toBeGreaterThan(0);

    // --- 2. Select a provider with Enter on its button.
    const results = screen.getByRole("region", { name: "Choose a provider" });
    const selectButton = within(results).getAllByRole("button", { name: /^Select Dr\./ })[0]!;
    selectButton.focus();
    await user.keyboard("{Enter}");
    expect(store().stage).toBe("provider_selected");

    // --- 3. Hold a slot from the grid using arrows and Enter.
    const grid = await screen.findByRole("table");
    const firstCell = within(grid).getAllByRole("button")[0]!;
    firstCell.focus();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Enter}");
    expect(store().stage).toBe("slot_held");
    expect(store().heldSlot).not.toBeNull();

    // --- 4. Intake, typing into real labelled fields.
    await user.type(screen.getByLabelText("Patient name"), "Rosa Quintero");
    await user.type(screen.getByLabelText("Date of birth"), "1984-03-09");
    await user.type(screen.getByLabelText("Reason for visit"), "migraine review");
    await user.click(screen.getByRole("button", { name: "Save patient details" }));
    expect(store().stage).toBe("intake_complete");

    // --- 5. Confirm. The gate refuses without page approval, by design.
    const confirm = await screen.findByRole("button", { name: "Confirm booking" });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(store().booking).toBeNull();
    // The grant card takes over: approval is a separate, human-only step.
    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect((await screen.findAllByText(/must approve/)).length).toBeGreaterThan(0);
  }, 30_000);
});

describe("provider list", () => {
  it("shows a refusal inline and links it to the button that caused it", async () => {
    // Search requiring ASL, then select a provider that does not offer it.
    await registry!.execute("find_providers", {
      specialty: "neurology",
      accommodations: ["asl_interpreter"],
    });
    // Put a non-matching provider into the visible results.
    store().recordSearch({ ...store().lastSearch!, result_ids: ["p02"] });

    render(<App />);
    const button = await screen.findByRole("button", { name: /^Select Dr\. Teodora/ });
    await user.click(button);

    // Scoped: the audit trail legitimately shows the same reason text.
    const results = screen.getByRole("region", { name: "Choose a provider" });
    const error = await within(results).findByText(/does not offer ASL interpreter/);
    expect(button.getAttribute("aria-describedby")).toBe(error.closest("p")!.id);
    expect(store().stage).toBe("browsing");
  });

  it("labels accommodations with words, never an icon alone", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    render(<App />);
    const list = await screen.findByRole("list", {
      name: /Accommodations offered by Dr\. Amara Okafor/,
    });
    expect(within(list).getByText("Wheelchair accessible")).toBeDefined();
  });
});

describe("intake form", () => {
  it("surfaces the tool's field-level correction on the input it belongs to", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });

    render(<App />);
    await user.type(screen.getByLabelText("Date of birth"), "14/10/2026");
    await user.click(screen.getByRole("button", { name: "Save patient details" }));

    const dob = screen.getByLabelText("Date of birth");
    const intake = screen.getByRole("region", { name: "Patient details" });
    expect(await within(intake).findByText(/must be ISO 8601/)).toBeDefined();
    expect(dob.getAttribute("aria-invalid")).toBe("true");
    expect(dob.getAttribute("aria-describedby")).toMatch(/dob-error/);
  });

  it("lists exactly what set_intake still needs", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });
    await registry!.execute("set_intake", { patient_name: "Rosa Quintero" });

    render(<App />);
    expect(
      await screen.findByText(/Still needed: Date of birth, Reason for visit\./),
    ).toBeDefined();
  });

  it("uses a text input with an ISO hint rather than a date picker", async () => {
    await registry!.execute("find_providers", { specialty: "neurology" });
    await registry!.execute("select_provider", { provider_id: "p01" });
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await registry!.execute("hold_slot", { slot_id: avail.data.slots[0]!.id });

    render(<App />);
    const dob = screen.getByLabelText("Date of birth");
    expect(dob.getAttribute("type")).toBe("text");
    expect(screen.getByText(/for example 1984-03-09/)).toBeDefined();
  });
});
