import type { ShoppingListItem } from '../../types';
import { normalize } from '../../normalize';

// Quantity stays out of the key so a swap can recompute it without dropping the
// row's checkbox.
export function shoppingItemKey(item: ShoppingListItem): string {
  const cat = normalize(item.category);
  const name = normalize(item.name);
  return `${cat}::${name}`;
}

// Stable checkbox key for an extra item, namespaced so it can't collide with a
// meal-plan item's key in the shared checkedKeys set.
export function extraKey(name: string): string {
  return `extra:${name.trim().toLowerCase()}`;
}
