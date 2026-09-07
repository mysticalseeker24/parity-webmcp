import { useSyncExternalStore } from "react";
import { getRegistry } from "../lib/registry";
import { isToolResult } from "../lib/result";
import { peekUndo, performUndo, subscribeToUndo } from "../lib/undo";
import { useBookingStore, type AuditEntry } from "../store";
import { allGrants } from "../lib/grants";

/**
 * The audit trail, on the page.
 *
 * Everyone can see who did what: which actor, which tool, what came back, and
 * — for approvals — how long the human took. That last one is the #288
 * disclosure: a page cannot stop a computer-use host clicking its own Approve
 * button, but it can make the timing visible to the person it affects.
 */

const ACTOR_LABELS: Record<AuditEntry["actor"], string> = {
  agent: "Agent",
  human: "You",
  system: "System",
};

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function summarise(entry: AuditEntry): string {
  if (!isToolResult(entry.result)) {
    const code = (entry.result as { reason_code?: string }).reason_code;
    return code ? code.replace(/_/g, " ") : "state changed";
  }
  return entry.result.ok ? entry.result.human_summary : `${entry.result.kind}: ${entry.result.reason}`;
}

function useUndoTop() {
  return useSyncExternalStore(subscribeToUndo, peekUndo, () => undefined);
}

export function AuditTrail() {
  const audit = useBookingStore((s) => s.audit);
  const undoTop = useUndoTop();
  const entries = [...audit].reverse();

  // Approvals are recorded on the grant, not the audit, so they are joined in
  // here rather than duplicated into the store.
  const approvals = allGrants().filter((g) => g.evidence);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => performUndo()}
          disabled={!undoTop}
          className="rounded border-[1.5px] border-ink px-3 py-1.5 font-semibold text-ink hover:bg-stock-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {undoTop ? undoTop.label : "Nothing to undo"}
          <kbd className="ml-2 font-mono text-xs">Ctrl Z</kbd>
        </button>
        <p className="text-sm text-ink">
          Confirming a booking cannot be undone here — it commits a real appointment, so reversing
          it is its own approved action rather than a shortcut around the approval.
        </p>
      </div>

      {approvals.length > 0 && (
        <ul aria-label="Approvals" className="flex flex-col gap-1 text-sm">
          {approvals.map((grant) => (
            <li
              key={grant.id}
              className={`rounded border-[1.5px] p-2 ${
                grant.evidence?.flag
                  ? "border-spot-deep bg-stock-deep text-ink"
                  : "border-ink bg-stock text-ink"
              }`}
            >
              <span className="font-semibold">{grant.tool}</span> approved{" "}
              {grant.evidence!.delta_ms} ms after request
              {grant.evidence!.flag === "possibly_automated" && (
                <>
                  {" — "}
                  <strong>possibly automated</strong>
                </>
              )}
              {". "}
              <span className="text-xs">
                via {grant.evidence!.channel.replace(/_/g, " ")}, {grant.evidence!.modality}
                {grant.evidence!.isTrusted ? ", trusted event" : ", untrusted event"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {entries.length === 0 ? (
        <p className="text-sm text-ink-soft">No tool has run yet.</p>
      ) : (
        <ol aria-label="Activity, newest first" className="flex flex-col gap-1" data-testid="audit-trail">
          {entries.map((entry) => {
            const label = getRegistry()?.getTool(entry.tool)?.spec.humanLabel ?? entry.tool;
            return (
              <li
                key={entry.id}
                className="rounded border-[1.5px] border-ink bg-stock p-2 text-sm text-ink"
              >
                <span className="font-semibold">{ACTOR_LABELS[entry.actor]}</span>
                {" · "}
                <span>{label}</span>
                {" · "}
                <span>{summarise(entry)}</span>
                {" · "}
                <time dateTime={new Date(entry.at).toISOString()} className="text-ink-soft">
                  {clockTime(entry.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
