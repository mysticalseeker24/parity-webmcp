import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { installMockModelContext } from "./test/webmcpMock";

let restore: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

describe("<App /> — the spike's only output", () => {
  it("shows DETECTED and lists the registry when WebMCP is present", async () => {
    ({ restore } = installMockModelContext(true));
    document.title = "Parity — WebMCP spike";

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/document\.modelContext DETECTED/)).toBeDefined();
    });
    // The listing must come from getTools(), not from a hardcoded string —
    // this is the assertion that the page reads the registry back.
    await waitFor(() => {
      expect(screen.getByTestId("registry-listing").textContent).toBe("get_page_title");
    });
    expect(screen.getByTestId("page-title").textContent).toBe("Parity — WebMCP spike");
  });

  it("shows NOT DETECTED plus actionable next steps when WebMCP is absent", async () => {
    ({ restore } = installMockModelContext(false));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/document\.modelContext NOT DETECTED/)).toBeDefined();
    });
    expect(screen.getByText(/enable-webmcp-testing/)).toBeDefined();
  });

  it("announces the verdict in a live region", async () => {
    ({ restore } = installMockModelContext(true));

    const { container } = render(<App />);

    await waitFor(() => {
      const live = container.querySelector('[aria-live="polite"]');
      expect(live).not.toBeNull();
      expect(live?.textContent).toMatch(/DETECTED/);
    });
  });

  it("survives StrictMode's double mount without leaving the tool unregistered", async () => {
    // StrictMode mounts, unmounts, remounts. The cleanup aborts the controller,
    // which unregisters. If the second mount did not re-register, Site tools
    // would come up empty in the real browser — this is the failure mode most
    // likely to look like "WebMCP is broken" when the bug is ours.
    const installed = installMockModelContext(true);
    restore = installed.restore;

    const { unmount } = render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/DETECTED/)).toBeDefined();
    });

    unmount();
    cleanup();
    render(<App />);

    await waitFor(async () => {
      const tools = await installed.context!.getTools();
      expect(tools.map((t) => t.name)).toEqual(["get_page_title"]);
    });
  });
});
