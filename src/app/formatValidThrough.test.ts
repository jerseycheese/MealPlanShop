// Pin the runner to a zone west of UTC so the date-only parsing bug would
// surface here if it regressed. `new Date("2026-06-12")` parses as UTC
// midnight, which renders a day early in EDT — the fix builds a local date
// instead. Node applies a runtime TZ change, so this is deterministic in CI.
const originalTZ = process.env.TZ;
process.env.TZ = "America/New_York";

import * as assert from "node:assert/strict";
import { formatValidThrough } from "./formatValidThrough";

const opts = { month: "short", day: "numeric", year: "numeric" } as const;
// Reference built from local Y/M/D — matches the fix's output in any locale,
// and differs from the buggy UTC-parse output under the forced EDT zone.
const ref = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).toLocaleDateString(undefined, opts);

// Date-only ISO string renders the same calendar day it names (the bug).
assert.equal(formatValidThrough("2026-06-12"), ref(2026, 6, 12));

// Trailing time component is ignored — still the named calendar day.
assert.equal(formatValidThrough("2026-06-12T23:59:59Z"), ref(2026, 6, 12));

// Free-form PDF string passes through untouched.
assert.equal(formatValidThrough("May 19, 2026"), "May 19, 2026");

// Null and non-date strings degrade gracefully.
assert.equal(formatValidThrough(null), null);
assert.equal(formatValidThrough("sometime soon"), "sometime soon");

// Date-shaped but invalid input falls back to the raw string, not a rolled-over
// date.
assert.equal(formatValidThrough("2026-13-45"), "2026-13-45");

// Restore so the forced zone doesn't leak into suites that run after this one.
if (originalTZ === undefined) delete process.env.TZ;
else process.env.TZ = originalTZ;

console.log("format-valid-through: 6/6 passed");
