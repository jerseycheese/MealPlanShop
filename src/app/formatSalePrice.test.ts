import * as assert from 'node:assert/strict';
import { formatSalePrice } from './formatSalePrice';

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

// A weight unit reads as a per-unit price.
test('per-pound price', () => {
  assert.equal(formatSalePrice(1.29, 'lb'), '$1.29/lb');
});

// A count unit reads as " ea" so it isn't mistaken for per-pound.
test('each price', () => {
  assert.equal(formatSalePrice(0.69, 'each'), '$0.69 ea');
});

// No unit (older plans, non-sale) falls back to a bare price.
test('no unit falls back to bare price', () => {
  assert.equal(formatSalePrice(0.69), '$0.69');
  assert.equal(formatSalePrice(2, ''), '$2.00');
});

// Other measured units pass through after the slash.
test('other measured unit', () => {
  assert.equal(formatSalePrice(2.5, 'bunch'), '$2.50/bunch');
});

console.log(`formatSalePrice: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `formatSalePrice: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
