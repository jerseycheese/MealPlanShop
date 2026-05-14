import type { DayPlan, Meal, ShoppingListItem } from "../types";

const SLOTS = ["breakfast", "lunch", "dinner"] as const;

function normalize(s: string): string {
  return (s ?? "").trim().toLowerCase();
}

export interface MergeArgs {
  weekPlan: DayPlan[];
  swappedDayIndex: number;
  swappedSlot: "breakfast" | "lunch" | "dinner";
  newMeal: Meal;
  priorList: ShoppingListItem[];
  regeneratedList: ShoppingListItem[];
}

// After a single-meal swap, keep prior shopping-list entries verbatim for any
// ingredient the post-swap week still needs, so their shoppingItemKey (and the
// user's checkbox state) survives. Only genuinely-new ingredients pull a fresh
// entry from Gemini's regenerated list.
export function mergeShoppingListAfterSwap(args: MergeArgs): ShoppingListItem[] {
  const {
    weekPlan,
    swappedDayIndex,
    swappedSlot,
    newMeal,
    priorList,
    regeneratedList,
  } = args;

  const retained = new Set<string>();
  weekPlan.forEach((day, dayIndex) => {
    for (const slot of SLOTS) {
      if (dayIndex === swappedDayIndex && slot === swappedSlot) continue;
      const meal = day[slot];
      if (!meal) continue;
      for (const ing of meal.ingredients) retained.add(normalize(ing.name));
    }
  });
  for (const ing of newMeal.ingredients) retained.add(normalize(ing.name));

  const merged: ShoppingListItem[] = [];
  const usedNames = new Set<string>();

  // Keep duplicates: deduping could orphan a currently-checked key.
  for (const entry of priorList) {
    const name = normalize(entry.name);
    if (retained.has(name)) {
      merged.push(entry);
      usedNames.add(name);
    }
  }

  for (const ing of newMeal.ingredients) {
    const name = normalize(ing.name);
    if (usedNames.has(name)) continue;
    const fromRegenerated = regeneratedList.find(
      (item) => normalize(item.name) === name,
    );
    merged.push(
      fromRegenerated ?? {
        name: ing.name,
        quantity: ing.quantity,
        category: "other",
        onSale: ing.onSale,
        salePrice: null,
      },
    );
    usedNames.add(name);
  }

  return merged;
}
