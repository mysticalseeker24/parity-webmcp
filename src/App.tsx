import { useEffect, useRef, useState } from "react";
import { AuditTrail } from "./components/AuditTrail";
import { BookingSummary } from "./components/BookingSummary";
import { Calendar } from "./components/Calendar";
import { CommandPalette } from "./components/CommandPalette";
import { GrantCard } from "./components/GrantCard";
import { HowItWorks } from "./components/HowItWorks";
import { IntakeForm } from "./components/IntakeForm";
import { AnnouncementLog, LiveRegion } from "./components/LiveRegion";
import { LoadingScreen } from "./components/LoadingScreen";
import { LockstepPanel } from "./components/LockstepPanel";
import { ProviderList } from "./components/ProviderList";
import { RisoMotif } from "./components/RisoMotif";
import { SearchForm } from "./components/SearchForm";
import { VoiceInput } from "./components/VoiceInput";
import { focusStage } from "./lib/stageFocus";
import { performUndo } from "./lib/undo";
import { useBookingStore } from "./store";

/**
 * One page, no routing. Tools belong to the page: a route change would
 * unregister every tool mid-flow (TOOLS.md §1), so the whole booking happens
 * in a single document.
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
  step,
  title,
  children,
}: {
  id: string;
  step?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="riso-panel p-5 sm:p-6">
      <h2
        id={`${id}-heading`}
        tabIndex={-1}
        className="mb-4 flex items-baseline gap-3 font-display text-lg font-bold uppercase tracking-wider text-ink"
      >
        {step && (
          // Peach on ink is ~4.8:1, which passes for bold text this size. Peach
          // on stock would not, which is why it never carries body copy.
          <span
            aria-hidden="true"
            className="inline-flex size-7 shrink-0 items-center justify-center border-[1.5px] border-ink bg-spot text-sm text-ink"
          >
            {step}
          </span>
        )}
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function App() {
  const detected = useWebMcpDetected();
  const liveTools = useBookingStore((s) => s.liveTools);
  const stage = useBookingStore((s) => s.stage);
  const previousStage = useRef(stage);

  // Focus follows the work on a genuine stage change — never on an ordinary
  // re-render, which would yank focus away mid-typing.
  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    focusStage(stage);
  }, [stage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        // Never hijack undo inside a text field — the browser's own undo is
        // what a user typing into an input expects.
        const target = event.target as HTMLElement | null;
        if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
        event.preventDefault();
        performUndo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="paper-grain relative min-h-dvh bg-stock text-ink">
      <LoadingScreen />

      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-ink focus:px-4 focus:py-2 focus:font-semibold focus:text-stock"
      >
        Skip to main content
      </a>

      <LiveRegion />

      {/* Top level: an approval request can arrive while the user is anywhere
          on the page, including from an agent call they did not initiate. */}
      <GrantCard />

      <div className="relative z-10">
        <header className="border-b-[1.5px] border-ink">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-4">
            <p className="font-display text-xl font-bold uppercase tracking-[0.2em] text-ink">
              Parity
            </p>

            <div className="flex flex-wrap items-center gap-3">
              {/* The first thing a developer landing here wants. */}
              <a
                href="https://github.com/mysticalseeker24/parity-webmcp"
                className="inline-flex items-center gap-2 border-[1.5px] border-ink px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wider text-ink hover:bg-spot"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-current">
                  <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                </svg>
                GitHub
              </a>
              <VoiceInput />
              <CommandPalette />
              {/* States the mode in words and with a mark — never colour alone. */}
              <p
                data-testid="detection"
                className={`border-[1.5px] px-3 py-1 font-display text-xs font-bold uppercase tracking-wider ${
                  detected === null
                    ? "border-ink-soft text-ink-soft"
                    : detected
                      ? "border-ink bg-ink text-stock"
                      : "border-spot-deep text-ink"
                }`}
              >
                <span aria-hidden="true">{detected === null ? "··" : detected ? "✓" : "!"} </span>
                WebMCP: {detected === null ? "checking" : detected ? "detected" : "not detected"}
              </p>
            </div>
          </div>
        </header>

        {/* A band of the second ink, as a press would lay it down. */}
        <div aria-hidden="true" className="h-1.5 bg-spot" />

        {/* ── Hero ── */}
        <div className="border-b-[1.5px] border-ink">
          <div className="mx-auto grid max-w-5xl items-center gap-8 px-6 py-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="riso-pull">
              <p className="mb-4 inline-block border-[1.5px] border-ink bg-spot px-2 py-0.5 font-display text-[0.7rem] font-bold uppercase tracking-[0.2em] text-ink">
                Specialist care booking
              </p>
              <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
                Booking care,
                <br />
                <span className="riso-offset">built once</span>
                <br />
                for both.
              </h1>
              <p className="mt-6 max-w-md text-lg leading-relaxed text-ink">
                The visual interface, a keyboard command palette, and your AI agent are all callers
                of the same WebMCP tool registry.
              </p>
              <p className="mt-3 max-w-md border-l-[3px] border-spot pl-3 text-ink-soft">
                Building your website for agents is how you finally make it usable by the humans your
                interface locked out. It is the same work, not two projects.
              </p>
            </div>
            <RisoMotif className="w-full" />
          </div>
        </div>

        <HowItWorks />

        <main id="main" tabIndex={-1} className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
          {detected === false && (
            <p className="riso-panel-inset p-4 text-ink">
              <strong>No WebMCP in this browser</strong>, so no agent can drive the page. Everything
              below still works: the visual controls and the command palette run the same tools.
            </p>
          )}

          <Section id="summary" title="Your booking">
            <BookingSummary />
          </Section>

          <Section id="search" step="1" title="Find a provider">
            <SearchForm />
          </Section>

          <Section id="results" step="2" title="Choose a provider">
            <ProviderList />
          </Section>

          <Section id="calendar" step="3" title="Pick a time">
            <Calendar />
          </Section>

          <Section id="intake" step="4" title="Patient details">
            <IntakeForm />
          </Section>

          <Section id="activity" title="What just happened">
            <AnnouncementLog />
          </Section>

          <Section id="audit" title="Activity trail">
            <AuditTrail />
          </Section>

          <Section id="tools" title="Live tools">
            <p className="text-ink">
              {liveTools.length > 0 ? (
                <>
                  These {liveTools.length} tools are registered right now:{" "}
                  <code className="font-display text-sm" data-testid="registry-listing">
                    {liveTools.join(", ")}
                  </code>
                </>
              ) : (
                "No tools registered."
              )}
            </p>
            <p className="mt-2 mb-4 text-sm text-ink-soft">
              The set changes with the stage: an action that is not legal right now is not
              registered, so it cannot be called by anyone.
            </p>
            <LockstepPanel />
          </Section>
        </main>

        <footer className="border-t-[1.5px] border-ink px-6 py-6">
          <p className="mx-auto max-w-5xl text-sm text-ink-soft">
            Synthetic data. No booking is real, and nothing is stored — state resets on reload.
          </p>
        </footer>
      </div>
    </div>
  );
}
