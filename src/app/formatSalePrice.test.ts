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

// parseUnit and the extraction prompt both emit "per lb" — strip the "per "
// so it reads "$1.29/lb", not "$1.29/per lb".
test('per-pound price', () => {
  assert.equal(formatSalePrice(1.29, 'per lb'), '$1.29/lb');
});

test('per-ounce price', () => {
  assert.equal(formatSalePrice(1.29, 'per oz'), '$1.29/oz');
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

// A multi-buy modifier on "each" isn't a measure — it's a deal condition
// that belongs in priceNote, so it falls back to the bare price.
test('each with multi-buy modifier falls back to bare price', () => {
  assert.equal(formatSalePrice(1.29, 'each (when you buy any 12)'), '$1.29');
});

// A multi-buy string like "3 for $9" isn't a measure either.
test('multi-buy unit falls back to bare price', () => {
  assert.equal(formatSalePrice(3.0, '3 for $9'), '$3.00');
});

// A pack-size hint pulled from the description ("12 Oz.") isn't a measure —
// it would otherwise look like a per-unit rate.
test('pack-size unit falls back to bare price', () => {
  assert.equal(formatSalePrice(1.29, '12 Oz.'), '$1.29');
});

console.log(`formatSalePrice: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `formatSalePrice: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
