import * as assert from 'node:assert/strict';
import { matchesPantryStaple } from './matchesPantryStaple';

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

// The bug report: "butter" as a staple shouldn't hide butter lettuce — it's a
// different food that merely starts with the same word.
test('staple as a leading modifier does not match', () => {
  assert.equal(matchesPantryStaple('organic butter lettuce', 'butter'), false);
  assert.equal(matchesPantryStaple('sugar snap peas', 'sugar'), false);
  assert.equal(matchesPantryStaple('flour tortillas', 'flour'), false);
});

// The staple as the item's trailing word(s) is the actual product.
test('staple as the trailing word matches', () => {
  assert.equal(matchesPantryStaple('salted butter', 'butter'), true);
  assert.equal(matchesPantryStaple('butter', 'butter'), true);
  assert.equal(matchesPantryStaple('all-purpose flour', 'flour'), true);
});

// Multi-word staples must match as a whole trailing phrase, in order.
test('multi-word staple matches as a trailing phrase', () => {
  assert.equal(
    matchesPantryStaple('harissa extra virgin olive oil', 'olive oil'),
    true
  );
  assert.equal(matchesPantryStaple('vegetable oil', 'vegetable oil'), true);
  assert.equal(matchesPantryStaple('olive oil', 'vegetable oil'), false);
});

// Case-insensitive, whitespace-tolerant.
test('case and whitespace are normalized', () => {
  assert.equal(matchesPantryStaple('Organic  Butter', ' Butter '), true);
});

console.log(`matchesPantryStaple: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `matchesPantryStaple: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
