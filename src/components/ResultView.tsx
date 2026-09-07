import { isRefusal, type ToolResult } from "../lib/result";

/**
 * Renders whatever a tool returned.
 *
 * `human_summary` is a headline, not the answer. Five tools —
 * `list_accommodations`, `check_coverage`, `explain_capability`,
 * `explain_no_results` and `export_summary` — have no surface anywhere else on
 * the page, so showing only their summary threw the result away: "Summary for
 * booking bkg_1." is useless when the point is the text a caregiver reads.
 *
 * It works from the data's shape alone, never from a per-tool template. The
 * palette renders tools it has never seen (a tool `getTools()` offers that the
 * local map does not know), and its result view has to hold up for those too.
 */

const MAX_DEPTH = 4;

/**
 * Keys whose value is prose someone else wrote. Tools name them with this
 * prefix so provenance travels with the value rather than living in a lookup
 * table here — a tool the palette has never seen still gets the fence.
 */
const UNTRUSTED_KEY = /^(unverified|untrusted)_/;

/** `interpreter_lead_days` → `Interpreter lead days` */
function humanise(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function Scalar({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-ink-soft">—</span>;
  }
  if (typeof value === "boolean") return <span>{value ? "yes" : "no"}</span>;
  if (typeof value === "string") {
    // Pre-formatted text — export_summary returns a whole printable block —
    // has to keep its line breaks or it collapses into a paragraph.
    if (value.includes("\n")) {
      return (
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap border-[1.5px] border-ink bg-stock p-2 font-display text-xs leading-relaxed">
          {value}
        </pre>
      );
    }
    return <span>{value}</span>;
  }
  return <span className="font-display text-xs">{String(value)}</span>;
}

function Node({ value, depth }: { value: unknown; depth: number }) {
  if (depth > MAX_DEPTH) return <Scalar value={JSON.stringify(value)} />;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-soft">none</span>;

    // A list of scalars reads better inline than as a stack of bullets.
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) {
      return (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((item, i) => (
            <li key={i} className="border border-ink bg-stock px-1.5 py-0.5 text-xs">
              <Scalar value={item} />
            </li>
          ))}
        </ul>
      );
    }

    return (
      <ol className="mt-1 flex flex-col gap-2">
        {value.map((item, i) => (
          <li key={i} className="border-l-[3px] border-spot pl-2">
            <Node value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <span className="text-ink-soft">none</span>;

    // Prose the site does not vouch for gets fenced and hoisted above the
    // verified fields. Left in reading order it lands last, after however many
    // chips the record happens to have, so the reader meets unattributed text
    // as though the site had asserted it. The fence is the attribution.
    const untrusted = entries.filter(([key]) => UNTRUSTED_KEY.test(key));
    const trusted = entries.filter(([key]) => !UNTRUSTED_KEY.test(key));

    return (
      <>
        {untrusted.map(([key, child]) => (
          <section
            key={key}
            aria-label={humanise(key)}
            className="mb-2 border-[1.5px] border-spot-deep bg-stock p-2"
          >
            <p className="font-display text-[0.65rem] font-bold uppercase tracking-[0.14em] text-spot-deep">
              <span aria-hidden="true">⚠ </span>
              {humanise(key)} — not verified by this site
            </p>
            <div className="mt-1">
              <Node value={child} depth={depth + 1} />
            </div>
          </section>
        ))}
        {trusted.length > 0 && (
          <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1">
            {trusted.map(([key, child]) => (
              <div key={key} className="contents">
                <dt className="font-display text-[0.7rem] font-bold uppercase tracking-wide text-ink-soft">
                  {humanise(key)}
                </dt>
                <dd className="min-w-0 wrap-break-word">
                  <Node value={child} depth={depth + 1} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </>
    );
  }

  return <Scalar value={value} />;
}

export function ResultView({ result }: { result: ToolResult }) {
  if (isRefusal(result)) {
    return (
      <>
        <p className="font-semibold text-spot-deep">
          <span aria-hidden="true">✕ </span>
          {result.kind.replace(/_/g, " ")}
        </p>
        <p className="text-ink">{result.reason}</p>
        {result.field && (
          <p className="mt-1 text-ink-soft">
            Field: <span className="font-display text-xs">{result.field}</span>
          </p>
        )}
        {result.next && <p className="mt-1 text-ink">Next: run “{result.next}”.</p>}
      </>
    );
  }

  const hasData =
    result.data !== null &&
    result.data !== undefined &&
    !(isPlainObject(result.data) && Object.keys(result.data).length === 0);

  return (
    <>
      <p className="font-semibold text-ink">
        <span aria-hidden="true">✓ </span>
        {result.human_summary}
      </p>
      {hasData && (
        <div className="mt-2 border-t border-ink pt-2 text-[0.8rem] leading-relaxed text-ink">
          <Node value={result.data} depth={0} />
        </div>
      )}
    </>
  );
}
