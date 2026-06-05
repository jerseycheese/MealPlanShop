// Renders a circular's "valid through" date for the meal-plan banner.
//
// The PDF flow stores a free-form string like "May 19, 2026" — pass it through
// untouched. The Flipp flow stores a date-only ISO string like "2026-06-12"
// (occasionally with a trailing time component). For those we parse just the
// year/month/day tokens and build a *local* Date, so the rendered day matches
// the date as written. `new Date("2026-06-12")` parses as UTC midnight, which
// toLocaleDateString then renders a day early in any zone west of UTC (e.g.
// "Jun 11, 2026" in EDT).
export function formatValidThrough(raw: string | null): string | null {
  if (!raw) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);

  // Reject date-shaped-but-invalid input (e.g. "2026-13-45"), which JS would
  // otherwise silently roll over into a real date. Fall back to the raw string.
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return raw;
  }

  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
