import * as assert from 'node:assert/strict';
import type { Meal, MealPlanResult } from '../types';
import {
  callModelWithExclusionRetry,
  findExcludedViolations,
  flagExcludedMeal,
  flagExcludedMeals,
} from './generate-meal-plan';

// When the model ignores the excluded list on the first call AND the retry, the
// plan still ships, but the offending meal has to say so (#169).

const meal = (name: string, ingredient: string): Meal => ({
  name,
  ingredients: [{ name: ingredient, quantity: '1 lb', onSale: true }],
  activeTime: 20,
  totalTime: 30,
  instructions: ['cook'],
  estimatedCalories: 600,
  estimatedCost: 11,
});

export async function run(): Promise<void> {
  const original = console.warn;
  console.warn = () => {};
  try {
    // Same violating plan on both calls.
    let calls = 0;
    const { result, violations } = await callModelWithExclusionRetry(
      async (): Promise<MealPlanResult> => {
        calls += 1;
        return {
          weekPlan: [
            {
              day: 'monday',
              lunch: meal('Turkey Wrap', 'turkey'),
              dinner: meal('Garlic Shrimp', 'shrimp'),
            },
          ],
          shoppingList: [],
        };
      },
      (r) => findExcludedViolations(r, ['shellfish']),
      'Plan'
    );
    assert.equal(calls, 2);
    flagExcludedMeals(result, violations);
    const dinner = result.weekPlan[0].dinner!;
    assert.ok(dinner.excludedWarnings?.some((w) => w.includes('shrimp')));
    assert.equal(result.weekPlan[0].lunch!.excludedWarnings, undefined);

    // A retry that comes back clean leaves nothing to flag.
    let n = 0;
    const clean = await callModelWithExclusionRetry(
      async () =>
        n++ === 0 ? meal('Garlic Shrimp', 'shrimp') : meal('Tofu', 'tofu'),
      (m) =>
        findExcludedViolations(
          { weekPlan: [{ day: 'monday', dinner: m }], shoppingList: [] },
          ['shellfish']
        ),
      'Swap'
    );
    assert.deepEqual(clean.violations, []);
    flagExcludedMeal(clean.result, clean.violations);
    assert.equal(clean.result.excludedWarnings, undefined);
  } finally {
    console.warn = original;
  }
}
