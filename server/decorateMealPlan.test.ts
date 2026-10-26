import * as assert from 'node:assert/strict';
import type {
  ExtractionResult,
  SaleItem,
  ShoppingListItem,
  UserPreferences,
} from '../types';
import { decorateMealPlan } from './decorateMealPlan';

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

console.log(`decorateMealPlan: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `decorateMealPlan: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
