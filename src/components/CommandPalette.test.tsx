import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import * as z from "zod";
import { CommandPalette } from "./CommandPalette";
import { defineTool } from "../lib/defineTool";
import { startRegistry, type Registry } from "../lib/registry";
import { ok } from "../lib/result";
import { clearHoldTimer } from "../lib/timers";
import { bookingStore } from "../store";
import { installMockModelContext, type MockModelContext } from "../test/webmcpMock";
import { TOOLS } from "../tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;
let mc: MockModelContext | undefined;
let user: UserEvent;

const store = () => bookingStore.getState();

beforeEach(() => {
  clearHoldTimer();
  bookingStore.getState().reset();
  ({ context: mc, restore } = installMockModelContext(true));
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

async function openPalette() {
  render(<CommandPalette />);
  await user.click(screen.getByRole("button", { name: /Commands/ }));
  return screen.findByRole("combobox");
}

describe("palette — accessible combobox", () => {
  it("opens with Ctrl+K and closes with Escape, restoring focus", async () => {
    render(
      <>
        <button type="button">before</button>
        <CommandPalette />
      </>,
    );
    const opener = screen.getByRole("button", { name: "before" });
    opener.focus();

    await user.keyboard("{Control>}k{/Control}");
    const combobox = await screen.findByRole("combobox");
    expect(document.activeElement).toBe(combobox);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("is a labelled combobox driving a listbox with aria-activedescendant", async () => {
    const combobox = await openPalette();
    expect(combobox.getAttribute("aria-controls")).toBe("palette-listbox");
    expect(screen.getByRole("listbox", { name: "Available commands" })).toBeDefined();

    const active = combobox.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.getAttribute("aria-selected")).toBe("true");
  });

  it("announces the result count and updates it as you type", async () => {
    const combobox = await openPalette();
    expect(screen.getByRole("status").textContent).toBe("5 commands available");

    // "provider" also matches list_accommodations, whose description mentions
    // find_providers — the filter searches descriptions, not just labels.
    await user.type(combobox, "provider");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toMatch(/^3 commands available$/),
    );

    await user.clear(combobox);
    await user.type(combobox, "zzzz");
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("0 commands available"),
    );
  });

  it("moves the active option with arrow keys", async () => {
    const combobox = await openPalette();
    const first = combobox.getAttribute("aria-activedescendant");
    await user.keyboard("{ArrowDown}");
    expect(combobox.getAttribute("aria-activedescendant")).not.toBe(first);
    await user.keyboard("{ArrowUp}");
    expect(combobox.getAttribute("aria-activedescendant")).toBe(first);
  });

  it("groups commands in workflow order (#255)", async () => {
    await openPalette();
    const groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Orientation",
      "Find a provider",
    ]);
  });
});

describe("palette — search ranks by relevance, not workflow order", () => {
  it("puts the tool you named first, not one whose description mentions it", async () => {
    // Regression: typing "find" made list_accommodations the active option — it
    // matches only because its description mentions find_providers, and it
    // sorted first because its group is "orient". Enter then opened the wrong
    // tool, one with no fields, which read as "the button does nothing".
    const combobox = await openPalette();
    await user.type(combobox, "find");

    await waitFor(() => {
      const options = within(screen.getByRole("listbox")).getAllByRole("option");
      expect(options[0]?.textContent).toMatch(/find_providers/);
      expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    });
    expect(combobox.getAttribute("aria-activedescendant")).toBe("palette-option-find_providers");
  });

  it("Enter on that query opens Find providers, with its specialty field", async () => {
    const combobox = await openPalette();
    await user.type(combobox, "find");
    await user.keyboard("{Enter}");

    expect(await screen.findByLabelText(/Medical specialty needed/)).toBeDefined();
    expect(screen.getByRole("button", { name: /^Run Find providers$/ })).toBeDefined();
  });

  it("ranks an exact tool name above a partial one", async () => {
    const combobox = await openPalette();
    await user.type(combobox, "select_provider");
    await waitFor(() => {
      const options = within(screen.getByRole("listbox")).getAllByRole("option");
      expect(options[0]?.textContent).toMatch(/select_provider/);
    });
  });

  it("still uses workflow order when there is no query", async () => {
    await openPalette();
    const groups = within(screen.getByRole("listbox")).getAllByRole("group");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Orientation",
      "Find a provider",
    ]);
  });
});

