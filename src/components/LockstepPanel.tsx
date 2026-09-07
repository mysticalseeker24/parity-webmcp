import { useCallback, useEffect, useState } from "react";
import { getRegistry } from "../lib/registry";
import { useBookingStore } from "../store";

/**
 * The browser's tool list beside the palette's, side by side.
 *
 * They are the same list because they come from the same call. Showing them
 * together is the clearest way to make the thesis visible: when a transition
 * registers `confirm_booking`, the agent's `toolchange` event and the human's
 * palette row arrive from one diff. That lockstep is the beat the demo video is
 * built around, so it needs to be on screen rather than described.
 */
export function LockstepPanel() {
  const [browserTools, setBrowserTools] = useState<string[] | null>(null);
  const localTools = useBookingStore((s) => s.liveTools);
  const lastChange = useBookingStore((s) => s.lastToolChange);

  const refresh = useCallback(async () => {
    const mc = document.modelContext;
    if (typeof mc?.getTools !== "function") {
      setBrowserTools(null);
      return;
    }
    const tools = await mc.getTools();
    setBrowserTools(tools.map((t) => t.name).sort());
  }, []);

  useEffect(() => {
    void refresh();
    const mc = document.modelContext;
    mc?.addEventListener("toolchange", refresh);
    return () => mc?.removeEventListener("toolchange", refresh);
  }, [refresh]);

  // Re-read whenever the store moves, so the panel keeps up without WebMCP too.
  useEffect(() => {
    void refresh();
  }, [localTools, refresh]);

  const registryTools = [...(getRegistry()?.getLiveTools() ?? [])].map((t) => t.name).sort();
  const agreed =
    browserTools === null ||
    (browserTools.length === registryTools.length &&
      browserTools.every((n, i) => n === registryTools[i]));

  return (
    <details className="rounded border border-slate-300 bg-white p-3">
      <summary className="cursor-pointer font-semibold text-slate-900">
        One registry, two callers — live view
      </summary>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Agent&rsquo;s view · <code className="font-mono text-xs">getTools()</code>
          </h3>
          <ul className="mt-1 text-sm text-slate-800" data-testid="lockstep-browser">
            {browserTools === null ? (
              <li className="text-slate-600">No WebMCP in this browser.</li>
            ) : (
              browserTools.map((name) => (
                <li key={name}>
                  <code className="font-mono text-xs">{name}</code>
                </li>
              ))
            )}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-900">Palette&rsquo;s view · same call</h3>
          <ul className="mt-1 text-sm text-slate-800" data-testid="lockstep-local">
            {registryTools.map((name) => (
              <li key={name}>
                <code className="font-mono text-xs">{name}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="mt-3 text-sm font-semibold text-slate-900">
        <span aria-hidden="true">{agreed ? "✓ " : "! "}</span>
        {agreed ? "Both surfaces see the same tools." : "The two views disagree — that is a bug."}
      </p>

      {lastChange && (
        <div className="mt-2 text-sm text-slate-800">
          <p className="font-semibold">Last change</p>
          {lastChange.added.length > 0 && <p>Added: {lastChange.added.join(", ")}</p>}
          {lastChange.removed.length > 0 && (
            <ul>
              {lastChange.removed.map((r) => (
                <li key={r.tool}>
                  Removed {r.tool} — {r.reason_code}: {r.reason} (unlock with {r.unlock_by || "n/a"})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </details>
  );
}
