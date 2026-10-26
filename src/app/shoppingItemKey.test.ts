import * as assert from 'node:assert/strict';
import type { ShoppingListItem } from '../../types';
import { extraKey, shoppingItemKey } from './shoppingItemKey';

const item = (overrides: Partial<ShoppingListItem> = {}): ShoppingListItem => ({
  name: 'Chicken Thighs',
  quantity: '2 lb',
  category: 'meat',
  onSale: false,
  salePrice: null,
  ...overrides,
});

// Same item -> same key, so a re-render or a reload finds the checkbox again.
assert.equal(shoppingItemKey(item()), shoppingItemKey(item()));

// Category and name both carry into the key: either one differing is a
// different row.
assert.notEqual(
  shoppingItemKey(item()),
  shoppingItemKey(item({ category: 'deli' }))
);
assert.notEqual(
  shoppingItemKey(item()),
  shoppingItemKey(item({ name: 'chicken breast' }))
);

// Quantity stays out of the key on purpose (issue #24): a swap recomputes how
// much of a shared ingredient the week needs, and that must not clear the box.
assert.equal(
  shoppingItemKey(item()),
  shoppingItemKey(item({ quantity: '3 lb' }))
);

// Neither do the sale fields, which change whenever a new circular lands.
assert.equal(
  shoppingItemKey(item()),
  shoppingItemKey(item({ onSale: true, salePrice: 2.99, unit: 'lb' }))
);

// Case and surrounding whitespace normalize away, since Gemini's casing drifts
// between runs.
assert.equal(
  shoppingItemKey(item()),
  shoppingItemKey(item({ name: '  chicken thighs ', category: 'MEAT' }))
);

// The key shape itself — `category::name` — is what's persisted in checkedKeys.
assert.equal(shoppingItemKey(item()), 'meat::chicken thighs');

// Extra items live in the same checkedKeys set, so their keys are namespaced
// and can't collide with a meal-plan row.
assert.equal(extraKey('Paper Towels'), 'extra:paper towels');
assert.equal(extraKey('  Milk  '), extraKey('milk'));
assert.notEqual(extraKey('meat::chicken thighs'), shoppingItemKey(item()));

console.log('shoppingItemKey: 10/10 passed');
