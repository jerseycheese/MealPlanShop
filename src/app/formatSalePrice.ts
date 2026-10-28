// Render a sale price with its unit so "$1.29/lb" reads differently from
// "$0.69 ea". The unit comes off the circular as "per lb", "per oz", "each",
// or a non-measure string like "3 for $9" or "12 Oz." (a pack size); count-like
// units read as a trailing " ea", a measured unit reads as a per-unit "/unit"
// (a leading "per " is stripped first). No unit, or one that isn't a
// recognized measure, falls back to the bare price — that text belongs in
// priceNote instead.
const COUNT_UNITS = new Set(['each', 'ea', 'count', 'ct']);
// A unit with digits, a $, or parentheses is a deal condition or pack size,
// not a measure — e.g. "3 for $9", "12 Oz.", "each (when you buy any 12)".
const NOT_A_MEASURE = /[\d$()]/;

export function formatSalePrice(salePrice: number, unit?: string): string {
  const base = `$${salePrice.toFixed(2)}`;
  const trimmed = (unit ?? '').trim().toLowerCase();
  if (!trimmed) return base;
  const u = trimmed.replace(/^per\s+/, '');
  if (COUNT_UNITS.has(u)) return `${base} ea`;
  if (NOT_A_MEASURE.test(u)) return base;
  return `${base}/${u}`;
}
