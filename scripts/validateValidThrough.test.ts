import * as assert from 'node:assert/strict';
import { validateValidThrough } from './scan-circular';

// A date the cutoff can't drift past: well inside the ~2-week window, built
// from the clock so the suite doesn't expire.
const inRange = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

// In-range dates pass through untouched, in both shapes Gemini returns.
assert.equal(validateValidThrough(inRange), inRange);
const inRangeWords = new Date(
  Date.now() + 5 * 24 * 60 * 60 * 1000
).toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
assert.equal(validateValidThrough(inRangeWords), inRangeWords);

// Strings with no 4-digit year are left alone — the UI degrades gracefully, and
// there's nothing to sanity-check against.
assert.equal(
  validateValidThrough('Valid through Saturday'),
  'Valid through Saturday'
);
assert.equal(validateValidThrough('Sun - Sat'), 'Sun - Sat');

// Null in, null out.
assert.equal(validateValidThrough(null), null);
assert.equal(validateValidThrough(''), null);

// The actual bug this guards: Gemini misreading the year off an old flyer. A
// date more than two weeks past is dropped rather than shown, and the drop is
// warned about. Capture the warning so the runner's output stays readable.
const originalWarn = console.warn;
const warnings: string[] = [];
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(' '));
};
try {
  assert.equal(validateValidThrough('2020-01-05'), null);
  assert.equal(validateValidThrough('January 5, 2020'), null);
  assert.equal(validateValidThrough('Valid through May 19th, 2019'), null);
} finally {
  console.warn = originalWarn;
}
assert.equal(warnings.length, 3);
assert.ok(warnings.every((w) => w.includes('dropping')));

// Date-shaped but unparseable with a year in it: no date to compare, so the raw
// string survives instead of becoming null.
assert.equal(validateValidThrough('2026-13-45'), '2026-13-45');

console.log('validateValidThrough: 12/12 passed');
