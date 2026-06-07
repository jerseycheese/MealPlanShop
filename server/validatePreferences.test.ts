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
  mealsByDay: {
    monday: ["breakfast", "lunch", "dinner"],
    wednesday: ["dinner"],
  },
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

// --- mealsByDay ---

// A valid map round-trips in canonical order: days in week order, meals in
// breakfast/lunch/dinner order, regardless of the order sent.
assert.deepEqual(
  validatePreferences({
    ...base,
    mealsByDay: { wednesday: ["dinner", "breakfast"], monday: ["dinner"] },
  }).mealsByDay,
  { monday: ["dinner"], wednesday: ["breakfast", "dinner"] },
);

// Day keys are normalized (trim + lowercase), meals deduped, empty days dropped.
assert.deepEqual(
  validatePreferences({
    ...base,
    mealsByDay: { " Monday ": ["dinner", "dinner"], friday: [] },
  }).mealsByDay,
  { monday: ["dinner"] },
);

// An unknown day name is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: { funday: ["dinner"] } }),
  ValidationError,
);

// An unknown meal type is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: { monday: ["brunch"] } }),
  ValidationError,
);

// A map with no planned days (every list empty) is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: { monday: [] } }),
  ValidationError,
);

// A non-object mealsByDay is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: ["monday"] }),
  ValidationError,
);

// --- notes ---

// Absent notes are valid and omitted from the result.
assert.equal(validatePreferences(base).notes, undefined);

// A valid note round-trips, trimmed.
assert.equal(
  validatePreferences({ ...base, notes: "  cook double for leftovers  " }).notes,
  "cook double for leftovers",
);

// Empty / whitespace-only notes are dropped, not stored as "".
assert.equal(validatePreferences({ ...base, notes: "   " }).notes, undefined);

// A non-string note is rejected.
assert.throws(
  () => validatePreferences({ ...base, notes: 42 }),
  ValidationError,
);

// An over-length note is rejected.
assert.throws(
  () => validatePreferences({ ...base, notes: "x".repeat(1001) }),
  ValidationError,
);

console.log("validatePreferences: 17/17 passed");
