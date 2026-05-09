import * as assert from "node:assert/strict";
import type { UserPreferences } from "../types";
import { computePrefsFingerprint } from "./prefs-fingerprint";

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

console.log("prefs-fingerprint: 3/3 passed");
