import * as assert from 'node:assert/strict';
import type {
  ExtractionResult,
  SaleItem,
  ShoppingListItem,
  UserPreferences,
} from '../types';
import { attachSaleJoins, decorateMealPlan } from './decorateMealPlan';
import { mergeShoppingListAfterSwap } from './mergeShoppingList';

let passed = 0;
let total = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  total++;
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
  }
}

const PREFS = {} as UserPreferences;

function extraction(items: SaleItem[]): ExtractionResult {
  return { items, storeName: 'Test Store', validThrough: null };
}

function sli(name: string): ShoppingListItem {
  return {
    name,
    quantity: '1',
    category: 'meat',
    onSale: true,
    salePrice: 9.99,
  };
}

// This is the seam #142 fell through: regenerate built its own plan and
// skipped this step, so on-sale rows never picked up the unit or the
// loyalty-card flag the circular attached to the sale item. Every caller of
// scanAndPlan (upload, Flipp, regenerate) shares this one decorate function —
// a test here catches the next route that forgets to call it, too.
test('on-sale rows carry unit and requiresLoyaltyCard from the matching sale item', () => {
  const ext = extraction([
    {
      item: 'Boneless Ribeye Steak',
      price: 9.99,
      unit: 'per lb',
      category: 'meat',
      requiresLoyaltyCard: true,
    },
  ]);
  const plan = decorateMealPlan(
    { weekPlan: [], shoppingList: [sli('Boneless Ribeye Steak')] },
    ext,
    PREFS
  );
  assert.equal(plan.shoppingList[0].unit, 'per lb');
  assert.equal(plan.shoppingList[0].requiresLoyaltyCard, true);
});

// decorate also stamps a fresh planId and the current prefs fingerprint,
// which staleness checks and the swap route depend on.
test('stamps planId and prefsFingerprint', () => {
  const plan = decorateMealPlan(
    { weekPlan: [], shoppingList: [] },
    extraction([]),
    PREFS
  );
  assert.ok(plan.planId, 'planId is set');
  assert.ok(plan.prefsFingerprint, 'prefsFingerprint is set');
});

// The swap route builds its list with mergeShoppingListAfterSwap, and rows the
// swap introduces come straight from Gemini without the loyalty flag. Same
// join as decorate, so the swap path can't pick up one and miss the other.
test('a row a swap introduces picks up unit and requiresLoyaltyCard', () => {
  const merged = mergeShoppingListAfterSwap({
    weekPlan: [{ day: 'Monday' }],
    swappedDayIndex: 0,
    swappedSlot: 'dinner',
    newMeal: {
      name: 'Pork chops',
      ingredients: [{ name: 'pork chops', quantity: '2 lb', onSale: true }],
      activeTime: 15,
      totalTime: 25,
      instructions: [],
      estimatedCalories: 500,
      estimatedCost: 6,
    },
    priorList: [],
    regeneratedList: [{ ...sli('pork chops'), quantity: '2 lb' }],
  });
  attachSaleJoins(merged, [
    {
      item: 'Pork Chops',
      price: 2.99,
      unit: 'lb',
      category: 'meat',
      requiresLoyaltyCard: true,
    },
  ]);
  assert.equal(merged[0].unit, 'lb');
  assert.equal(merged[0].requiresLoyaltyCard, true);
});

console.log(`decorateMealPlan: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `decorateMealPlan: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
