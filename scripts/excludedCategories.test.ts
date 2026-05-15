import * as assert from "node:assert/strict";
import type { Meal, MealPlanResult } from "../types";
import { EXCLUDED_CATEGORIES, expandExcludedTerms } from "./excludedCategories";
import { findExcludedViolations } from "./generate-meal-plan";

// 1. Empty input -> empty output.
assert.deepEqual(expandExcludedTerms([]), []);

// 2. Non-category term passes through with sourceCategory: null.
assert.deepEqual(expandExcludedTerms(["kale"]), [
  { term: "kale", sourceCategory: null },
]);

// 3. Single category expands to all members + the category itself.
const shellfish = expandExcludedTerms(["shellfish"]);
assert.equal(shellfish.length, EXCLUDED_CATEGORIES.shellfish.length + 1);
assert.deepEqual(shellfish[0], { term: "shellfish", sourceCategory: null });
const shellfishMembers = shellfish.slice(1);
assert.deepEqual(
  shellfishMembers.map((e) => e.term),
  EXCLUDED_CATEGORIES.shellfish,
);
assert.ok(shellfishMembers.every((e) => e.sourceCategory === "shellfish"));

// 4. Multi-word category key works.
const redMeat = expandExcludedTerms(["red meat"]);
assert.ok(redMeat.some((e) => e.term === "beef" && e.sourceCategory === "red meat"));

// 5. Case-insensitive match.
assert.equal(expandExcludedTerms(["Shellfish"]).length, shellfish.length);
assert.equal(expandExcludedTerms(["SHELLFISH"]).length, shellfish.length);

// 6. Whitespace trimming.
assert.equal(expandExcludedTerms(["  dairy  "]).length, EXCLUDED_CATEGORIES.dairy.length + 1);

// 7. Dedup: ["shellfish", "shrimp"] does not double-list shrimp.
const dedup = expandExcludedTerms(["shellfish", "shrimp"]);
const shrimpEntries = dedup.filter((e) => e.term.toLowerCase() === "shrimp");
assert.equal(shrimpEntries.length, 1);
assert.equal(shrimpEntries[0].sourceCategory, "shellfish");

// 8. Mixed input.
const mixed = expandExcludedTerms(["shellfish", "kale"]);
assert.ok(mixed.some((e) => e.term === "kale" && e.sourceCategory === null));
assert.ok(mixed.some((e) => e.term === "shrimp" && e.sourceCategory === "shellfish"));

// 9. Integration: findExcludedViolations catches "shrimp" when "shellfish" is excluded.
const meal: Meal = {
  name: "Shrimp Scampi",
  ingredients: [
    { name: "shrimp", quantity: "1 lb", onSale: false },
    { name: "garlic", quantity: "4 cloves", onSale: false },
  ],
  activeTime: 15,
  totalTime: 25,
  instructions: ["cook"],
  estimatedCalories: 500,
  estimatedCost: 12,
};
const plan: MealPlanResult = {
  weekPlan: [{ day: "monday", dinner: meal }],
  shoppingList: [],
};
const violations = findExcludedViolations(plan, ["shellfish"]);
// Both the meal name "Shrimp Scampi" and the ingredient "shrimp" hit.
assert.equal(violations.length, 2);
assert.ok(violations.every((v) => v.sourceCategory === "shellfish"));
assert.ok(violations.every((v) => v.term === "shrimp"));
assert.equal(violations[0].day, "monday");
assert.equal(violations[0].slot, "dinner");

// 10. Integration: literal exclusion still works (kale is not a category).
const kaleMeal: Meal = {
  ...meal,
  name: "Kale Salad",
  ingredients: [{ name: "kale", quantity: "1 bunch", onSale: false }],
};
const kalePlan: MealPlanResult = {
  weekPlan: [{ day: "monday", lunch: kaleMeal }],
  shoppingList: [],
};
const kaleViolations = findExcludedViolations(kalePlan, ["kale"]);
assert.equal(kaleViolations.length, 2);
assert.ok(kaleViolations.every((v) => v.sourceCategory === undefined));

// 11. No excluded terms -> no violations.
assert.deepEqual(findExcludedViolations(plan, []), []);

console.log("excludedCategories: 11/11 passed");
