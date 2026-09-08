import { bookingStore, newId, type Actor, type BookingState, type BookingStore } from "../store";
import type { AnyDefinedTool } from "./defineTool";
import { isToolResult, type ToolResult } from "./result";
import { captureInverse } from "./undo";
import { encodeToolArgs, parseToolResult } from "./webmcpInterop";
import type { StoreApi } from "zustand/vanilla";

/**
 * The registry. The ONLY file that calls `document.modelContext.registerTool`.
 *
 * Registration is a pure function of store state:
 *
 *     liveTools = allTools.filter(t => t.available(state))
 *
 * On every store change the live set is recomputed and diffed against what is
 * registered: tools that left are aborted, tools that entered are registered
 * with a fresh AbortController. Nothing registers imperatively from a component
 * or an event handler (CONVENTIONS.md §3, §8).
 *
 * Illegal operations are prevented by *absence*: a tool that is not legal in the
 * current stage is not registered, so it cannot be called. Spec issue #167
 * (dynamic tool definitions) is exactly this mechanism.
 */

/**
 * Chrome's guidance: past roughly this many live tools the agent starts
 * choosing badly. The busiest stage is `provider_selected`, which carries the
 * search pair, scheduling, and both access constraints at once.
 */
export const MAX_LIVE_TOOLS = 8;

export interface Registry {
  /** Tools registered right now — the palette's fallback when WebMCP is absent. */
  readonly getLiveTools: () => readonly AnyDefinedTool[];
  readonly hasModelContext: boolean;
  /** Look up a definition by name, live or not — for presentation metadata. */
  readonly getTool: (name: string) => AnyDefinedTool | undefined;
  /** Run a tool through the local path, recording the audit entry. */
  readonly execute: (name: string, input: unknown) => Promise<ToolResult>;
  readonly stop: () => void;
}

// ---------------------------------------------------------------------------
// Actor attribution.
//
// `executeTool()` carries no caller identity: when the palette invokes a tool
// through the browser, the browser calls the same closure the agent's calls
// reach, and the closure cannot tell who asked. There is no field in the WebMCP
// call for it. So the palette marks the next call as human immediately before
// executing, and the wrapper reads and clears that mark. Anything unmarked is
// the agent, which is the safe default: mislabelling an agent action as human
// would understate what the agent did in the audit trail.
// ---------------------------------------------------------------------------

// The mark is keyed by tool name. A bare global marker looks simpler but is
// wrong: `executeAsHuman` sets it and then awaits `getTools()`, and any tool
// call that lands during that await consumes the mark meant for another call.
// That was observed live — an agent's `select_provider` was recorded as "You"
// because the calendar's own `get_availability` had just set the mark. The
// failure direction is the bad one: it understates what the agent did.
let nextActor: { actor: Actor; tool: string } | null = null;

export function setNextActor(actor: Actor, tool?: string): void {
  nextActor = { actor, tool: tool ?? "*" };
}

function takeNextActor(tool: string): Actor {
  if (!nextActor) return "agent";
  if (nextActor.tool !== "*" && nextActor.tool !== tool) return "agent";
  const { actor } = nextActor;
  nextActor = null;
  return actor;
}

/**
 * The running registry. Components reach tools through this rather than
 * importing them: the UI must go through the same execute path the agent uses,
 * never a parallel handler (CONVENTIONS.md §3).
 */
let active: Registry | null = null;

export function getRegistry(): Registry | null {
  return active;
}

/**
 * The one path a human-initiated action takes. Used by every button in the UI
 * and by the command palette.
 *
 * When the browser provides WebMCP we deliberately route through
 * `executeTool()` — the *same* call the agent makes — rather than calling the
 * tool's closure directly. That is what makes "one registry, two callers"
 * literally true rather than a claim in the README. The local path is the
 * fallback for a browser without WebMCP.
 */
