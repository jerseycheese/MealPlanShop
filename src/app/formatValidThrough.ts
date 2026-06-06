import { parseLocalDate } from "../../parseLocalDate";

// Renders a circular's "valid through" date for the meal-plan banner.
//
// The PDF flow stores a free-form string like "May 19, 2026" — pass it through
// untouched. The Flipp flow stores a date-only ISO string like "2026-06-12"
// (occasionally with a trailing time component), which parseLocalDate anchors
// to local midnight so the rendered day matches the date as written rather than
// slipping a day early west of UTC. Anything it can't parse falls back to raw.
export function formatValidThrough(raw: string | null): string | null {
  if (!raw) return null;
  const d = parseLocalDate(raw);
  if (!d) return raw;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
