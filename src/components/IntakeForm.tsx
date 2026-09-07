import { useEffect, useState } from "react";
import {
  ACCOMMODATION,
  ACCOMMODATION_ICONS,
  ACCOMMODATION_LABELS,
  type Accommodation,
} from "../data/accommodations";
import { executeAsHuman } from "../lib/registry";
import { isRefusal } from "../lib/result";
import { useBookingStore } from "../store";

const FIELD_LABELS: Record<string, string> = {
  patient_name: "Patient name",
  dob: "Date of birth",
  reason: "Reason for visit",
};

/**
 * Intake, submitted through the same `set_intake` tool the agent calls.
 *
 * Two deliberate choices:
 *  - Date of birth is a plain text input with a stated ISO example, not a
 *    native date picker. Date pickers are the control this whole product is
 *    an argument about; a text field with a format hint is operable by anyone,
 *    and the tool validates it and returns a correction naming the field.
 *  - The accommodation checkboxes are generated from the `z.enum`, so the form
 *    and the tool schema cannot drift apart (spec issue #286: one source, so
 *    the accessible name and the parameter description always agree).
 */
export function IntakeForm() {
  const intake = useBookingStore((s) => s.intake);
  const stage = useBookingStore((s) => s.stage);

  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [reason, setReason] = useState("");
  const [accommodations, setAccommodations] = useState<Accommodation[]>([]);
  const [error, setError] = useState<{ field?: string; reason: string } | null>(null);
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);

  // Seed from the store so an agent-filled field shows up in the form.
  useEffect(() => {
    setName(intake.patient_name ?? "");
    setDob(intake.dob ?? "");
    setReason(intake.reason ?? "");
    setAccommodations([...(intake.accommodations ?? [])]);
  }, [intake]);

  const missing = (["patient_name", "dob", "reason"] as const).filter((field) => {
    const value = intake[field];
    return typeof value !== "string" || value.trim() === "";
  });

  if (stage !== "slot_held" && stage !== "intake_complete") {
    return <p className="text-ink-soft">Hold a slot to fill in patient details.</p>;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved("");
    try {
      const result = await executeAsHuman("set_intake", {
        patient_name: name.trim() === "" ? undefined : name,
        dob: dob.trim() === "" ? undefined : dob,
        reason: reason.trim() === "" ? undefined : reason,
        accommodations,
      });
      if (isRefusal(result)) {
        setError({ ...(result.field ? { field: result.field } : {}), reason: result.reason });
      } else {
        setError(null);
        setSaved(result.human_summary);
      }
    } catch (err) {
      setError({ reason: err instanceof Error ? err.message : "Could not save the details." });
    } finally {
      // Always re-enable; a thrown error must not leave a dead button.
      setBusy(false);
    }
  }

  const errorFor = (field: string) => (error?.field === field ? error.reason : null);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor="patient_name" className="font-semibold text-ink">
          Patient name
        </label>
        <input
          id="patient_name"
          name="patient_name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={errorFor("patient_name") ? true : undefined}
          aria-describedby={errorFor("patient_name") ? "patient_name-error" : undefined}
          className="rounded border-[1.5px] border-ink px-3 py-2"
        />
        {errorFor("patient_name") && (
          <p id="patient_name-error" className="text-sm font-medium text-spot-deep">
            <span aria-hidden="true">✕ </span>
            {errorFor("patient_name")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="dob" className="font-semibold text-ink">
          Date of birth
        </label>
        {/* The hint is wired with aria-describedby so it is read out, not just
            seen. A native date picker is deliberately not used here. */}
        <p id="dob-hint" className="text-sm text-ink">
          Four-digit year, month, day — for example 1984-03-09.
        </p>
        <input
          id="dob"
          name="dob"
          type="text"
          inputMode="numeric"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          placeholder="1984-03-09"
          aria-describedby={errorFor("dob") ? "dob-hint dob-error" : "dob-hint"}
          aria-invalid={errorFor("dob") ? true : undefined}
          className="rounded border-[1.5px] border-ink px-3 py-2"
        />
        {errorFor("dob") && (
          <p id="dob-error" className="text-sm font-medium text-spot-deep">
            <span aria-hidden="true">✕ </span>
            {errorFor("dob")}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="reason" className="font-semibold text-ink">
          Reason for visit
        </label>
        <textarea
          id="reason"
          name="reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="rounded border-[1.5px] border-ink px-3 py-2"
        />
      </div>

      <fieldset className="rounded border-[1.5px] border-ink p-3">
        <legend className="px-1 font-semibold text-ink">Accommodations needed</legend>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {ACCOMMODATION.options.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <input
                id={`acc-${id}`}
                type="checkbox"
                checked={accommodations.includes(id)}
                onChange={(e) =>
                  setAccommodations((prev) =>
                    e.target.checked ? [...prev, id] : prev.filter((a) => a !== id),
                  )
                }
                className="size-4"
              />
              <label htmlFor={`acc-${id}`} className="text-ink">
                <span aria-hidden="true">{ACCOMMODATION_ICONS[id]} </span>
                {ACCOMMODATION_LABELS[id]}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {error && !error.field && (
        <p className="text-sm font-medium text-spot-deep">
          <span aria-hidden="true">✕ </span>
          {error.reason}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-ink px-4 py-2 font-semibold text-stock hover:bg-ink-soft disabled:opacity-60"
        >
          Save patient details
        </button>

        {/* Completeness in words: exactly what set_intake still needs. */}
        <p role="status" aria-live="polite" className="text-sm text-ink">
          {saved && `${saved} `}
          {missing.length === 0
            ? "All required details are present."
            : `Still needed: ${missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.`}
        </p>
      </div>
    </form>
  );
}
