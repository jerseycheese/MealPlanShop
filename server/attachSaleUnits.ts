import type { SaleItem, ShoppingListItem } from '../types';
import { containsWholeWord } from '../scripts/excludedCategories';

// The meal-plan prompt returns a sale price but drops the unit, so "$1.29" can't
// tell per-lb from each. Re-join the unit from the circular's sale items by name
// — the same fuzzy whole-word match the loyalty-card join uses — and hang it on
// each on-sale row. Mutates and returns the rows. Issue #121.
export function attachSaleUnits(
  rows: ShoppingListItem[],
  saleItems: SaleItem[]
): ShoppingListItem[] {
  const unitByName = new Map<string, string>();
  for (const sale of saleItems) {
    const unit = sale.unit?.trim();
    if (unit) unitByName.set(sale.item.toLowerCase(), unit);
  }
  if (unitByName.size === 0) return rows;

  for (const row of rows) {
    // Unit only shows next to a sale price, so non-sale rows can't use it and
    // matching them would only risk a wrong unit.
    if (!row.onSale) continue;
    const rowName = row.name.toLowerCase();
    for (const [saleName, unit] of unitByName) {
      if (
        containsWholeWord(rowName, saleName) ||
        containsWholeWord(saleName, rowName)
      ) {
        row.unit = unit;
        break;
      }
    }
  }
  return rows;
}
