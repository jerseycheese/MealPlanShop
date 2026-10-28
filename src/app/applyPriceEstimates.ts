import { normalize } from '../../normalize';
import type { ExtraItem } from '../../types';

// Fold Gemini price estimates into the extras as they are now, not as they were
// when the estimate was requested. Only rows still on the list get a price;
// rows added or removed while the estimate was pending stay that way.
// The estimate endpoint's rows, unchecked: Gemini output can be malformed.
export type PriceEstimate = {
  name?: unknown;
  price?: unknown;
  category?: unknown;
} | null;

export function applyPriceEstimates(
  extras: ExtraItem[],
  prices: PriceEstimate[] | undefined
): ExtraItem[] {
  const estimated = new Map<string, PriceEstimate & object>();
  for (const p of prices ?? []) {
    if (p && typeof p.name === 'string') estimated.set(normalize(p.name), p);
  }
  return extras.map((e) => {
    const hit = estimated.get(normalize(e.name));
    return hit
      ? {
          ...e,
          price: typeof hit.price === 'number' ? hit.price : null,
          category:
            typeof hit.category === 'string' ? hit.category : e.category,
        }
      : e;
  });
}
