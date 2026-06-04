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
  mealsByDay: {
    sunday: ["breakfast", "dinner"],
    wednesday: ["dinner"],
  },
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

// Each planned day is listed with exactly its own meals.
assert.ok(
  noCap.includes("Sunday: breakfast, dinner"),
  "expected Sunday's two meals in the prompt",
);
assert.ok(
  noCap.includes("Wednesday: dinner"),
  "expected Wednesday's single meal in the prompt",
);
// Unselected days never appear.
assert.ok(
  !noCap.includes("Monday:"),
  "expected unselected days to be absent from the prompt",
);

// No-circular mode: empty sale items still build a valid prompt that carries
// the preferences (the planner falls back to prefs alone).
const noSales = buildMealPlanUserPrompt([], base);
assert.ok(
  noSales.includes("## Current Sale Items") && noSales.includes("## User Preferences"),
  "expected both sections present even with no sale items",
);
assert.ok(
  noSales.includes("Household size: 2"),
  "expected preferences to drive the prompt when there are no sale items",
);

console.log("buildMealPlanUserPrompt: 7/7 passed");
