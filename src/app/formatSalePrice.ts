// Render a sale price with its unit so "$1.29/lb" reads differently from
// "$0.69 ea". The unit is free-text off the circular ("lb", "each", "bunch",
// "dozen"); count-like units read as a trailing " ea", anything measured reads
// as a per-unit "/unit". No unit (older plans, non-sale rows) → bare price.
// Issue #121.
const COUNT_UNITS = new Set(['each', 'ea', 'count', 'ct']);

export function formatSalePrice(salePrice: number, unit?: string): string {
  const base = `$${salePrice.toFixed(2)}`;
  const u = (unit ?? '').trim().toLowerCase();
  if (!u) return base;
  if (COUNT_UNITS.has(u)) return `${base} ea`;
  return `${base}/${u}`;
}
