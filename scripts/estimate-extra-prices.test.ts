import * as assert from "node:assert/strict";
import { parsePrice } from "./estimate-extra-prices";

// Plain numbers pass through, rounded to cents; negatives and non-finite are rejected.
assert.equal(parsePrice(3), 3);
assert.equal(parsePrice(2.499), 2.5);
assert.equal(parsePrice(0), 0);
assert.equal(parsePrice(-1), null);
assert.equal(parsePrice(NaN), null);

// Strings like "$3.49" or "about 4 dollars" yield the first number; junk yields null.
assert.equal(parsePrice("$3.49"), 3.49);
assert.equal(parsePrice("about 4 dollars"), 4);
assert.equal(parsePrice("1,299"), 1299);
assert.equal(parsePrice("no idea"), null);
assert.equal(parsePrice(""), null);

// Non-string/number inputs are null, never a throw.
assert.equal(parsePrice(null), null);
assert.equal(parsePrice(undefined), null);
assert.equal(parsePrice({}), null);

console.log("estimate-extra-prices: 13/13 passed");
