// Force a zone west of UTC so the old "new Date('2026-06-12')" UTC-midnight
// parse would render a day early. Set before importing the helpers so their
// Date math runs in this zone.
process.env.TZ = "America/New_York";

import * as assert from "node:assert/strict";
import { parseLocalDate } from "../../parseLocalDate";
import { formatDateRange } from "./formatDateRange";

// parseLocalDate anchors a date-only string to local midnight, not UTC — so the
// calendar day survives in any zone.
const d = parseLocalDate("2026-06-12");
assert.ok(d, "expected a Date");
assert.equal(d!.getFullYear(), 2026);
assert.equal(d!.getMonth(), 5); // June, zero-based
assert.equal(d!.getDate(), 12);

// Non-dates and rollovers fall through to null so callers keep their fallback.
assert.equal(parseLocalDate(""), null);
assert.equal(parseLocalDate("May 19, 2026"), null);
assert.equal(parseLocalDate("2026-13-45"), null);

// The whole point: in EDT this must read Jun 12, not Jun 11.
assert.equal(formatDateRange("2026-06-12", "2026-06-18"), "Jun 12 - Jun 18");

// Empty / unparseable ends keep the empty-string fallback.
assert.equal(formatDateRange("", "2026-06-18"), "");
assert.equal(formatDateRange("2026-06-12", "nope"), "");

console.log("formatDateRange: 8/8 passed");
