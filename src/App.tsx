import { useEffect, useState } from "react";
import { BookingSummary } from "./components/BookingSummary";
import { Calendar } from "./components/Calendar";
import { IntakeForm } from "./components/IntakeForm";
import { LiveRegion } from "./components/LiveRegion";
import { ProviderList } from "./components/ProviderList";
import { SearchForm } from "./components/SearchForm";
import { useBookingStore } from "./store";

/**
 * One page, no routing. Tools belong to the page: a route change would
 * unregister every tool mid-flow (TOOLS.md §1), so the whole booking happens
 * in a single document.
 *
 * Sections are `<section>` with headings in document order, and the tab order
 * follows the visual order because nothing here sets a positive `tabindex`.
 */

function useWebMcpDetected(): boolean | null {
  const [detected, setDetected] = useState<boolean | null>(null);
  useEffect(() => {
    setDetected(typeof document.modelContext?.registerTool === "function");
  }, []);
  return detected;
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-lg border border-slate-300 bg-slate-50 p-5">
      <h2
        id={`${id}-heading`}
        // Focusable so Escape from the calendar has somewhere to land.
        tabIndex={-1}
        className="mb-3 text-xl font-bold text-slate-900"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function App() {
  const detected = useWebMcpDetected();
  const liveTools = useBookingStore((s) => s.liveTools);

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      {/* First tab stop: skip straight past the header to the flow. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      <LiveRegion />

      <header className="border-b border-slate-300 px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Parity</h1>
            <p className="text-slate-700">Specialist care booking</p>
          </div>

          {/* Badge states the mode in words and with a symbol — never colour
              alone (CONVENTIONS.md §6). */}
          <p
            data-testid="detection"
            className={`rounded border px-3 py-1 text-sm font-semibold ${
              detected === null
                ? "border-slate-400 text-slate-700"
                : detected
                  ? "border-emerald-700 bg-emerald-50 text-emerald-900"
                  : "border-amber-700 bg-amber-50 text-amber-900"
            }`}
          >
            <span aria-hidden="true">{detected === null ? "…" : detected ? "✓" : "!"} </span>
            WebMCP: {detected === null ? "checking" : detected ? "detected" : "not detected"}
          </p>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
        {detected === false && (
          <p className="rounded border border-amber-700 bg-amber-50 p-3 text-amber-900">
            This browser has no WebMCP support, so no agent can drive the page. Everything below
            still works: the visual controls and the command palette run the same tools.
          </p>
        )}

        <Section id="summary" title="Your booking">
          <BookingSummary />
        </Section>

        <Section id="search" title="1. Find a provider">
          <SearchForm />
        </Section>

        <Section id="results" title="2. Choose a provider">
          <ProviderList />
        </Section>

        <Section id="calendar" title="3. Pick a time">
          <Calendar />
        </Section>

        <Section id="intake" title="4. Patient details">
          <IntakeForm />
        </Section>

        <Section id="tools" title="Live tools">
          <p className="text-slate-700">
            {liveTools.length > 0 ? (
              <>
                These {liveTools.length} tools are registered right now:{" "}
                <code className="font-mono" data-testid="registry-listing">
                  {liveTools.join(", ")}
                </code>
              </>
            ) : (
              "No tools registered."
            )}
          </p>
          <p className="mt-2 text-sm text-slate-600">
            The set changes with the stage: an action that is not legal right now is not registered,
            so it cannot be called by anyone.
          </p>
        </Section>
      </main>
    </div>
  );
}
