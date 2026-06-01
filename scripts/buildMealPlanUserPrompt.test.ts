import * as assert from "node:assert/strict";
import type { SaleItem, UserPreferences } from "../types";
import { buildMealPlanUserPrompt } from "./generate-meal-plan";

const saleItems: SaleItem[] = [
  { item: "Chicken breast", price: 3.99, unit: "lb", category: "meat" },
];

const base: UserPreferences = {
  householdSize: 2,
  dietaryRestrictions: [],
  cuisinePreferences: ["italian"],
  excludedIngredients: [],
  pantryStaples: [],
  useUpIngredients: [],
  mealsPerDay: ["breakfast", "lunch", "dinner"],
  daysOfWeek: ["monday", "tuesday"],
};

// With a cap set, the prompt carries the active-time constraint to the model.
const withCap = buildMealPlanUserPrompt(saleItems, { ...base, maxActiveTime: 20 });
assert.ok(
  withCap.includes("Maximum active") && withCap.includes("20 minutes"),
  "expected the cap line with the value to appear in the prompt",
);

// Without a cap, no active-time line is emitted.
const noCap = buildMealPlanUserPrompt(saleItems, base);
assert.ok(
  !noCap.includes("Maximum active"),
  "expected no active-time line when the cap is unset",
);

console.log("buildMealPlanUserPrompt: 2/2 passed");