describe("palette — a failed run cannot strand the dialog", () => {
  it("re-enables Run and keeps focus inside after the tool throws", async () => {
    const combobox = await openPalette();
    await user.type(combobox, "find");
    await user.keyboard("{Enter}");

    const tool = registry!.getTool("find_providers")!;
    const spy = vi.spyOn(tool, "run").mockRejectedValue(new Error("network is down"));

    await user.selectOptions(screen.getByLabelText(/Medical specialty needed/), "neurology");
    await user.click(screen.getByRole("button", { name: /^Run Find providers$/ }));

    // Busy must reset, or the button stays disabled forever — and a disabled
    // control hands focus to <body>, which used to take Escape down with it.
    await waitFor(() => {
      const run = screen.getByRole("button", { name: /^Run Find providers$/ }) as HTMLButtonElement;
      expect(run.disabled).toBe(false);
    });
    expect(document.activeElement).not.toBe(document.body);
    spy.mockRestore();
  });

  it("Escape closes even when focus has fallen outside the dialog", async () => {
    await openPalette();
    // Simulate focus being lost, which is what a disabled control does.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("palette — reads the browser as its source of truth", () => {
  it("says it is reading getTools(), and lists exactly what the browser has", async () => {
    await openPalette();
    expect(screen.getByText(/Reading document\.modelContext\.getTools\(\)/)).toBeDefined();
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("get_booking_state"),
        expect.stringContaining("find_providers"),
      ]),
    );
  });

  it("falls back to the local registry when WebMCP is absent", async () => {
    registry?.stop();
    restore?.();
    ({ restore } = installMockModelContext(false));
    registry = startRegistry(TOOLS);

    await openPalette();
    expect(screen.getByText(/Reading the local registry/)).toBeDefined();
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(5);
  });

  it("re-reads on toolchange, so it moves in lockstep with the agent", async () => {
    await openPalette();
    expect(screen.queryByText(/get_availability/)).toBeNull();

    store().selectProvider("p01");

    await waitFor(() => expect(screen.getByText(/get_availability/)).toBeDefined());
  });

  it("renders a tool it has never seen, from its schema alone", async () => {
    // The whole point: the palette is generic. If it needed a local definition
    // it would be a second command list wearing a disguise.
    const stranger = defineTool({
      name: "unknown_tool",
      humanLabel: "Unknown",
      group: "manage",
      description: "A tool the local map has never heard of.",
      schema: z.object({
        colour: z.enum(["red", "blue"]).describe("Pick a colour"),
        note: z.string().describe("Say something"),
      }),
      available: () => true,
      unavailableReason: () => ({ reason_code: "no_hold", reason: "x", unlock_by: "y" }),
      execute: () => ok({ fine: true }, "Did the thing."),
      announce: () => "did the thing.",
    });
    // Registered directly with the browser, bypassing our registry entirely.
    await mc!.registerTool(stranger.toModelContextTool(() => {}));

    await openPalette();
    const option = await screen.findByRole("option", { name: /unknown_tool/ });
    expect(option.textContent).toMatch(/not in the local map/);
    await user.click(option);

    expect(screen.getByLabelText(/^Pick a colour/)).toBeDefined();
    expect(screen.getByLabelText(/^Say something/)).toBeDefined();
    // And the enum still became a select, from the schema alone.
    expect((screen.getByLabelText(/^Pick a colour/) as HTMLSelectElement).tagName).toBe("SELECT");
  });
});

describe("palette — form generation from JSON Schema (#286)", () => {
  it("uses the field description as the label, never the field name", async () => {
    await openPalette();
    await user.click(await screen.findByText(/find_providers/));

    // The Zod .describe() text, verbatim.
    expect(screen.getByLabelText(/Medical specialty needed \(required\)/)).toBeDefined();
    expect(screen.queryByLabelText("specialty")).toBeNull();
  });

  it("renders an enum as a select carrying the enum members", async () => {
    await openPalette();
    await user.click(await screen.findByText(/find_providers/));

    const select = screen.getByLabelText(/Medical specialty needed/) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.value)).toEqual([
      "",
      "neurology",
      "rheumatology",
      "audiology",
      "physiotherapy",
    ]);
  });

  it("renders an array of enum as a checkbox group", async () => {
    await openPalette();
    await user.click(await screen.findByText(/find_providers/));

    const group = screen.getByRole("group", { name: /Accommodations the provider must offer/ });
    expect(within(group).getAllByRole("checkbox").length).toBe(10);
  });

  it("marks required fields in text, not by colour", async () => {
    await openPalette();
    await user.click(await screen.findByText(/find_providers/));
    expect(screen.getByLabelText(/Medical specialty needed \(required\)/)).toBeDefined();
    // radius_km is optional, so it carries no marker.
    expect(screen.getByLabelText(/^Maximum distance from the patient, in kilometres$/)).toBeDefined();
  });

  it("says so when a command takes no options", async () => {
    await openPalette();
    await user.click(await screen.findByText(/list_accommodations/));
    expect(screen.getByText("This command takes no options.")).toBeDefined();
  });
});

