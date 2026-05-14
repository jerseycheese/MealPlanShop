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
  mealsPerDay: ["breakfast", "lunch", "dinner"],
  daysOfWeek: ["monday", "tuesday", "wednesday"],
};

// Same prefs in same order produce the same hash.
assert.equal(
  computePrefsFingerprint(base),
  computePrefsFingerprint(base),
);

// Re-ordered top-level keys produce the same hash (canonical sort).
const reordered: UserPreferences = {
  daysOfWeek: base.daysOfWeek,
  pantryStaples: base.pantryStaples,
  mealsPerDay: base.mealsPerDay,
  excludedIngredients: base.excludedIngredients,
  cuisinePreferences: base.cuisinePreferences,
  dietaryRestrictions: base.dietaryRestrictions,
  householdSize: base.householdSize,
};
assert.equal(
  computePrefsFingerprint(base),
  computePrefsFingerprint(reordered),
);

// Changing any field produces a different hash.
const changed: UserPreferences = { ...base, daysOfWeek: ["monday", "friday"] };
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

console.log("prefs-fingerprint: 7/7 passed");
