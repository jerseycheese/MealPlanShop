import * as assert from "node:assert/strict";
import { validatePreferences, ValidationError } from "./validatePreferences";

// A complete, valid preferences body (no maxActiveTime set).
const base = {
  householdSize: 2,
  dietaryRestrictions: ["vegetarian"],
  cuisinePreferences: ["italian"],
  excludedIngredients: ["shellfish"],
  pantryStaples: ["olive oil", "salt"],
  useUpIngredients: ["spinach"],
  mealsPerDay: ["breakfast", "lunch", "dinner"],
  daysOfWeek: ["monday", "tuesday", "wednesday"],
};

// Absent cap is valid and omitted from the result.
const noCap = validatePreferences(base);
assert.equal(noCap.maxActiveTime, undefined);

// A valid cap round-trips.
const withCap = validatePreferences({ ...base, maxActiveTime: 20 });
assert.equal(withCap.maxActiveTime, 20);

// 0 means "no cap" — accepted but omitted from the result.
const zeroCap = validatePreferences({ ...base, maxActiveTime: 0 });
assert.equal(zeroCap.maxActiveTime, undefined);

// A negative cap is rejected.
assert.throws(
  () => validatePreferences({ ...base, maxActiveTime: -5 }),
  ValidationError,
);

// A non-numeric cap is rejected.
assert.throws(
  () => validatePreferences({ ...base, maxActiveTime: "fast" }),
  ValidationError,
);

// A non-integer cap is rejected.
assert.throws(
  () => validatePreferences({ ...base, maxActiveTime: 15.5 }),
  ValidationError,
);

console.log("validatePreferences: 6/6 passed");
