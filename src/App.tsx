import { useEffect, useState } from "react";
import { listRegisteredTools, runSpike, type SpikeStatus } from "./lib/spike";

export default function App() {
  const [status, setStatus] = useState<SpikeStatus | null>(null);
  const [tools, setTools] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    void (async () => {
      const result = await runSpike(controller.signal);
      if (cancelled) return;
      setStatus(result);
      setTools(await listRegisteredTools());
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const detected = status?.kind === "registered";

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 p-8">
      <header>
        <p className="text-sm font-semibold uppercase tracking-widest text-slate-500">
          Parity · Phase 1 spike
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">
          WebMCP registration check
        </h1>
      </header>

      <p
        className={`text-5xl font-black leading-tight sm:text-6xl ${
          status === null
            ? "text-slate-400"
            : detected
              ? "text-emerald-700"
              : "text-red-700"
        }`}
        // The spike's only real output. Polite so it does not interrupt, but it
        // must be announced — a sighted check of colour is not the only path.
        aria-live="polite"
      >
        {status === null
          ? "Checking…"
          : detected
            ? "document.modelContext DETECTED"
            : "document.modelContext NOT DETECTED"}
      </p>

      {status !== null && status.kind !== "registered" && (
        <p className="max-w-prose text-lg text-slate-700">{status.detail}</p>
      )}

      {status?.kind === "registered" && (
        <div className="space-y-2 text-lg text-slate-700">
          <p>
            Registered <code className="font-mono">{status.toolName}</code>.
            Open <strong>Site tools</strong> in the address bar and invoke it.
          </p>
          <p>
            <span className="font-semibold">getTools() returns:</span>{" "}
            <code className="font-mono">
              {tools.length > 0 ? tools.join(", ") : "(empty)"}
            </code>
          </p>
        </div>
      )}

      <p className="text-sm text-slate-500">
        Page title is <code className="font-mono">{document.title}</code> — the
        value <code className="font-mono">get_page_title</code> returns.
      </p>
    </main>
  );
}
