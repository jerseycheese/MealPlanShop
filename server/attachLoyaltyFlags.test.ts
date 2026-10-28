import * as assert from 'node:assert/strict';
import type { SaleItem, ShoppingListItem } from '../types';
import { attachLoyaltyFlags } from './attachLoyaltyFlags';

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

function sale(item: string, requiresLoyaltyCard = true): SaleItem {
  return {
    item,
    price: 9.99,
    unit: 'per lb',
    category: 'meat',
    requiresLoyaltyCard,
  };
}

function sli(
  name: string,
  opts: Partial<Omit<ShoppingListItem, 'name'>> = {}
): ShoppingListItem {
  return {
    name,
    quantity: opts.quantity ?? '1',
    category: opts.category ?? 'other',
    onSale: opts.onSale ?? true,
    salePrice: opts.salePrice ?? 9.99,
    requiresLoyaltyCard: opts.requiresLoyaltyCard,
  };
}

// Exact name match flags the row as needing the loyalty card.
test('exact match attaches requiresLoyaltyCard', () => {
  const rows = [sli('boneless ribeye steak')];
  attachLoyaltyFlags(rows, [sale('boneless ribeye steak')]);
  assert.equal(rows[0].requiresLoyaltyCard, true);
});

// Fuzzy whole-word match, same as attachSaleUnits.
test('whole-word match attaches requiresLoyaltyCard', () => {
  const rows = [sli('ribeye steak')];
  attachLoyaltyFlags(rows, [sale('boneless ribeye steak')]);
  assert.equal(rows[0].requiresLoyaltyCard, true);
});

// A sale item that doesn't require the card never flags a matching row.
test('sale item without the flag leaves rows unflagged', () => {
  const rows = [sli('ribeye steak')];
  attachLoyaltyFlags(rows, [sale('ribeye steak', false)]);
  assert.equal(rows[0].requiresLoyaltyCard, undefined);
});

// A row with no matching sale item stays unflagged.
test('no match leaves requiresLoyaltyCard undefined', () => {
  const rows = [sli('paper towels')];
  attachLoyaltyFlags(rows, [sale('ribeye steak')]);
  assert.equal(rows[0].requiresLoyaltyCard, undefined);
});

// A regular-price row has no sale price to unlock, so a whole-word overlap with
// a card-only sale item must not flag it.
test('non-sale row overlapping a card-only sale stays unflagged', () => {
  const rows = [sli('peanut butter', { onSale: false }), sli('butter')];
  attachLoyaltyFlags(rows, [sale('butter')]);
  assert.equal(rows[0].requiresLoyaltyCard, undefined);
  assert.equal(rows[1].requiresLoyaltyCard, true);
});

// Empty sale-item list is a no-op.
test('no sale items is a no-op', () => {
  const rows = [sli('ribeye steak')];
  attachLoyaltyFlags(rows, []);
  assert.equal(rows[0].requiresLoyaltyCard, undefined);
});

console.log(`attachLoyaltyFlags: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `attachLoyaltyFlags: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
