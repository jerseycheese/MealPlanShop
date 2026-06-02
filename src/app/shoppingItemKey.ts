import type { ShoppingListItem } from "../../types";
import { normalize } from "../../normalize";

export function shoppingItemKey(item: ShoppingListItem): string {
  const cat = normalize(item.category);
  const name = normalize(item.name);
  const qty = normalize(item.quantity);
  return `${cat}::${name}::${qty}`;
}
