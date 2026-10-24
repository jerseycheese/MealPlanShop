import { matchesPantryStaple } from './matchesPantryStaple';
import { normalize } from '../../normalize';
import type {
  DayPlan,
  ExtraItem,
  ShoppingListItem,
  UserPreferences,
} from '../../types';
import { extraKey, shoppingItemKey } from './shoppingItemKey';

// The single place pantryStaples gets edited from the shopping list. Staples mean
// "I always have this, keep it off the list", so the list and the staples are
// mutually exclusive: typing an item in drops its staple, buying one restocks it.
// Both directions go through here so they share one matching rule.
//
// Matching is matchesPantryStaple (the same rule filterPantry hides rows with):
// an item "is" a staple when the staple's words are the item's trailing words.
// So typing "extra virgin olive oil" drops the "olive oil" staple, while typing
// "oil" leaves it alone.
export interface StapleChanges {
  // Item names that were put on the list: any staple they match is dropped.
  dropMatching?: string[];
  // Item names to remember as staples, unless an existing staple already covers them.
  add?: string[];
}

export function applyStapleChanges(
  staples: string[],
  { dropMatching = [], add = [] }: StapleChanges
): string[] {
  const next = staples.filter(
    (staple) => !dropMatching.some((name) => matchesPantryStaple(name, staple))
  );
  for (const raw of add) {
    const name = raw.trim();
    if (!name || next.some((staple) => matchesPantryStaple(name, staple))) {
      continue;
    }
    next.push(name);
  }
  return next;
}

// Does any meal in the plan use an ingredient that one of these staples covers?
// If not, dropping them can't change what generation would produce.
export function planUsesStaples(
  weekPlan: DayPlan[],
  staples: string[]
): boolean {
  return weekPlan.some((day) =>
    [day.breakfast, day.lunch, day.dinner].some((meal) =>
      [
        ...(meal?.ingredients ?? []),
        ...(meal?.variants?.flatMap((v) => v.ingredients) ?? []),
      ].some((ing) => staples.some((s) => matchesPantryStaple(ing.name, s)))
    )
  );
}

export function withStaples(
  prefs: UserPreferences,
  staples: string[]
): UserPreferences {
  return { ...prefs, pantryStaples: staples };
}

// Only shelf-stable "pantry" items come back as staples when bought. Perishables
// (produce, meat, seafood, deli, dairy, bakery) are bought and used up each trip,
// so a staple would wrongly keep them off future lists. snacks and beverages are
// left out too: coffee and seltzer are recurring buys, not standing stock.
const RESTOCK_CATEGORY = 'pantry';

// Names of checked pantry-category items, from the meal-plan list and extras, to
// fold into pantryStaples when the user finishes the trip. Keys come from the
// same helpers the checkboxes use, so a checked row is matched exactly.
export function pantryItemsToRestock(
  items: ShoppingListItem[],
  extras: ExtraItem[],
  checkedKeys: Set<string>
): string[] {
  const names = new Map<string, string>();
  const consider = (name: string, category: string, key: string) => {
    if (normalize(category) === RESTOCK_CATEGORY && checkedKeys.has(key)) {
      names.set(normalize(name), name.trim());
    }
  };
  for (const item of items) {
    consider(item.name, item.category, shoppingItemKey(item));
  }
  for (const extra of extras) {
    consider(extra.name, extra.category, extraKey(extra.name));
  }
  return [...names.values()];
}
