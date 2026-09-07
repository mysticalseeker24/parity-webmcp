import {
  ACCOMMODATION_ICONS,
  ACCOMMODATION_LABELS,
  type Accommodation,
} from "../data/accommodations";

/**
 * An accommodation, shown as icon **plus** text. The icon is `aria-hidden`, so
 * the accessible name is always the words. Never render the glyph alone.
 */
export function AccommodationTag({ id }: { id: Accommodation }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-sm text-slate-800">
      <span aria-hidden="true">{ACCOMMODATION_ICONS[id]}</span>
      {ACCOMMODATION_LABELS[id]}
    </span>
  );
}

export function AccommodationTags({
  ids,
  label,
}: {
  ids: readonly Accommodation[];
  label: string;
}) {
  if (ids.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <li key={id}>
          <AccommodationTag id={id} />
        </li>
      ))}
    </ul>
  );
}
