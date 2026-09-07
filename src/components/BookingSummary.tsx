import { useEffect, useState } from "react";
import { findProvider } from "../data/providers";
import { findSlot, slotLabel } from "../data/slots";
import { executeAsHuman } from "../lib/registry";
import { isRefusal } from "../lib/result";
import { useBookingStore } from "../store";
import { AccommodationTags } from "./AccommodationTag";

const STAGE_LABELS: Record<string, string> = {
  browsing: "Browsing",
  provider_selected: "Provider selected",
  slot_held: "Slot held",
  intake_complete: "Ready to confirm",
  booked: "Booked",
};

/** Live countdown on the hold, in whole seconds. */
function useCountdown(expiresAt: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (expiresAt === null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}

function mmss(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function BookingSummary() {
  const stage = useBookingStore((s) => s.stage);
  const providerId = useBookingStore((s) => s.selectedProviderId);
  const heldSlot = useBookingStore((s) => s.heldSlot);
  const booking = useBookingStore((s) => s.booking);
  const intake = useBookingStore((s) => s.intake);
  const holdExpired = useBookingStore((s) => s.holdExpired);
  const remaining = useCountdown(heldSlot?.expiresAt ?? null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const provider = providerId ? findProvider(providerId) : undefined;
  const slot = heldSlot ? findSlot(heldSlot.slotId) : undefined;
  const bookedSlot = booking ? findSlot(booking.slotId) : undefined;

  async function confirm() {
    if (!heldSlot) return;
    setBusy(true);
    try {
      const result = await executeAsHuman("confirm_booking", { slot_id: heldSlot.slotId });
      setConfirmMessage(isRefusal(result) ? result.reason : result.human_summary);
    } catch (error) {
      setConfirmMessage(
        error instanceof Error ? error.message : "The booking could not be confirmed.",
      );
    } finally {
      // Always re-enable; a thrown error must not leave a dead button.
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-ink">
      <p>
        <span className="font-semibold">Stage: </span>
        <span data-testid="stage">{STAGE_LABELS[stage] ?? stage}</span>
      </p>

      <p>
        <span className="font-semibold">Provider: </span>
        {provider ? `${provider.name} · ${provider.location.area}` : "none selected"}
      </p>

      <p>
        <span className="font-semibold">Slot: </span>
        {slot ? (
          <span data-testid="hold">
            {slotLabel(slot)}, {slot.duration_min} minutes
            {/* Expiry stated in words, never conveyed by a colour change. */}
            {remaining !== null && (
              <>
                {" — "}
                <span role="timer" aria-live="off">
                  held, expires in {mmss(remaining)}
                </span>
              </>
            )}
          </span>
        ) : holdExpired ? (
          "the previous hold expired"
        ) : (
          "none held"
        )}
      </p>

      {intake.accommodations && intake.accommodations.length > 0 && (
        <AccommodationTags ids={intake.accommodations} label="Accommodations requested" />
      )}

      {booking && bookedSlot && (
        <p className="rounded border-[1.5px] border-ink bg-stock-deep p-3">
          <span className="font-semibold">Confirmed: </span>
          {slotLabel(bookedSlot)} with {findProvider(booking.providerId)?.name}. Reference{" "}
          {booking.id}.
        </p>
      )}

      {stage === "intake_complete" && (
        <div>
          <button
            type="button"
            id="confirm-booking"
            onClick={() => void confirm()}
            disabled={busy}
            className="rounded bg-ink px-4 py-2 font-semibold text-stock hover:bg-ink-soft disabled:opacity-60"
          >
            Confirm booking
          </button>
          <p className="mt-1 text-sm text-ink-soft">
            Confirming needs your approval on this page; the agent cannot give it.
          </p>
        </div>
      )}

      {confirmMessage && (
        <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
          {confirmMessage}
        </p>
      )}
    </div>
  );
}
