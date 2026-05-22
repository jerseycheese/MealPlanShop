import * as assert from "node:assert/strict";
import { assertMealPlanShape, assertSwapShape } from "./generate-meal-plan";

// assertMealPlanShape: a well-formed plan passes through unchanged.
const validPlan = {
  weekPlan: [{ day: "monday" }],
  shoppingList: [{ name: "eggs", quantity: "1 dozen" }],
};
assert.equal(assertMealPlanShape(validPlan), validPlan);

// assertMealPlanShape: malformed / empty responses throw a clear error.
for (const bad of [
  {},
  null,
  undefined,
  "{}",
  { weekPlan: [] }, // missing shoppingList
  { shoppingList: [] }, // missing weekPlan
  { weekPlan: "nope", shoppingList: [] },
]) {
  assert.throws(
    () => assertMealPlanShape(bad),
    /unexpected meal-plan shape/,
    `expected throw for ${JSON.stringify(bad)}`,
  );
}

// assertSwapShape: a well-formed swap passes through.
const validSwap = {
  meal: { name: "Tacos" },
  shoppingList: [],
};
assert.equal(assertSwapShape(validSwap), validSwap);

// assertSwapShape: malformed responses throw.
for (const bad of [
  {},
  null,
  { meal: { name: "x" } }, // missing shoppingList
  { shoppingList: [] }, // missing meal
  { meal: "x", shoppingList: [] }, // meal not an object
]) {
  assert.throws(
    () => assertSwapShape(bad),
    /unexpected swap shape/,
    `expected throw for ${JSON.stringify(bad)}`,
  );
}

console.log("mealPlanShape: all assertions passed");
