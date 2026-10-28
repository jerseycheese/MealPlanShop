import * as assert from 'node:assert/strict';
import { swapMeal, type GeneratedSwap } from './swapMeal';
import type { Meal, MealPlanResult, SaleItem } from '../types';

let passed = 0;
let total = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  total++;
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
  }
}

function meal(name: string, ...ingredients: string[]): Meal {
  return {
    name,
    ingredients: ingredients.map((n) => ({
      name: n,
      quantity: '1',
      onSale: true,
    })),
    activeTime: 1,
    totalTime: 1,
    instructions: [],
    estimatedCalories: 1,
    estimatedCost: 1,
  };
}

function planWithMondayDinner(): MealPlanResult {
  return {
    weekPlan: [{ day: 'Monday', dinner: meal('Chicken', 'chicken') }],
    shoppingList: [
      {
        name: 'chicken',
        quantity: '1',
        category: 'meat',
        onSale: true,
        salePrice: 2,
      },
    ],
  };
}

const SALE_ITEMS: SaleItem[] = [
  {
    item: 'shrimp',
    price: 7.99,
    unit: 'lb',
    category: 'seafood',
    requiresLoyaltyCard: true,
  },
];

// Fake model call: swaps in a shrimp dinner whose regenerated list has the new
// row without the loyalty flag or unit, as Gemini returns it.
function fakeGenerate(violations: GeneratedSwap['violations'] = []) {
  return async (): Promise<GeneratedSwap> => ({
    meal: meal('Shrimp scampi', 'shrimp'),
    shoppingList: [
      {
        name: 'shrimp',
        quantity: '1 lb',
        category: 'seafood',
        onSale: true,
        salePrice: 7.99,
      },
    ],
    violations,
  });
}

export async function run(): Promise<void> {
  // The request's day comes in lowercase; the plan stores "Monday".
  await test('matches the day case-insensitively', async () => {
    const plan = await swapMeal(
      planWithMondayDinner(),
      'monday',
      'dinner',
      SALE_ITEMS,
      fakeGenerate()
    );
    assert.equal(plan.weekPlan[0].dinner?.name, 'Shrimp scampi');
  });

  // A swapped-in ingredient gets the loyalty chip and unit from the circular.
  await test('re-joins sale data onto rows the swap adds', async () => {
    const plan = await swapMeal(
      planWithMondayDinner(),
      'Monday',
      'dinner',
      SALE_ITEMS,
      fakeGenerate()
    );
    const shrimp = plan.shoppingList.find((r) => r.name === 'shrimp');
    assert.equal(shrimp?.requiresLoyaltyCard, true);
    assert.equal(shrimp?.unit, 'lb');
  });

  // An excluded ingredient that survived the retry is flagged, not shipped silently.
  await test('flags excluded ingredients left after the retry', async () => {
    const plan = await swapMeal(
      planWithMondayDinner(),
      'Monday',
      'dinner',
      SALE_ITEMS,
      fakeGenerate([
        {
          mealName: 'Shrimp scampi',
          ingredient: 'shrimp',
          term: 'shrimp',
          sourceCategory: 'shellfish',
        },
      ])
    );
    assert.equal(plan.weekPlan[0].dinner?.excludedWarnings?.length, 1);
  });

  await test('a day missing from the plan is a 400 before any model call', async () => {
    let called = 0;
    await assert.rejects(
      swapMeal(
        planWithMondayDinner(),
        'tuesday',
        'dinner',
        SALE_ITEMS,
        async () => {
          called += 1;
          return fakeGenerate()();
        }
      ),
      (err: Error & { statusCode?: number }) => err.statusCode === 400
    );
    assert.equal(called, 0);
  });

  console.log(`swapMeal: ${passed}/${total} passed`);
  if (failures.length > 0) {
    throw new Error(
      `swapMeal: ${failures.length} test(s) failed: ${failures.join(', ')}`
    );
  }
}
