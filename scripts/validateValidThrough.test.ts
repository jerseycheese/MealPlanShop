import * as assert from 'node:assert/strict';
import { validateValidThrough } from './scan-circular';
import { isCircularExpired } from '../src/app/formatValidThrough';

// A date the cutoff can't drift past: well inside the ~2-week window, built
// from the clock so the suite doesn't expire.
const inRange = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

// Local YYYY-MM-DD for a day offset from today, the shape the scan stores.
function localIso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

// In-range ISO dates pass through as written.
assert.equal(validateValidThrough(inRange), inRange);

// Free-text dates Gemini returns are normalized to local YYYY-MM-DD, so the
// expiry check downstream can read them.
const wordsFor = (offsetDays: number, month: 'long' | 'short' | 'numeric') => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('en-US', {
    month,
    day: 'numeric',
    year: 'numeric',
  });
};
assert.equal(validateValidThrough(wordsFor(5, 'long')), localIso(5));
assert.equal(validateValidThrough(wordsFor(5, 'short')), localIso(5));
assert.equal(validateValidThrough(wordsFor(5, 'numeric')), localIso(5));

// An uploaded circular that ended a few days ago (inside the two-week window,
// so it's kept) now reads as ended; one still running doesn't.
assert.equal(
  isCircularExpired(validateValidThrough(wordsFor(-3, 'long'))),
  true
);
assert.equal(
  isCircularExpired(validateValidThrough(wordsFor(5, 'long'))),
  false
);

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

console.log('validateValidThrough: 16/16 passed');