export async function executeAsHuman(name: string, input: unknown): Promise<ToolResult> {
  const registry = active;
  if (!registry) throw new Error("[registry] executeAsHuman before startRegistry");

  setNextActor("human", name);

  const mc = document.modelContext;
  if (registry.hasModelContext && typeof mc?.executeTool === "function") {
    const tools = await mc.getTools();
    const tool = tools.find((t) => t.name === name);
    if (tool) {
      const raw = await mc.executeTool(tool, encodeToolArgs((input ?? {}) as Record<string, unknown>));
      const parsed = parseToolResult(raw);
      if (isToolResult(parsed)) return parsed;
      // Shouldn't happen: defineTool guarantees the envelope. Don't strand the
      // caller if it does.
      return { ok: false, kind: "refused", reason: `${name} returned an unreadable result.` };
    }
  }

  // No WebMCP, or the browser has not caught up with the live set yet.
  return registry.execute(name, input);
}

export function startRegistry(
  tools: readonly AnyDefinedTool[],
  store: StoreApi<BookingStore> = bookingStore,
): Registry {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`[registry] duplicate tool name "${tool.name}"`);
    seen.add(tool.name);
  }

  // Feature-detect once. Without it everything still works: the live set is
  // maintained locally so the palette has its fallback (CONVENTIONS.md §7).
  const modelContext =
    typeof document.modelContext?.registerTool === "function" ? document.modelContext : undefined;

  const registered = new Map<string, { tool: AnyDefinedTool; controller: AbortController }>();

  function recordAudit(tool: AnyDefinedTool, actor: Actor, input: unknown, result: ToolResult): void {
    store.getState().appendAudit({
      id: newId("audit"),
      at: Date.now(),
      tool: tool.name,
      actor,
      input,
      result,
    });
  }

  /**
   * Re-registration is deferred while any tool is executing.
   *
   * Spec issue #288 aside, this is issue #300, and this registry's shape is
   * exactly the one it describes: a state-changing tool mutates the store
   * inside its own `execute`, the subscription fires synchronously, and
   * `sync()` aborts that tool's own signal while it is still running.
   *
   * Observed in Chrome 152 against the deployed build: `confirm_booking`
   * rejected the caller with "The operation failed for an unknown transient
   * reason (e.g. out of memory)" *after* the appointment had been committed —
   * so an agent is told the booking failed while the patient has one, and its
   * natural next move is to retry. `release_slot` behaves the same way.
   *
   * Holding the re-sync until nothing is in flight keeps the guarantee the
   * state machine is built on (a tool that is not legal is not registered)
   * while letting a tool finish delivering the result it already produced.
   */
  const executing = new Map<string, number>();
  let deferredState: BookingState | null = null;
  let flushQueued = false;

  function beginExecution(name: string): void {
    executing.set(name, (executing.get(name) ?? 0) + 1);
  }

  function endExecution(name: string): void {
    const n = (executing.get(name) ?? 1) - 1;
    if (n > 0) executing.set(name, n);
    else executing.delete(name);
  }

  /**
   * Only a sync that would unregister a tool *while that tool is running* is
   * dangerous. Everything else re-registers immediately, so the live set stays
   * as prompt as it ever was and the state machine keeps its guarantee.
   */
  function wouldCutRunningTool(live: readonly AnyDefinedTool[]): boolean {
    if (executing.size === 0) return false;
    const liveNames = new Set(live.map((t) => t.name));
    for (const name of executing.keys()) if (!liveNames.has(name)) return true;
    return false;
  }

  /**
   * Deferred to a fresh task, not just to the end of the promise chain.
   *
   * Settling in `.finally()` is still inside the call the browser is awaiting:
   * aborting there rejected the caller anyway. The re-sync has to land after
   * the browser has delivered the result, so it is queued as a macrotask.
   *
   * The cost is a single tick during which a tool that has just become illegal
   * is still registered. Every consequential tool is independently guarded —
   * a grant is consumed once, a hold cannot be taken twice — so the state
   * machine remains the design, not the only defence.
   */
  function flushDeferredSync(): void {
    if (executing.size > 0 || deferredState === null || flushQueued) return;
    flushQueued = true;
    setTimeout(() => {
      flushQueued = false;
      if (executing.size > 0 || deferredState === null) return;
      const state = deferredState;
      deferredState = null;
      sync(state);
    }, 0);
  }

  /**
   * Every execution passes through here, whoever called it, so the undo stack
   * cannot miss an action — including one the agent took. The inverse is
   * captured before the call and committed only if the call succeeded: a
   * refusal changed nothing, and offering to undo it would make the button lie.
   */
  function withUndo<T extends ToolResult>(
    tool: AnyDefinedTool,
    run: () => Promise<T>,
  ): Promise<T> {
    const commit = captureInverse(tool.name, store);
    beginExecution(tool.name);
    return run()
      .then((result) => {
        if (commit && result.ok) commit();
        return result;
      })
      .finally(() => {
        endExecution(tool.name);
        flushDeferredSync();
      });
  }

  function register(tool: AnyDefinedTool): void {
    const controller = new AbortController();
    registered.set(tool.name, { tool, controller });
    if (!modelContext) return;
    const mcTool = tool.toModelContextTool((called, input, result) => {
      recordAudit(called, takeNextActor(called.name), input, result);
    });
    // The browser calls the tool's closure directly, so the undo capture has to
    // wrap that closure rather than sit in registry.execute — otherwise an
    // agent's action, or a palette call routed through executeTool, would be
    // invisible to undo.
    const inner = mcTool.execute;
    mcTool.execute = (input, options) => withUndo(tool, async () => {
      const result = await inner(input, options);
      return result as ToolResult;
    });
    void modelContext.registerTool(mcTool, { signal: controller.signal }).catch((error: unknown) => {
      // A failed registration must never be mistaken for a live tool.
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

    // See flushDeferredSync: cutting a tool mid-execute makes the browser
    // reject a call that actually succeeded (#300).
    if (wouldCutRunningTool(live)) {
      deferredState = state;
      return;
    }

    if (import.meta.env.DEV && live.length > MAX_LIVE_TOOLS) {
      throw new Error(
        `[registry] ${live.length} tools live in stage "${state.stage}" (max ${MAX_LIVE_TOOLS}): ${live
          .map((t) => t.name)
          .join(", ")}`,
      );
    }

    const liveNames = new Set(live.map((tool) => tool.name));

    // Capture what left, and why, *before* unregistering — the reason is a
    // function of the new state, which is exactly the context #262 says
    // unregistration throws away. Phase 5 announces this to the human; the
    // agent reads the same reasons from get_booking_state.unavailable[].
    const removed = [...registered.keys()]
      .filter((name) => !liveNames.has(name))
      .map((name) => {
        const tool = registered.get(name)!.tool;
        return { tool: name, ...tool.unavailableReason(state) };
      });
    const added = live.filter((tool) => !registered.has(tool.name)).map((tool) => tool.name);

    for (const entry of removed) unregister(entry.tool);
    for (const tool of live) {
      if (!registered.has(tool.name)) register(tool);
    }

    // Publish the live set so get_booking_state can report it. Guarded, or this
    // write would re-enter sync() forever.
    const sorted = [...liveNames].sort();
    const current = state.liveTools;
    const changed = sorted.length !== current.length || sorted.some((n, i) => n !== current[i]);
    if (changed) {
      const next = store.getState();
      next.setLiveTools(sorted);
      if (added.length > 0 || removed.length > 0) {
        next.setLastToolChange({ at: Date.now(), added, removed });
      }
    }
  }

  // Initial sync first, subscribe second: if the initial sync throws (a dev
  // budget violation) no subscription is left behind to throw again.
  sync(store.getState());
  const unsubscribe = store.subscribe(sync);

  const registry: Registry = {
    getLiveTools: () => [...registered.values()].map((entry) => entry.tool),
    hasModelContext: modelContext !== undefined,
    getTool: (name) => tools.find((t) => t.name === name),
    execute: async (name, input) => {
      const entry = registered.get(name);
      const actor = takeNextActor(name);
      if (!entry) {
        const tool = tools.find((t) => t.name === name);
        const reason = tool?.unavailableReason(store.getState());
        const result: ToolResult = {
          ok: false,
          kind: "unavailable",
          reason: reason?.reason ?? `There is no tool called "${name}".`,
          ...(reason ? { next: reason.unlock_by } : {}),
        };
        if (tool) recordAudit(tool, actor, input, result);
        return result;
      }
      const result = await withUndo(entry.tool, () => entry.tool.run(input));
      recordAudit(entry.tool, actor, input, result);
      return result;
    },
    stop: () => {
      unsubscribe();
      for (const name of [...registered.keys()]) unregister(name);
      if (active === registry) active = null;
    },
  };

  active = registry;
  return registry;
}
