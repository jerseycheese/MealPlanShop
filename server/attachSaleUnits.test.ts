import * as assert from 'node:assert/strict';
import type { SaleItem, ShoppingListItem } from '../types';
import { attachSaleUnits } from './attachSaleUnits';

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

function sale(item: string, unit: string): SaleItem {
  return { item, price: 1.29, unit, category: 'produce' };
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
    salePrice: opts.salePrice ?? 1.29,
    unit: opts.unit,
  };
}

// Exact name match carries the unit onto the row.
test('exact match attaches unit', () => {
  const rows = [sli('zucchini')];
  attachSaleUnits(rows, [sale('zucchini', 'lb')]);
  assert.equal(rows[0].unit, 'lb');
});

// Fuzzy whole-word match: a plan row "boneless chicken breast" picks up the
// "chicken breast" sale item's unit.
test('whole-word match attaches unit', () => {
  const rows = [sli('boneless chicken breast')];
  attachSaleUnits(rows, [sale('chicken breast', 'lb')]);
  assert.equal(rows[0].unit, 'lb');
});

// A row with no matching sale item stays unit-less.
test('no match leaves unit undefined', () => {
  const rows = [sli('paper towels')];
  attachSaleUnits(rows, [sale('zucchini', 'lb')]);
  assert.equal(rows[0].unit, undefined);
});

// Non-sale rows never get a unit even on a name match — no price shows anyway.
test('non-sale row skipped', () => {
  const rows = [sli('zucchini', { onSale: false, salePrice: null })];
  attachSaleUnits(rows, [sale('zucchini', 'lb')]);
  assert.equal(rows[0].unit, undefined);
});

// Empty sale-item list is a no-op.
test('no sale items is a no-op', () => {
  const rows = [sli('zucchini')];
  attachSaleUnits(rows, []);
  assert.equal(rows[0].unit, undefined);
});

console.log(`attachSaleUnits: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `attachSaleUnits: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
