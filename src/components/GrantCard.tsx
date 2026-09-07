import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  approve,
  deny,
  DWELL_MS,
  pendingGrantFor,
  subscribeToGrants,
  type Grant,
} from "../lib/grants";
import { executeAsHuman } from "../lib/registry";
import { isRefusal } from "../lib/result";

/**
 * The approval card. The only place a grant becomes approved.
 *
 * Deliberate choices, each traceable to SPEC_ISSUES.md #288:
 *
 *  - **Every argument value is shown in full.** The human approves what is
 *    actually about to happen, not a summary of it.
 *  - **Approve is disabled for 1.5 s**, as a `disabled` attribute plus a
 *    countdown — never a `sleep`, which would block the thread and freeze the
 *    rest of the page for everyone.
 *  - **`isTrusted === false` is rejected.** Catches JS-synthesised clicks; does
 *    not catch CDP-injected input. That gap is the whole of #288 and we say so
 *    rather than pretending otherwise.
 *  - **No CAPTCHA, puzzle, or timing challenge.** Every trick that would defeat
 *    #288 would exclude the users this product exists for. The durable fix
 *    belongs in the user agent (#165, #277); a page can only make the behaviour
 *    visible, which is what the recorded evidence does.
 *
 * Focus moves to the card when it appears and returns to wherever it was when
 * it closes, so a keyboard user is neither stranded nor hijacked.
 */

function useGrant(tool: string): Grant | undefined {
  return useSyncExternalStore(
    subscribeToGrants,
    () => pendingGrantFor(tool),
    () => undefined,
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function GrantCard({ tool = "confirm_booking" }: { tool?: string }) {
  const grant = useGrant(tool);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  // One ticker drives both the dwell countdown and the expiry countdown.
  useEffect(() => {
    if (!grant) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [grant]);

  useEffect(() => {
    if (!grant) return;
    returnFocusTo.current = document.activeElement as HTMLElement;
    setNow(Date.now());
    setError(null);
    cardRef.current?.focus();
    return () => {
      // Never drop focus to <body> when the card goes away.
      returnFocusTo.current?.focus();
    };
  }, [grant?.id, grant]);

  if (!grant) return null;

  const sinceRequest = now - grant.requested_at;
  const dwellLeft = Math.max(0, DWELL_MS - sinceRequest);
  const secondsLeft = Math.max(0, Math.ceil((grant.expiresAt - now) / 1000));
  const dwellOver = dwellLeft === 0;

  function handleApprove(event: React.MouseEvent | React.KeyboardEvent) {
    const native = event.nativeEvent;
    // A synthesised event is not a decision.
    if (!native.isTrusted) {
      setError("That approval was not a real user action, so it was not accepted.");
      return;
    }

    const isKeyboard = event.type === "keyup" || event.type === "keydown";
    const pointerType = (native as PointerEvent).pointerType;
    const outcome = approve(grant!.id, {
      isTrusted: native.isTrusted,
      modality: isKeyboard ? "keyboard" : "pointer",
      // A click from Enter on a button reports pointerType "", not a device.
      ...(pointerType ? { pointerType } : {}),
      ...(isKeyboard ? { key: (native as KeyboardEvent).key } : {}),
      channel: "page_card",
    });

    if (!outcome.ok) {
      setError(outcome.reason);
      return;
    }
    // Re-run the tool. It re-validates from grant state; this call does not
    // carry the decision, it merely retries.
    void executeAsHuman("confirm_booking", { slot_id: grant!.args["slot_id"] }).then((result) => {
      if (isRefusal(result)) setError(result.reason);
    });
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="grant-title"
      aria-describedby="grant-body"
      ref={cardRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-20"
    >
      <div className="w-full max-w-lg rounded-lg border-2 border-slate-900 bg-white p-5 shadow-xl">
        <h2 id="grant-title" className="text-xl font-bold text-slate-900">
          Approval required
        </h2>

        <p id="grant-body" className="mt-2 text-slate-800">
          An action wants to run <strong>Confirm booking</strong>. This commits a real appointment.
          Only you can approve it.
        </p>

        {/* Every argument, in full. Approving a summary is not consent. */}
        <dl className="mt-3 rounded border border-slate-300 bg-slate-50 p-3 text-sm">
          <div className="flex gap-2">
            <dt className="font-semibold text-slate-900">Tool</dt>
            <dd>
              <code className="font-mono">{grant.tool}</code>
            </dd>
          </div>
          {Object.entries(grant.args).map(([key, value]) => (
            <div key={key} className="mt-1 flex gap-2">
              <dt className="font-semibold text-slate-900">{key}</dt>
              <dd>
                <code className="font-mono break-all">{formatValue(value)}</code>
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-sm text-slate-800" data-testid="grant-countdown">
          {dwellOver ? (
            <>This request expires in {secondsLeft} seconds.</>
          ) : (
            <>Approve available in {(dwellLeft / 1000).toFixed(1)} seconds.</>
          )}
        </p>

        {/* Assertive: an approval request must interrupt, not queue. */}
        <p role="alert" aria-live="assertive" className="sr-only">
          Approval required to confirm the booking.{" "}
          {dwellOver ? "Approve is now available." : "Approve available in 1.5 seconds."}
        </p>

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800">
            <span aria-hidden="true">✕ </span>
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!dwellOver}
            onClick={handleApprove}
            data-testid="grant-approve"
            className="rounded bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Approve{!dwellOver && ` (${(dwellLeft / 1000).toFixed(1)}s)`}
          </button>

          <button
            type="button"
            onClick={() => deny(grant.id)}
            data-testid="grant-deny"
            className="rounded border border-slate-500 px-4 py-2 font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            Deny
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-600">
          The time you take to approve is recorded, so an approval that was not really yours is at
          least visible afterwards. A page cannot tell an automated click from yours — see the
          audit trail.
        </p>
      </div>
    </div>
  );
}
