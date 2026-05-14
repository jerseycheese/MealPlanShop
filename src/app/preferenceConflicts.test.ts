import * as assert from "node:assert/strict";
import { findExcludedPantryConflicts } from "./preferenceConflicts";

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

console.log("preference-conflicts: 3/3 passed");
