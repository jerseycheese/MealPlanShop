import type { DayPlan, Ingredient, Meal, ShoppingListItem } from "../types";
import { MEAL_TYPES } from "../types";
import { normalize } from "../normalize";

// Every ingredient a meal needs to be shopped for, including those introduced by
// per-member variants. A split meal — salmon for the house, a chicken
// swap for one member — has to put both proteins on the list.
function mealIngredients(meal: Meal): Ingredient[] {
  return [
    ...meal.ingredients,
    ...(meal.variants?.flatMap((v) => v.ingredients) ?? []),
  ];
}

export interface MergeArgs {
  weekPlan: DayPlan[];
  swappedDayIndex: number;
  swappedSlot: "breakfast" | "lunch" | "dinner";
  newMeal: Meal;
  priorList: ShoppingListItem[];
  regeneratedList: ShoppingListItem[];
}

// After a single-meal swap, keep the prior shopping-list entry for any ingredient
// the post-swap week still needs, so its name and category (and with them its
// shoppingItemKey and the user's checkbox) survive. Its quantity comes from
// Gemini's regenerated week list when that list has the item, since the swap
// usually changes how much of a shared ingredient the week needs. Only
// genuinely-new ingredients pull a whole fresh entry from the regenerated list.
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
    for (const slot of MEAL_TYPES) {
      if (dayIndex === swappedDayIndex && slot === swappedSlot) continue;
      const meal = day[slot];
      if (!meal) continue;
      for (const ing of mealIngredients(meal)) retained.add(normalize(ing.name));
    }
  });
  for (const ing of mealIngredients(newMeal)) retained.add(normalize(ing.name));

  const merged: ShoppingListItem[] = [];
  const usedNames = new Set<string>();

  const findRegenerated = (name: string) =>
    regeneratedList.find((item) => normalize(item.name) === name);

  for (const entry of priorList) {
    const name = normalize(entry.name);
    if (!retained.has(name) || usedNames.has(name)) continue;
    const quantity = findRegenerated(name)?.quantity ?? entry.quantity;
    merged.push({ ...entry, quantity });
    usedNames.add(name);
  }

  for (const ing of mealIngredients(newMeal)) {
    const name = normalize(ing.name);
    if (usedNames.has(name)) continue;
    merged.push(
      findRegenerated(name) ?? {
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
