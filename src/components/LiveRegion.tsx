/**
 * The announcement surface. Two regions, per CONVENTIONS.md §6: one polite for
 * ordinary tool results, one assertive for errors and authorization requests.
 *
 * Phase 4 mounts them empty. Phase 5 wires `lib/announcer.ts` to the store so
 * every execution — agent- or human-initiated — is spoken with the actor named.
 * They are mounted now so the regions exist in the DOM before any announcement
 * arrives: a live region added at the same moment as its text is frequently
 * missed by screen readers.
 */
export function LiveRegion({
  polite = "",
  assertive = "",
}: {
  polite?: string;
  assertive?: string;
}) {
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-polite">
        {polite}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only" data-testid="live-assertive">
        {assertive}
      </div>
    </>
  );
}
