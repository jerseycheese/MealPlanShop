import * as assert from "node:assert/strict";
import type { UserPreferences } from "../types";
import {
  computePrefsFingerprint,
  isPlanFingerprintStale,
} from "./prefs-fingerprint";

const base: UserPreferences = {
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

// Same prefs in same order produce the same hash.
assert.equal(
  computePrefsFingerprint(base),
  computePrefsFingerprint(base),
);

// Re-ordered top-level keys produce the same hash (canonical sort).
const reordered: UserPreferences = {
  mealsByDay: base.mealsByDay,
  pantryStaples: base.pantryStaples,
  useUpIngredients: base.useUpIngredients,
  excludedIngredients: base.excludedIngredients,
  cuisinePreferences: base.cuisinePreferences,
  dietaryRestrictions: base.dietaryRestrictions,
  householdSize: base.householdSize,
};
assert.equal(
  computePrefsFingerprint(base),
  computePrefsFingerprint(reordered),
);

// Re-ordered day keys inside mealsByDay also hash the same — the canonical sort
// reaches nested objects, which a top-level key allow-list would have stripped.
const reorderedDays: UserPreferences = {
  ...base,
  mealsByDay: {
    wednesday: ["dinner"],
    monday: ["breakfast", "lunch", "dinner"],
  },
};
assert.equal(
  computePrefsFingerprint(base),
  computePrefsFingerprint(reorderedDays),
);

// Changing a single day's meals produces a different hash.
const changed: UserPreferences = {
  ...base,
  mealsByDay: { ...base.mealsByDay, wednesday: ["breakfast", "dinner"] },
};
assert.notEqual(
  computePrefsFingerprint(base),
  computePrefsFingerprint(changed),
);

// isPlanFingerprintStale: a plan whose fingerprint matches current prefs is fresh.
assert.equal(
  isPlanFingerprintStale({ prefsFingerprint: computePrefsFingerprint(base) }, base),
  false,
);

// A missing fingerprint counts as stale (e.g. plans predating fingerprinting).
assert.equal(isPlanFingerprintStale({}, base), true);

// A non-string fingerprint counts as stale.
assert.equal(
  isPlanFingerprintStale({ prefsFingerprint: 12345 as unknown as string }, base),
  true,
);

// A fingerprint from different prefs counts as stale.
assert.equal(
  isPlanFingerprintStale({ prefsFingerprint: computePrefsFingerprint(changed) }, base),
  true,
);

console.log("prefs-fingerprint: 8/8 passed");
