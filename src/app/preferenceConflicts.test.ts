import * as assert from "node:assert/strict";
import {
  findExcludedPantryConflicts,
  findExcludedUseUpConflicts,
} from "./preferenceConflicts";

assert.deepEqual(
  findExcludedPantryConflicts([" shrimp ", "Mushrooms"], ["salt", "Shrimp"]),
  ["shrimp"],
);

assert.deepEqual(
  findExcludedPantryConflicts(["shrimp", "SHRIMP"], [" shrimp "]),
  ["shrimp"],
);

assert.deepEqual(
  findExcludedPantryConflicts(["shellfish"], ["salt", "olive oil"]),
  [],
);

// Use-it-up conflicts use the same overlap logic against the excluded list.
assert.deepEqual(
  findExcludedUseUpConflicts([" Spinach "], ["spinach", "zucchini"]),
  ["Spinach"],
);

assert.deepEqual(
  findExcludedUseUpConflicts(["mushrooms"], ["spinach", "zucchini"]),
  [],
);

console.log("preference-conflicts: 5/5 passed");
