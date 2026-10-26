import * as assert from 'node:assert/strict';
import type { Meal, MealPlanResult } from '../types';
import { findExcludedViolations } from './generate-meal-plan';

// The household scan is the don't-serve-an-excluded-ingredient guarantee, so it
// has to hold for the dish name, its ingredients, and anything a per-member
// variant drags in. excludedCategories.test.ts covers the plain-meal path
// (cases 9-11); this suite is about the whole-meal walk, variants included.

const meal = (overrides: Partial<Meal> = {}): Meal => ({
  name: 'Chicken Stir-Fry',
  ingredients: [
    { name: 'chicken thighs', quantity: '1 lb', onSale: true },
    { name: 'broccoli', quantity: '1 head', onSale: false },
  ],
  activeTime: 20,
  totalTime: 30,
  instructions: ['cook'],
  estimatedCalories: 600,
  estimatedCost: 11,
  ...overrides,
});

const planWith = (m: Meal): MealPlanResult => ({
  weekPlan: [{ day: 'monday', dinner: m }],
  shoppingList: [],
});

// A clean meal against a real exclusion list is clean.
assert.deepEqual(findExcludedViolations(planWith(meal()), ['shellfish']), []);

// An excluded ingredient in the meal itself is flagged, tagged with where it
// sits in the week.
const direct = findExcludedViolations(
  planWith(
    meal({
      ingredients: [{ name: 'shrimp', quantity: '1 lb', onSale: true }],
    })
  ),
  ['shellfish']
);
assert.equal(direct.length, 1);
assert.equal(direct[0].ingredient, 'shrimp');
assert.equal(direct[0].term, 'shrimp');
assert.equal(direct[0].sourceCategory, 'shellfish');
assert.equal(direct[0].day, 'monday');
assert.equal(direct[0].slot, 'dinner');
// A household hit carries no member — that's what marks it as the hard tier.
assert.equal(direct[0].forMember, undefined);

// The gap worth guarding: the base meal is fine, but the variant added for one
// member smuggles in an ingredient the whole house banned. The variant is
// scanned too, so this is a violation.
const viaVariant = findExcludedViolations(
  planWith(
    meal({
      variants: [
        {
          forMembers: ['Sam'],
          name: 'Garlic Shrimp Bowl',
          ingredients: [
            { name: 'shrimp', quantity: '8 oz', onSale: false },
            { name: 'rice', quantity: '1 cup', onSale: false },
          ],
          instructions: ['cook'],
        },
      ],
    })
  ),
  ['shellfish']
);
// Both the variant's name and its ingredient hit.
assert.equal(viaVariant.length, 2);
assert.ok(viaVariant.every((v) => v.mealName === 'Garlic Shrimp Bowl'));
assert.ok(viaVariant.every((v) => v.term === 'shrimp'));
assert.ok(viaVariant.every((v) => v.day === 'monday' && v.slot === 'dinner'));
assert.equal(viaVariant[0].ingredient, undefined); // the name hit
assert.equal(viaVariant[1].ingredient, 'shrimp');

// Every slot and day gets walked, not just dinner.
const multi: MealPlanResult = {
  weekPlan: [
    { day: 'monday', breakfast: meal({ name: 'Shrimp Omelette' }) },
    { day: 'tuesday', lunch: meal(), dinner: meal({ name: 'Crab Cakes' }) },
  ],
  shoppingList: [],
};
const walked = findExcludedViolations(multi, ['shellfish']);
assert.deepEqual(
  walked.map((v) => `${v.day}/${v.slot}`),
  ['monday/breakfast', 'tuesday/dinner']
);

// No exclusions means no scan at all — a plan full of shrimp is fine if nobody
// banned it.
assert.deepEqual(findExcludedViolations(multi, []), []);

console.log('findExcludedViolations: 16/16 passed');
