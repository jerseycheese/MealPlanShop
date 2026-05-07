import type { ShoppingListItem } from "../../types";

export function shoppingItemKey(item: ShoppingListItem): string {
  const cat = item.category.trim().toLowerCase();
  const name = item.name.trim().toLowerCase();
  const qty = item.quantity.trim().toLowerCase();
  return `${cat}::${name}::${qty}`;
}
