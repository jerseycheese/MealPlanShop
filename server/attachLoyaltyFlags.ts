import type { SaleItem, ShoppingListItem } from '../types';
import { containsWholeWord } from '../scripts/excludedCategories';

// The meal-plan prompt doesn't know about the loyalty-card flag, so re-join it
// from the circular's sale items by name — the same fuzzy whole-word match
// attachSaleUnits uses for the per-unit price. Mutates and returns the rows.
export function attachLoyaltyFlags(
  rows: ShoppingListItem[],
  saleItems: SaleItem[]
): ShoppingListItem[] {
  const loyaltyByName = new Set<string>();
  for (const sale of saleItems) {
    if (sale.requiresLoyaltyCard) loyaltyByName.add(sale.item.toLowerCase());
  }
  if (loyaltyByName.size === 0) return rows;

  for (const row of rows) {
    const rowName = row.name.toLowerCase();
    for (const saleName of loyaltyByName) {
      if (
        containsWholeWord(rowName, saleName) ||
        containsWholeWord(saleName, rowName)
      ) {
        row.requiresLoyaltyCard = true;
        break;
      }
    }
  }
  return rows;
}
