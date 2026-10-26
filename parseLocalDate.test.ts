// Pin the runner to a zone west of UTC so the UTC-parse bug this helper exists
// to prevent would actually show up here. Set before the import so any Date math
// at module load runs in this zone. Node applies a runtime TZ change, so CI
// matches a local run.
const originalTZ = process.env.TZ;
process.env.TZ = 'America/New_York';

import * as assert from 'node:assert/strict';
import { parseLocalDate } from './parseLocalDate';

// A date-only string becomes local midnight on the day it names.
const june = parseLocalDate('2026-06-12');
assert.ok(june, 'expected a Date for 2026-06-12');
assert.equal(june.getFullYear(), 2026);
assert.equal(june.getMonth(), 5); // June, zero-based
assert.equal(june.getDate(), 12);
assert.equal(june.getHours(), 0);

// The regression guard: west of UTC, the plain Date constructor lands on the
// 11th. parseLocalDate must not.
assert.equal(new Date('2026-06-12').getDate(), 11);
assert.notEqual(june.getTime(), new Date('2026-06-12').getTime());

// Only the leading YYYY-MM-DD matters — a trailing time component is ignored
// rather than shifting the day (Flipp sends both shapes).
const withTime = parseLocalDate('2026-06-12T23:59:59Z');
assert.ok(withTime, 'expected a Date for the timestamped form');
assert.equal(withTime.getTime(), june.getTime());

// Non-date input returns null so callers keep their own fallback.
assert.equal(parseLocalDate(''), null);
assert.equal(parseLocalDate('May 19, 2026'), null);
assert.equal(parseLocalDate('sometime soon'), null);

// Date-shaped but impossible values return null instead of silently rolling
// over to 2027-02-14.
assert.equal(parseLocalDate('2026-13-45'), null);
assert.equal(parseLocalDate('2026-02-30'), null);

// A real leap day still parses.
const leap = parseLocalDate('2024-02-29');
assert.ok(leap, 'expected a Date for 2024-02-29');
assert.equal(leap.getDate(), 29);

// Restore so the forced zone doesn't leak into suites that run after this one.
if (originalTZ === undefined) delete process.env.TZ;
else process.env.TZ = originalTZ;

console.log('parseLocalDate: 16/16 passed');
