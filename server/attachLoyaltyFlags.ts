import type { SaleItem, ShoppingListItem } from '../types';
import { matchSaleItem } from './matchSaleItem';

// The meal-plan prompt doesn't know about the loyalty-card flag, so re-join it
// from the circular's sale items by name. Mutates and returns the rows.
export function attachLoyaltyFlags(
  rows: ShoppingListItem[],
  saleItems: SaleItem[]
): ShoppingListItem[] {
  const loyaltyByName = new Map<string, true>();
  for (const sale of saleItems) {
    if (sale.requiresLoyaltyCard)
      loyaltyByName.set(sale.item.toLowerCase(), true);
  }
  if (loyaltyByName.size === 0) return rows;

  for (const row of rows) {
    if (matchSaleItem(row, loyaltyByName)) row.requiresLoyaltyCard = true;
  }
  return rows;
}
