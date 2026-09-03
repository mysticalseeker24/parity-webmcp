import { bookingStore, type BookingState, type BookingStore } from "../store";
import type { AnyDefinedTool } from "./defineTool";
import type { StoreApi } from "zustand/vanilla";

/**
 * The registry. The ONLY file that calls `document.modelContext.registerTool`.
 *
 * Registration is a pure function of store state:
 *
 *     liveTools = allTools.filter(t => t.available(state))
 *
 * On every store change the live set is recomputed and diffed against what is
 * registered. Tools that left the set are aborted (unregistered); tools that
 * entered it are registered with a fresh AbortController. Nothing registers
 * imperatively from a component or an event handler (CONVENTIONS.md §3, §8).
 *
 * Illegal operations are prevented by absence: a tool that is not legal in the
 * current stage is not registered, so it cannot be called.
 */

/** Chrome's guidance: past ~7 live tools the agent starts choosing badly. */
export const MAX_LIVE_TOOLS = 7;

export interface Registry {
  /** Tools registered right now — the palette's fallback when WebMCP is absent. */
  readonly getLiveTools: () => readonly AnyDefinedTool[];
  readonly hasModelContext: boolean;
  readonly stop: () => void;
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

export function startRegistry(
  tools: readonly AnyDefinedTool[],
  store: StoreApi<BookingStore> = bookingStore,
): Registry {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`[registry] duplicate tool name "${tool.name}"`);
    names.add(tool.name);
  }

  // Feature-detect once. Everything degrades to a working visual app without it.
  const modelContext =
    typeof document.modelContext?.registerTool === "function" ? document.modelContext : undefined;

  const registered = new Map<string, { tool: AnyDefinedTool; controller: AbortController }>();

  function register(tool: AnyDefinedTool): void {
    const controller = new AbortController();
    registered.set(tool.name, { tool, controller });
    if (!modelContext) return;
    void modelContext
      .registerTool(tool.toModelContextTool(), { signal: controller.signal })
      .catch((error: unknown) => {
        // A failed registration must not be mistaken for a live tool.
        registered.delete(tool.name);
        console.error(`[registry] registerTool(${tool.name}) failed`, error);
      });
  }

  function unregister(name: string): void {
    registered.get(name)?.controller.abort();
    registered.delete(name);
  }

  function sync(state: BookingState): void {
    const live = tools.filter((tool) => tool.available(state));

    if (import.meta.env.DEV && live.length > MAX_LIVE_TOOLS) {
      throw new Error(
        `[registry] ${live.length} tools live in stage "${state.stage}" (max ${MAX_LIVE_TOOLS}): ${live.map((t) => t.name).join(", ")}`,
      );
    }

    const liveNames = new Set(live.map((tool) => tool.name));
    for (const name of [...registered.keys()]) {
      if (!liveNames.has(name)) unregister(name);
    }
    for (const tool of live) {
      if (!registered.has(tool.name)) register(tool);
    }

    // Publish the live set so get_booking_state can report it. Guarded, or
    // this write would re-enter sync() forever.
    const sorted = [...liveNames].sort();
    if (!sameNames(sorted, state.liveTools)) store.getState().setLiveTools(sorted);
  }

  // Initial sync first, subscribe second: if the initial sync throws (a dev
  // budget violation), no subscription is left behind to throw again on the
  // next store change.
  sync(store.getState());
  const unsubscribe = store.subscribe(sync);

  return {
    getLiveTools: () => [...registered.values()].map((entry) => entry.tool),
    hasModelContext: modelContext !== undefined,
    stop: () => {
      unsubscribe();
      for (const name of [...registered.keys()]) unregister(name);
    },
  };
}
