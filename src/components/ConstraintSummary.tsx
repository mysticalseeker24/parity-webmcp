import { useBookingStore } from "../store";

/**
 * The constraints that are narrowing the calendar, said out loud.
 *
 * `set_companion_constraint` and `set_transport_constraint` filter which slots
 * `get_availability` returns. Both were reachable only through a tool, and
 * neither appeared anywhere on the page — so an agent could set a paratransit
 * window, half the week would quietly disappear from the calendar, and nothing
 * on screen explained why. Fewer options with no stated reason is the failure
 * mode this product exists to argue against.
 *
 * Display only: there is no clear-this tool, and both constraints lock once
 * availability has been fetched. Saying so is better than implying an
 * affordance that does not exist.
 */
export function ConstraintSummary() {
  const companion = useBookingStore((s) => s.companion);
  const transport = useBookingStore((s) => s.transport);
  const fetched = useBookingStore((s) => s.hasFetchedAvailability);

  if (!companion && !transport) return null;

  return (
    <section
      aria-labelledby="constraints-heading"
      className="mb-4 border-[1.5px] border-ink bg-stock-deep p-3"
    >
      <h3
        id="constraints-heading"
        className="font-display text-[0.7rem] font-bold uppercase tracking-[0.14em] text-ink-soft"
      >
        Narrowing these times
      </h3>

      <dl className="mt-2 flex flex-col gap-1.5 text-sm text-ink">
        {transport && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">Paratransit window</dt>
            <dd>
              pickup from {transport.earliest_pickup}, back by {transport.latest_return}
              {transport.note ? ` — ${transport.note}` : ""}
            </dd>
          </div>
        )}
        {companion && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-semibold">
              {companion.name ? `${companion.name} can attend` : "Companion can attend"}
            </dt>
            <dd>
              {companion.available_from ?? "any time"} to {companion.available_to ?? "any time"}
            </dd>
          </div>
        )}
      </dl>

      <p className="mt-2 text-xs text-ink-soft">
        {fetched
          ? "Only appointments that fit entirely inside these windows are shown. These are fixed for this booking."
          : "Appointments that do not fit entirely inside these windows will be hidden."}
      </p>
    </section>
  );
}
