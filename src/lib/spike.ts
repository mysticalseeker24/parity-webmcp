/**
 * Phase 1 spike — THROWAWAY.
 *
 * Sole purpose: prove that `document.modelContext.registerTool()` works from a
 * static page loaded in ChatGPT's built-in browser, and that the tool appears
 * under Site tools and executes. Nothing here survives Phase 2; every real tool
 * goes through `defineTool` (CLAUDE.md, "Definition of done").
 *
 * Constraints honoured here deliberately:
 *  - `document.modelContext`, never `navigator.modelContext` (TOOLS.md §2)
 *  - imperative API only, no declarative HTML form attributes (TOOLS.md §4)
 *  - top-level page only, never an iframe (TOOLS.md §1)
 */

export type SpikeStatus =
  | { kind: "unsupported"; detail: string }
  | { kind: "registered"; toolName: string }
  | { kind: "failed"; detail: string };

/** The one hardcoded tool. Empty input schema, read-only, trivially verifiable. */
const GET_PAGE_TITLE = {
  name: "get_page_title",
  title: "Get page title",
  description:
    "Return the title of the currently open Parity page. Read-only spike tool used to verify that WebMCP tool registration reaches this browser.",
  inputSchema: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  execute: () => ({ title: document.title }),
} as const satisfies WebMCP.ModelContextTool;

/**
 * Feature-detect and register. Returns what actually happened so the page can
 * show it in large text — the whole point of the spike is that a human standing
 * in front of the screen can tell detection from failure at a glance.
 *
 * @param signal Aborting it unregisters the tool (TOOLS.md §3).
 */
export async function runSpike(signal: AbortSignal): Promise<SpikeStatus> {
  if (typeof document.modelContext?.registerTool !== "function") {
    return {
      kind: "unsupported",
      detail:
        "document.modelContext.registerTool is not a function. Open this page in the ChatGPT desktop app's built-in browser (model GPT-5.6 Sol or Terra), or Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled.",
    };
  }

  if (window.top !== window.self) {
    return {
      kind: "failed",
      detail:
        "This document is inside an iframe. ChatGPT's browser does not discover tools registered in frames; tools must be registered by the top-level page.",
    };
  }

  try {
    await document.modelContext.registerTool(GET_PAGE_TITLE, { signal });
    return { kind: "registered", toolName: GET_PAGE_TITLE.name };
  } catch (error) {
    return {
      kind: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Read the registry back through the same discovery API the agent uses. Phase 1
 * only prints the names; Phase 5's command palette is built on this call.
 */
export async function listRegisteredTools(): Promise<string[]> {
  if (typeof document.modelContext?.getTools !== "function") return [];
  const tools = await document.modelContext.getTools();
  return tools.map((tool) => tool.name);
}
