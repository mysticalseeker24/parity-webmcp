import { useEffect, useState } from "react";
import { TOOLS } from "../tools";
import { useBookingStore } from "../store";

/**
 * What this page does, shown as the code that does it.
 *
 * A visitor who has never seen WebMCP needs to know three things before the
 * booking flow means anything: there is no server, the page hands its
 * capabilities to the browser, and the same handful of tools drive every
 * surface. Saying that in prose is weaker than showing the eleven lines that
 * do it — especially for the audience most likely to read this.
 *
 * The counts are read from the live registry rather than typed into the copy,
 * so they cannot go stale the way a hardcoded "19 tools" would.
 */

const SPEC = `defineTool({
  name: "hold_slot",
  description: "Place a 10-minute hold on one appointment slot…",
  schema: z.object({
    slot_id: z.string().describe("Slot id from get_availability"),
  }),
  voiceAliases: ["hold it", "reserve that slot"],
  available: (state) => state.hasFetchedAvailability,
  announce: (input, result) => \`held \${result.human_summary}\`,
  execute: ({ slot_id }, { now }) => { /* … */ },
});`;

const REGISTER = `// src/lib/registry.ts — the only file that calls registerTool
const live = tools.filter((tool) => tool.available(state));

await document.modelContext.registerTool(spec, { signal });`;

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-2 font-display text-[0.7rem] font-bold uppercase tracking-[0.18em] text-ink-soft">
        {label}
      </figcaption>
      <pre className="overflow-x-auto border-[1.5px] border-ink bg-ink p-4 text-[0.78rem] leading-relaxed text-stock">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

export function HowItWorks() {
  const liveCount = useBookingStore((s) => s.liveTools.length);
  const [browserSees, setBrowserSees] = useState<number | null>(null);

  useEffect(() => {
    const mc = document.modelContext;
    if (typeof mc?.getTools !== "function") return;
    let cancelled = false;
    const read = () => {
      void mc.getTools().then((tools) => {
        if (!cancelled) setBrowserSees(tools.length);
      });
    };
    read();
    mc.addEventListener("toolchange", read);
    return () => {
      cancelled = true;
      mc.removeEventListener("toolchange", read);
    };
  }, []);

  return (
    <section
      aria-labelledby="how-heading"
      className="border-b-[1.5px] border-ink bg-stock-deep"
    >
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h2
          id="how-heading"
          className="font-display text-lg font-bold uppercase tracking-wider text-ink"
        >
          How this page talks to an agent
        </h2>

        <p className="mt-3 max-w-2xl text-ink">
          There is no server and no MCP endpoint. This page registers its capabilities directly
          with the browser, and the browser hands them to whatever agent you are using. The command
          palette on this page reads that <em>same</em> registry — one source, two callers.
        </p>

        <dl className="mt-6 flex flex-wrap gap-0 border-[1.5px] border-ink">
          <div className="flex-1 basis-40 border-r-[1.5px] border-ink px-4 py-3">
            <dt className="font-display text-[0.65rem] font-bold uppercase tracking-[0.16em] text-ink-soft">
              Tools defined
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold tabular-nums">{TOOLS.length}</dd>
          </div>
          <div className="flex-1 basis-40 border-r-[1.5px] border-ink px-4 py-3">
            <dt className="font-display text-[0.65rem] font-bold uppercase tracking-[0.16em] text-ink-soft">
              Registered right now
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold tabular-nums">{liveCount}</dd>
          </div>
          <div className="flex-1 basis-40 border-r-[1.5px] border-ink px-4 py-3">
            <dt className="font-display text-[0.65rem] font-bold uppercase tracking-[0.16em] text-ink-soft">
              The browser sees
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold tabular-nums">
              {browserSees ?? "—"}
            </dd>
          </div>
          <div className="flex-1 basis-40 px-4 py-3">
            <dt className="font-display text-[0.65rem] font-bold uppercase tracking-[0.16em] text-ink-soft">
              Backend services
            </dt>
            <dd className="mt-1 font-display text-2xl font-bold tabular-nums">0</dd>
          </div>
        </dl>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <Snippet label="One tool, six consumers" code={SPEC} />
          <Snippet label="Registration is a function of state" code={REGISTER} />
        </div>

        <p className="mt-5 max-w-2xl text-sm text-ink-soft">
          That single object produces the browser registration, this page&rsquo;s command-palette
          form, the voice grammar, runtime validation, the screen-reader announcement, and the
          audit entry. An action that is not legal right now is not registered at all — so nobody
          can call it, agent or human.{" "}
          <a
            href="https://github.com/mysticalseeker24/parity-webmcp/blob/main/src/lib/registry.ts"
            className="font-semibold text-spot-deep underline"
          >
            Read registry.ts
          </a>
          .
        </p>
      </div>
    </section>
  );
}
