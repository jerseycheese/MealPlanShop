import * as assert from 'node:assert/strict';
import type { SaleItem } from '../types';
import { deduplicateItems } from './scan-circular';

const item = (overrides: Partial<SaleItem> = {}): SaleItem => ({
  item: 'Chicken Thighs',
  price: 1.99,
  unit: 'lb',
  category: 'meat',
  ...overrides,
});

// Nothing in, nothing out.
assert.deepEqual(deduplicateItems([]), []);

// The case this exists for: a multi-page circular repeats the same deal on the
// front page and in the meat section. Same name + price collapses to one row.
const repeated = deduplicateItems([item(), item()]);
assert.equal(repeated.length, 1);

// Casing drifts between pages, so the key is case-insensitive.
const cased = deduplicateItems([item(), item({ item: 'CHICKEN THIGHS' })]);
assert.equal(cased.length, 1);
// First occurrence wins — its casing and fields are what survive.
assert.equal(cased[0].item, 'Chicken Thighs');

// Same name at a different price is a different deal (a size or loyalty tier),
// so both stay.
const priced = deduplicateItems([item(), item({ price: 2.49 })]);
assert.equal(priced.length, 2);
assert.deepEqual(
  priced.map((i) => i.price),
  [1.99, 2.49]
);

// Different items at the same price are untouched.
const distinct = deduplicateItems([item(), item({ item: 'ground beef' })]);
assert.equal(distinct.length, 2);

// Only name and price key the row — a page that mislabels the category or unit
// still collapses rather than leaving a near-duplicate pair in the list.
const sameDeal = deduplicateItems([
  item(),
  item({ category: 'deli', unit: 'each', priceNote: 'with card' }),
]);
assert.equal(sameDeal.length, 1);
assert.equal(sameDeal[0].category, 'meat');

console.log('deduplicateItems: 9/9 passed');
