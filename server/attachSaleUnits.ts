import type { SaleItem, ShoppingListItem } from '../types';
import { matchSaleItem } from './matchSaleItem';

// The meal-plan prompt returns a sale price but drops the unit, so "$1.29" can't
// tell per-lb from each. Re-join the unit from the circular's sale items by name
// and hang it on each on-sale row. Mutates and returns the rows.
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
    const unit = matchSaleItem(row, unitByName);
    if (unit) row.unit = unit;
  }
  return rows;
}
