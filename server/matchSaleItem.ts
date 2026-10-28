import type { ShoppingListItem } from '../types';
import { containsWholeWord } from '../scripts/excludedCategories';

// Shared by the sale joins (unit, loyalty card) so their match rules can't
// drift. Only on-sale rows match: a regular-price row has no sale price for a
// unit or a card requirement to apply to. byName keys are lowercased sale names.
export function matchSaleItem<T>(
  row: ShoppingListItem,
  byName: Map<string, T>
): T | undefined {
  if (!row.onSale) return undefined;
  const rowName = row.name.toLowerCase();
  for (const [saleName, value] of byName) {
    if (
      containsWholeWord(rowName, saleName) ||
      containsWholeWord(saleName, rowName)
    ) {
      return value;
    }
  }
  return undefined;
}
