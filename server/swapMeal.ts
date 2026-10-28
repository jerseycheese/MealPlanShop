import {
  flagExcludedMeal,
  type ExcludedViolation,
} from '../scripts/generate-meal-plan';
import { normalize } from '../normalize';
import { attachSaleJoins } from './decorateMealPlan';
import { mergeShoppingListAfterSwap } from './mergeShoppingList';
import type {
  Meal,
  MealPlanResult,
  MealType,
  SaleItem,
  ShoppingListItem,
} from '../types';

// The swap route's work after request validation, in a sibling module so it can
// be tested with a fake model call (index.ts calls app.listen() at module load).

export interface GeneratedSwap {
  meal: Meal;
  shoppingList: ShoppingListItem[];
  violations: ExcludedViolation[];
}

export type GenerateSwap = (
  plan: MealPlanResult,
  day: string,
  slot: MealType,
  saleItems: SaleItem[]
) => Promise<GeneratedSwap>;

function badRequest(message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400 });
}

// Replaces one meal and merges the shopping list. Mutates and returns the plan.
export async function swapMeal(
  plan: MealPlanResult,
  day: string,
  slot: MealType,
  saleItems: SaleItem[],
  generate: GenerateSwap
): Promise<MealPlanResult> {
  const dayIndex = plan.weekPlan.findIndex(
    (d) => normalize(d.day) === normalize(day)
  );
  if (dayIndex === -1) {
    throw badRequest(`Day not found in plan: ${day}`);
  }
  if (!plan.weekPlan[dayIndex][slot]) {
    throw badRequest(`No ${slot} in current plan for ${day}`);
  }

  const result = await generate(plan, day, slot, saleItems);
  flagExcludedMeal(result.meal, result.violations);

  const mergedShoppingList = mergeShoppingListAfterSwap({
    weekPlan: plan.weekPlan,
    swappedDayIndex: dayIndex,
    swappedSlot: slot,
    newMeal: result.meal,
    priorList: plan.shoppingList,
    regeneratedList: result.shoppingList,
  });
  // Retained rows keep the unit and loyalty flag they were generated with;
  // re-join both for any ingredient the swap newly introduced.
  attachSaleJoins(mergedShoppingList, saleItems);
  plan.weekPlan[dayIndex][slot] = result.meal;
  plan.shoppingList = mergedShoppingList;
  return plan;
}
