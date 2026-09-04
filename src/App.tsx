import { useEffect, useState } from "react";
import { useBookingStore } from "./store";

/**
 * Phase 2 placeholder. Shows WebMCP detection, the current stage, and the live
 * tool list read back through `getTools()` when the browser provides it — the
 * same view the agent has — falling back to the store's copy when it does not.
 * The real UI arrives in Phase 4; this keeps the deployed URL meaningful.
 */

function useModelContextTools(): { detected: boolean | null; tools: string[] } {
  const [detected, setDetected] = useState<boolean | null>(null);
  const [tools, setTools] = useState<string[]>([]);

  useEffect(() => {
    const mc = document.modelContext;
    if (typeof mc?.getTools !== "function") {
      setDetected(false);
      return;
    }
    setDetected(true);
    let cancelled = false;
    const refresh = () => {
      void mc.getTools().then((list) => {
        if (!cancelled) setTools(list.map((t) => t.name));
      });
    };
    refresh();
    mc.addEventListener("toolchange", refresh);
    return () => {
      cancelled = true;
      mc.removeEventListener("toolchange", refresh);
    };
  }, []);

  return { detected, tools };
}

export default function App() {
  const { detected, tools } = useModelContextTools();
  const stage = useBookingStore((s) => s.stage);
  const localTools = useBookingStore((s) => s.liveTools);
  const audit = useBookingStore((s) => s.audit);
  const live = detected ? tools : localTools;
  const last = audit[audit.length - 1];

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 p-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">Parity</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">Specialist care booking</h1>
      </header>

      <p
        className={`text-4xl font-black leading-tight sm:text-5xl ${
          detected === null ? "text-slate-400" : detected ? "text-emerald-700" : "text-red-700"
        }`}
        data-testid="detection"
      >
        {detected === null
          ? "Checking…"
          : detected
            ? "document.modelContext DETECTED"
            : "document.modelContext NOT DETECTED"}
      </p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-lg text-slate-700">
        <dt className="font-semibold">Stage</dt>
        <dd>
          <code className="font-mono" data-testid="stage">
            {stage}
          </code>
        </dd>
        <dt className="font-semibold">{detected ? "getTools()" : "Live tools (local)"}</dt>
        <dd>
          <code className="font-mono" data-testid="registry-listing">
            {live.length > 0 ? live.join(", ") : "(empty)"}
          </code>
        </dd>
      </dl>

      {detected === false && (
        <p className="max-w-prose text-slate-600">
          Open this page in the ChatGPT desktop app's built-in browser (model GPT-5.6 Sol or Terra),
          or Chrome 149+ with <code className="font-mono">chrome://flags/#enable-webmcp-testing</code>{" "}
          enabled. The tools above are still callable from the command palette.
        </p>
      )}

      {/* The real announcer lands in Phase 7; this proves the audit trail fills. */}
      <p role="status" aria-live="polite" className="text-sm text-slate-500" data-testid="announcer">
        {last ? `${last.actor} · ${last.tool}` : ""}
      </p>
    </main>
  );
}
