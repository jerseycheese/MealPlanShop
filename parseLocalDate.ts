/**
 * Parse the leading YYYY-MM-DD of a date string into a Date at *local* midnight.
 *
 * `new Date("2026-06-12")` is parsed as UTC midnight, so toLocaleDateString then
 * renders it a day early in any zone west of UTC (e.g. "Jun 11" in EDT), and a
 * day count against it drifts by the UTC offset. Building the Date from explicit
 * year/month/day keeps it anchored to local time, which is what date-only
 * circular dates (Flipp's valid_from/valid_to) actually mean.
 *
 * Returns null when the string doesn't start with a YYYY-MM-DD token, or when
 * the date doesn't exist (e.g. "2026-13-45"), so callers keep their own
 * empty-string / pass-through fallback.
 */
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  // Reject values Date would silently roll over, like "2026-13-45".
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}
