import * as assert from 'node:assert/strict';
import { applyPriceEstimates } from './applyPriceEstimates';
import type { ExtraItem } from '../../types';

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

const row = (name: string): ExtraItem => ({
  name,
  price: null,
  category: 'other',
});
const milkEstimate = [{ name: 'Milk', price: 3.49, category: 'dairy' }];

// A slow estimate must not replay the list as it was when the add started.
test('keeps rows added while the estimate was pending', () => {
  assert.deepEqual(
    applyPriceEstimates([row('milk'), row('bread')], milkEstimate),
    [{ name: 'milk', price: 3.49, category: 'dairy' }, row('bread')]
  );
});

test('does not restore rows removed while the estimate was pending', () => {
  assert.deepEqual(applyPriceEstimates([], milkEstimate), []);
  assert.deepEqual(applyPriceEstimates([row('bread')], milkEstimate), [
    row('bread'),
  ]);
});

test('a bad estimate leaves the row uncosted with its category', () => {
  assert.deepEqual(
    applyPriceEstimates(
      [row('milk')],
      [{ name: 'milk', price: 'cheap' }, null]
    ),
    [row('milk')]
  );
  assert.deepEqual(applyPriceEstimates([row('milk')], undefined), [
    row('milk'),
  ]);
});

console.log(`applyPriceEstimates: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `applyPriceEstimates: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
