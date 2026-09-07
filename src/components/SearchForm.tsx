import { useState } from "react";
import {
  ACCOMMODATION,
  ACCOMMODATION_ICONS,
  ACCOMMODATION_LABELS,
  type Accommodation,
} from "../data/accommodations";
import { INSURANCE_PLANS, SPECIALTY, SPECIALTY_LABELS, type Specialty } from "../data/providers";
import { executeAsHuman } from "../lib/registry";
import { isRefusal } from "../lib/result";

/**
 * The visual entry point to `find_providers`. Runs the same tool the agent
 * calls; nothing here reimplements the search.
 */
export function SearchForm() {
  const [specialty, setSpecialty] = useState<Specialty>("neurology");
  const [accommodations, setAccommodations] = useState<Accommodation[]>([]);
  const [insurance, setInsurance] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await executeAsHuman("find_providers", {
        specialty,
        accommodations,
        insurance: insurance === "" ? undefined : insurance,
      });
      setMessage(isRefusal(result) ? result.reason : result.human_summary);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The search could not be run.");
    } finally {
      // Always re-enable; a thrown error must not leave a dead button.
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="specialty" className="font-semibold text-ink">
          Specialty
        </label>
        <select
          id="specialty"
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value as Specialty)}
          className="rounded border-[1.5px] border-ink px-3 py-2"
        >
          {SPECIALTY.options.map((option) => (
            <option key={option} value={option}>
              {SPECIALTY_LABELS[option]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="insurance" className="font-semibold text-ink">
          Insurance plan
        </label>
        <select
          id="insurance"
          value={insurance}
          onChange={(e) => setInsurance(e.target.value)}
          className="rounded border-[1.5px] border-ink px-3 py-2"
        >
          <option value="">Any plan</option>
          {INSURANCE_PLANS.map((plan) => (
            <option key={plan} value={plan}>
              {plan}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="rounded border-[1.5px] border-ink p-3">
        <legend className="px-1 font-semibold text-ink">Required accommodations</legend>
        <ul className="mt-1 grid gap-2 sm:grid-cols-2">
          {ACCOMMODATION.options.map((id) => (
            <li key={id} className="flex items-center gap-2">
              <input
                id={`search-acc-${id}`}
                type="checkbox"
                checked={accommodations.includes(id)}
                onChange={(e) =>
                  setAccommodations((prev) =>
                    e.target.checked ? [...prev, id] : prev.filter((a) => a !== id),
                  )
                }
                className="size-4"
              />
              <label htmlFor={`search-acc-${id}`} className="text-ink">
                <span aria-hidden="true">{ACCOMMODATION_ICONS[id]} </span>
                {ACCOMMODATION_LABELS[id]}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-ink px-4 py-2 font-semibold text-stock hover:bg-ink-soft disabled:opacity-60"
        >
          Find providers
        </button>
        <p role="status" aria-live="polite" className="text-sm text-ink">
          {message}
        </p>
      </div>
    </form>
  );
}
