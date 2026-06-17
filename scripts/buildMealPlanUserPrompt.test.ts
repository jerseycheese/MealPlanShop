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

// Free-text notes ride into the prompt verbatim so the model honors them.
const withNotes = buildMealPlanUserPrompt(saleItems, {
  ...base,
  notes: "cook dinners double for leftovers",
});
assert.ok(
  withNotes.includes("Special instructions") &&
    withNotes.includes("cook dinners double for leftovers"),
  "expected the notes to appear in the prompt",
);

// No notes → no special-instructions line at all.
assert.ok(
  !noCap.includes("Special instructions"),
  "expected no special-instructions line when notes are unset",
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

// Per-member needs (issue #74) render into the prompt so the model can offer a
// variant for the member who won't eat fish.
const withMembers = buildMealPlanUserPrompt(saleItems, {
  ...base,
  members: [
    { name: "Me", excludedIngredients: [], dietaryRestrictions: [] },
    { name: "Partner", excludedIngredients: ["fish"], dietaryRestrictions: [] },
  ],
});
assert.ok(
  withMembers.includes("Household members") &&
    withMembers.includes("Partner") &&
    withMembers.includes("won't eat: fish"),
  "expected the per-member block with the member's exclusion in the prompt",
);
assert.ok(
  withMembers.includes("variants"),
  "expected the prompt to instruct the model to add per-member variants",
);

// No members → no member block at all (single-profile households read as before).
assert.ok(
  !noCap.includes("Household members"),
  "expected no per-member block when members are unset",
);

// Per-member cuisine preferences (issue #74 phase 2a) render as a soft "prefers"
// lean for that member; a member without them emits no "prefers:" clause.
const withMemberCuisine = buildMealPlanUserPrompt(saleItems, {
  ...base,
  members: [
    { name: "Me", excludedIngredients: [], dietaryRestrictions: [], cuisinePreferences: ["Thai"] },
    { name: "Partner", excludedIngredients: ["fish"], dietaryRestrictions: [] },
  ],
});
assert.ok(
  withMemberCuisine.includes("Me — won't eat: none; dietary: none; prefers: Thai"),
  "expected the member's cuisine preferences rendered as a 'prefers' clause",
);
assert.ok(
  !withMemberCuisine.includes("Partner — won't eat: fish; dietary: none; prefers:"),
  "expected no 'prefers' clause for a member without cuisine preferences",
);

// Per-member sizing hints (issue #74 phase 2b) render as soft "target"/"portion"
// leans for that member; a member without them emits neither clause.
const withMemberSizing = buildMealPlanUserPrompt(saleItems, {
  ...base,
  members: [
    {
      name: "Me",
      excludedIngredients: [],
      dietaryRestrictions: [],
      caloriesPerMeal: 600,
      portionMultiplier: 1.5,
    },
    { name: "Partner", excludedIngredients: ["fish"], dietaryRestrictions: [] },
  ],
});
assert.ok(
  withMemberSizing.includes("target: ~600 cal/serving") &&
    withMemberSizing.includes("portion: 1.5x"),
  "expected the member's calorie target and portion multiplier in the prompt",
);
assert.ok(
  !withMemberSizing.includes("Partner — won't eat: fish; dietary: none;"),
  "expected no sizing clause for a member without calorie target or portion",
);

console.log("buildMealPlanUserPrompt: 16/16 passed");
