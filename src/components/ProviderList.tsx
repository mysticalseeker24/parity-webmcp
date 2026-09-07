import { useState } from "react";
import { findProvider } from "../data/providers";
import { executeAsHuman } from "../lib/registry";
import { isRefusal } from "../lib/result";
import { useBookingStore } from "../store";
import { AccommodationTags } from "./AccommodationTag";

/**
 * Search results. Every "Select" is a real `<button>` running the same
 * `select_provider` tool the agent calls — there is no parallel handler
 * (CONVENTIONS.md §3).
 *
 * When the tool refuses (the provider lacks an accommodation the search
 * required) the reason is shown inline, next to the button that caused it, and
 * announced. The refusal text comes from the tool, so the agent and the human
 * are told the same thing.
 */
export function ProviderList() {
  const lastSearch = useBookingStore((s) => s.lastSearch);
  const selectedId = useBookingStore((s) => s.selectedProviderId);
  const [refusals, setRefusals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  if (!lastSearch) {
    return (
      <p className="text-ink-soft">
        No search yet. Use the command palette or ask the agent to find providers.
      </p>
    );
  }

  const providers = lastSearch.result_ids
    .map(findProvider)
    .filter((p): p is NonNullable<typeof p> => p !== undefined);

  if (providers.length === 0) {
    return <p className="text-ink-soft">That search matched no providers.</p>;
  }

  async function select(providerId: string) {
    setBusy(providerId);
    try {
      const result = await executeAsHuman("select_provider", { provider_id: providerId });
      setRefusals((prev) => {
        const next = { ...prev };
        if (isRefusal(result)) next[providerId] = result.reason;
        else delete next[providerId];
        return next;
      });
    } catch (error) {
      setRefusals((prev) => ({
        ...prev,
        [providerId]: error instanceof Error ? error.message : "Could not select that provider.",
      }));
    } finally {
      // Always re-enable. A button left disabled by a thrown error is a dead
      // control, and disabling a focused one hands focus to <body>.
      setBusy(null);
    }
  }

  return (
    <ul className="flex flex-col gap-4">
      {providers.map((provider) => {
        const isSelected = provider.id === selectedId;
        const refusal = refusals[provider.id];
        const errorId = `refusal-${provider.id}`;
        return (
          <li
            key={provider.id}
            className={` border-[1.5px] p-4 ${
              isSelected ? "border-ink bg-stock-deep" : "border-ink bg-stock"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-ink">
                {provider.name}
                {/* Selection is conveyed in text, not by the green border-[1.5px] alone. */}
                {isSelected && (
                  <span className="ml-2 text-sm font-semibold text-ink">· Selected</span>
                )}
              </h3>
              <p className="text-sm text-ink">
                {provider.location.area} · {provider.location.distance_km} km
              </p>
            </div>

            <p className="mt-1 text-sm text-ink">
              Speaks {provider.languages.join(", ")} · Interpreter lead time{" "}
              {provider.interpreter_lead_time_days} days
            </p>

            <div className="mt-3">
              <AccommodationTags
                ids={provider.accommodations}
                label={`Accommodations offered by ${provider.name}`}
              />
            </div>

            <button
              type="button"
              onClick={() => void select(provider.id)}
              disabled={busy === provider.id}
              aria-describedby={refusal ? errorId : undefined}
              className="mt-3 rounded bg-ink px-4 py-2 font-semibold text-stock hover:bg-ink-soft disabled:opacity-60"
            >
              {isSelected ? `Re-select ${provider.name}` : `Select ${provider.name}`}
            </button>

            {refusal && (
              <p id={errorId} className="mt-2 flex gap-2 text-sm font-medium text-spot-deep">
                {/* Text marker, so the refusal does not depend on the red. */}
                <span aria-hidden="true">✕</span>
                <span>Cannot select: {refusal}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
