import { parseLocalDate } from "../../parseLocalDate";

/**
 * Render a Flipp valid_from/valid_to pair (date-only strings like "2026-06-12")
 * as a friendly "Jun 12 - Jun 18". Returns "" when either end is missing or
 * unparseable, so the store card just shows nothing.
 */
export function formatDateRange(from: string, to: string): string {
  const a = parseLocalDate(from);
  const b = parseLocalDate(to);
  if (!a || !b) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: Date) => d.toLocaleDateString(undefined, opts);
  return `${fmt(a)} - ${fmt(b)}`;
}