describe("palette — execution goes through the browser", () => {
  it("executes with a JSON string and renders the ok envelope", async () => {
    await openPalette();
    await user.click(await screen.findByText(/find_providers/));
    await user.selectOptions(screen.getByLabelText(/Medical specialty needed/), "neurology");
    await user.click(screen.getByRole("button", { name: /^Run Find providers$/ }));

    // Same path as the agent: executeTool with a JSON *string*.
    await waitFor(() => expect(mc!.executeCalls.length).toBeGreaterThan(0));
    const call = mc!.executeCalls.at(-1)!;
    expect(call.name).toBe("find_providers");
    expect(typeof call.args).toBe("string");
    expect(JSON.parse(call.args)).toEqual({ specialty: "neurology" });

    expect(await screen.findByText(/3 neurology providers\./)).toBeDefined();
  });

  it("attributes the call to the human in the audit trail", async () => {
    await openPalette();
    await user.click(await screen.findByText(/list_accommodations/));
    await user.click(screen.getByRole("button", { name: /^Run List accommodation options$/ }));

    await waitFor(() => expect(store().audit.at(-1)?.actor).toBe("human"));
    expect(store().audit.at(-1)?.tool).toBe("list_accommodations");
  });

  it("renders a refusal as kind, reason and an actionable next step", async () => {
    await openPalette();
    await user.click(await screen.findByText(/find_providers/));
    await user.selectOptions(screen.getByLabelText(/Medical specialty needed/), "audiology");
    await user.click(
      within(screen.getByRole("group", { name: /Accommodations/ })).getByLabelText(
        "wheelchair accessible",
      ),
    );
    await user.click(screen.getByRole("button", { name: /^Run Find providers$/ }));

    expect(await screen.findByText(/unavailable/)).toBeDefined();
    expect(screen.getByText(/constraint eliminated 3/)).toBeDefined();
    expect(screen.getByText(/Next: run “find_providers”\./)).toBeDefined();
  });

  it("omits fields left blank rather than sending empty strings", async () => {
    await openPalette();
    await user.click(await screen.findByText(/find_providers/));
    await user.selectOptions(screen.getByLabelText(/Medical specialty needed/), "neurology");
    await user.type(screen.getByLabelText(/A language the provider must speak/), "Yoruba");
    await user.click(screen.getByRole("button", { name: /^Run Find providers$/ }));

    await waitFor(() => expect(mc!.executeCalls.length).toBeGreaterThan(0));
    expect(JSON.parse(mc!.executeCalls.at(-1)!.args)).toEqual({
      specialty: "neurology",
      language: "Yoruba",
    });
  });
});

describe("palette — the whole booking, keyboard only", () => {
  it("completes search → select → hold → intake with no mouse and no agent", async () => {
    render(<CommandPalette />);

    async function run(match: RegExp, fill: () => Promise<void>) {
      await user.keyboard("{Control>}k{/Control}");
      const combobox = await screen.findByRole("combobox");
      await user.type(combobox, match.source.replace(/[\\^$]/g, ""));
      await user.click(await screen.findByText(match));
      await fill();
      const runButton = screen.getByRole("button", { name: /^Run / });
      runButton.focus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
      // Escape from the form returns to the list; Escape again closes. Two
      // levels, so a mis-typed argument does not lose the whole palette.
      await user.keyboard("{Escape}");
      const search = await screen.findByRole("combobox", { name: /Search available commands/ });
      search.focus();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }

    await run(/find_providers/, async () => {
      await user.selectOptions(screen.getByLabelText(/Medical specialty needed/), "neurology");
    });
    expect(store().lastSearch?.total_matches).toBe(3);

    await run(/select_provider/, async () => {
      await user.type(screen.getByLabelText(/Provider id from find_providers/), "p01");
    });
    expect(store().stage).toBe("provider_selected");

    await run(/get_availability/, async () => {});
    expect(store().hasFetchedAvailability).toBe(true);

    const slotId = `s_p01_${store().lastSearch ? "" : ""}`;
    void slotId;
    const avail = (await registry!.execute("get_availability", {})) as {
      data: { slots: { id: string }[] };
    };
    await run(/hold_slot/, async () => {
      await user.type(
        screen.getByLabelText(/Slot id from get_availability/),
        avail.data.slots[0]!.id,
      );
    });
    expect(store().stage).toBe("slot_held");

    await run(/set_intake/, async () => {
      await user.type(screen.getByLabelText(/Patient's full name/), "Rosa Quintero");
      await user.type(screen.getByLabelText(/Date of birth/), "1984-03-09");
      await user.type(screen.getByLabelText(/Reason for the visit/), "migraine");
    });
    expect(store().stage).toBe("intake_complete");
  }, 60_000);
});
