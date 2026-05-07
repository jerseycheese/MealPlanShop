import type { ShoppingListItem } from "../../types";

export function shoppingItemKey(item: ShoppingListItem): string {
  return `${item.category.trim().toLowerCase()}::${item.name.trim().toLowerCase()}`;
}
