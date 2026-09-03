import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { startRegistry, type Registry } from "./lib/registry";
import { bookingStore } from "./store";
import { installMockModelContext } from "./test/webmcpMock";
import { TOOLS } from "./tools";

let restore: (() => void) | null = null;
let registry: Registry | null = null;

beforeEach(() => bookingStore.getState().reset());

afterEach(() => {
  cleanup();
  registry?.stop();
  registry = null;
  restore?.();
  restore = null;
});

describe("<App />", () => {
  it("shows DETECTED and the live tools from getTools() when WebMCP is present", async () => {
    ({ restore } = installMockModelContext(true));
    registry = startRegistry(TOOLS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("detection").textContent).toMatch(/modelContext DETECTED/);
    });
    await waitFor(() => {
      expect(screen.getByTestId("registry-listing").textContent).toBe(
        "find_providers, get_booking_state, list_accommodations, select_provider",
      );
    });
  });

  it("falls back to the store's live tools when WebMCP is absent", async () => {
    ({ restore } = installMockModelContext(false));
    registry = startRegistry(TOOLS);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId("detection").textContent).toMatch(/NOT DETECTED/);
    });
    expect(screen.getByTestId("registry-listing").textContent).toBe(
      "find_providers, get_booking_state, list_accommodations, select_provider",
    );
    expect(screen.getByText(/enable-webmcp-testing/)).toBeDefined();
  });

  it("re-renders the listing on toolchange, in lockstep with the agent's view", async () => {
    ({ restore } = installMockModelContext(true));
    registry = startRegistry(TOOLS);
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("registry-listing").textContent).toContain("find_providers");
    });

    bookingStore.getState().selectProvider("p01");

    await waitFor(() => {
      expect(screen.getByTestId("stage").textContent).toBe("provider_selected");
      expect(screen.getByTestId("registry-listing").textContent).toContain("get_availability");
    });
  });
});
