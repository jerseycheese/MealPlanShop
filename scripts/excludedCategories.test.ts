import * as assert from 'node:assert/strict';
import type { HouseholdMember, Meal, MealPlanResult } from '../types';
import {
  EXCLUDED_CATEGORIES,
  containsWholeWord,
  expandExcludedTerms,
} from './excludedCategories';
import {
  filterExcludedSaleItems,
  findExcludedViolations,
  findMemberViolations,
  findMemberVariantViolations,
  formatViolationsForRetry,
  type SaleItem,
} from './generate-meal-plan';

// 1. Empty input -> empty output.
assert.deepEqual(expandExcludedTerms([]), []);

// 2. Non-category term passes through with sourceCategory: null.
assert.deepEqual(expandExcludedTerms(['kale']), [
  { term: 'kale', sourceCategory: null },
]);

// 3. Single category expands to all members + the category itself.
const shellfish = expandExcludedTerms(['shellfish']);
assert.equal(shellfish.length, EXCLUDED_CATEGORIES.shellfish.length + 1);
assert.deepEqual(shellfish[0], { term: 'shellfish', sourceCategory: null });
const shellfishMembers = shellfish.slice(1);
assert.deepEqual(
  shellfishMembers.map((e) => e.term),
  EXCLUDED_CATEGORIES.shellfish
);
assert.ok(shellfishMembers.every((e) => e.sourceCategory === 'shellfish'));

// 4. Multi-word category key works.
const redMeat = expandExcludedTerms(['red meat']);
assert.ok(
  redMeat.some((e) => e.term === 'beef' && e.sourceCategory === 'red meat')
);

// 5. Case-insensitive match.
assert.equal(expandExcludedTerms(['Shellfish']).length, shellfish.length);
assert.equal(expandExcludedTerms(['SHELLFISH']).length, shellfish.length);

// 6. Whitespace trimming.
assert.equal(
  expandExcludedTerms(['  dairy  ']).length,
  EXCLUDED_CATEGORIES.dairy.length + 1
);

// 7. Dedup: ["shellfish", "shrimp"] does not double-list shrimp.
const dedup = expandExcludedTerms(['shellfish', 'shrimp']);
const shrimpEntries = dedup.filter((e) => e.term.toLowerCase() === 'shrimp');
assert.equal(shrimpEntries.length, 1);
assert.equal(shrimpEntries[0].sourceCategory, 'shellfish');

// 8. Mixed input.
const mixed = expandExcludedTerms(['shellfish', 'kale']);
assert.ok(mixed.some((e) => e.term === 'kale' && e.sourceCategory === null));
assert.ok(
  mixed.some((e) => e.term === 'shrimp' && e.sourceCategory === 'shellfish')
);

// 9. Integration: findExcludedViolations catches "shrimp" when "shellfish" is excluded.
const meal: Meal = {
  name: 'Shrimp Scampi',
  ingredients: [
    { name: 'shrimp', quantity: '1 lb', onSale: false },
    { name: 'garlic', quantity: '4 cloves', onSale: false },
  ],
  activeTime: 15,
  totalTime: 25,
  instructions: ['cook'],
  estimatedCalories: 500,
  estimatedCost: 12,
};
const plan: MealPlanResult = {
  weekPlan: [{ day: 'monday', dinner: meal }],
  shoppingList: [],
};
const violations = findExcludedViolations(plan, ['shellfish']);
// Both the meal name "Shrimp Scampi" and the ingredient "shrimp" hit.
assert.equal(violations.length, 2);
assert.ok(violations.every((v) => v.sourceCategory === 'shellfish'));
assert.ok(violations.every((v) => v.term === 'shrimp'));
assert.equal(violations[0].day, 'monday');
assert.equal(violations[0].slot, 'dinner');

// 10. Integration: literal exclusion still works (kale is not a category).
const kaleMeal: Meal = {
  ...meal,
  name: 'Kale Salad',
  ingredients: [{ name: 'kale', quantity: '1 bunch', onSale: false }],
};
const kalePlan: MealPlanResult = {
  weekPlan: [{ day: 'monday', lunch: kaleMeal }],
  shoppingList: [],
};
const kaleViolations = findExcludedViolations(kalePlan, ['kale']);
assert.equal(kaleViolations.length, 2);
assert.ok(kaleViolations.every((v) => v.sourceCategory === undefined));

// 11. No excluded terms -> no violations.
assert.deepEqual(findExcludedViolations(plan, []), []);

// 12. filterExcludedSaleItems: ["shellfish"] drops shrimp, keeps kale.
const saleItems: SaleItem[] = [
  { item: 'shrimp', price: 5.99, unit: 'lb', category: 'seafood' },
  { item: 'kale', price: 1.99, unit: 'bunch', category: 'produce' },
];
const filtered = filterExcludedSaleItems(saleItems, ['shellfish']);
assert.equal(filtered.length, 1);
assert.equal(filtered[0].item, 'kale');

// 13. filterExcludedSaleItems: literal non-category term still drops matching items.
const kaleFiltered = filterExcludedSaleItems(saleItems, ['kale']);
assert.equal(kaleFiltered.length, 1);
assert.equal(kaleFiltered[0].item, 'shrimp');

// 14. filterExcludedSaleItems: no excluded terms -> all items pass through.
assert.deepEqual(filterExcludedSaleItems(saleItems, []), saleItems);

// 15. containsWholeWord: matches whole words, not substrings.
assert.equal(containsWholeWord('large eggs', 'eggs'), true);
assert.equal(containsWholeWord('eggplant parmesan', 'egg'), false);
assert.equal(containsWholeWord('graham crackers', 'ham'), false);
assert.equal(containsWholeWord('broiler chicken', 'oil'), false);
assert.equal(containsWholeWord('salted caramel ice cream', 'salt'), false);
assert.equal(containsWholeWord('kosher salt', 'salt'), true);
// 16. containsWholeWord: case-insensitive, trims, handles empty.
assert.equal(containsWholeWord('Olive Oil', 'oil'), true);
assert.equal(containsWholeWord('anything', '  '), false);
assert.equal(containsWholeWord('anything', ''), false);

// -- Per-member variant validation (issue #125) --

const members: HouseholdMember[] = [
  { name: 'Sam', excludedIngredients: ['fish'], dietaryRestrictions: [] },
];

// 17. A variant containing its own member's excluded ingredient is detected and
//     tagged with that member; findMemberViolations attaches day/slot.
const splitMeal: Meal = {
  name: 'Salmon Bowl',
  ingredients: [{ name: 'salmon', quantity: '1 lb', onSale: false }],
  activeTime: 15,
  totalTime: 25,
  instructions: ['cook'],
  estimatedCalories: 500,
  estimatedCost: 12,
  variants: [
    {
      forMembers: ['Sam'],
      name: 'Fish Tacos',
      ingredients: [{ name: 'fish', quantity: '1 lb', onSale: false }],
      instructions: ['cook'],
    },
  ],
};
const memberPlan: MealPlanResult = {
  weekPlan: [{ day: 'Monday', dinner: splitMeal }],
  shoppingList: [],
};
const memberViolations = findMemberViolations(memberPlan, members);
// Both the variant name "Fish Tacos" and the ingredient "fish" hit Sam's list.
assert.equal(memberViolations.length, 2);
assert.ok(memberViolations.every((v) => v.forMember === 'Sam'));
assert.ok(memberViolations.every((v) => v.term === 'fish'));
assert.equal(memberViolations[0].day, 'Monday');
assert.equal(memberViolations[0].slot, 'dinner');

// 18. Member exclusions expand by category too: excluding "dairy" catches "milk".
const dairyMembers: HouseholdMember[] = [
  { name: 'Alex', excludedIngredients: ['dairy'], dietaryRestrictions: [] },
];
const dairyMeal: Meal = {
  ...splitMeal,
  name: 'Veggie Pasta',
  ingredients: [{ name: 'pasta', quantity: '1 lb', onSale: false }],
  variants: [
    {
      forMembers: ['Alex'],
      name: 'Creamy Alfredo',
      ingredients: [{ name: 'milk', quantity: '1 cup', onSale: false }],
      instructions: ['cook'],
    },
  ],
};
const dairyViolations = findMemberVariantViolations(dairyMeal, dairyMembers);
assert.equal(dairyViolations.length, 1);
assert.equal(dairyViolations[0].term, 'milk');
assert.equal(dairyViolations[0].sourceCategory, 'dairy');
assert.equal(dairyViolations[0].forMember, 'Alex');

// 19. A variant that avoids the member's list produces no violations.
const cleanMeal: Meal = {
  ...dairyMeal,
  variants: [
    {
      forMembers: ['Alex'],
      name: 'Olive Oil Pasta',
      ingredients: [{ name: 'olive oil', quantity: '2 tbsp', onSale: false }],
      instructions: ['cook'],
    },
  ],
};
assert.deepEqual(findMemberVariantViolations(cleanMeal, dairyMembers), []);

// 20. The soft tier only constrains a member's own variant — the MAIN meal may
//     contain that member's excluded ingredient (everyone else eats it).
const mainHasItem: Meal = {
  name: 'Fish Fry',
  ingredients: [{ name: 'fish', quantity: '1 lb', onSale: false }],
  activeTime: 15,
  totalTime: 25,
  instructions: ['cook'],
  estimatedCalories: 500,
  estimatedCost: 12,
  variants: [
    {
      forMembers: ['Sam'],
      name: 'Chicken Plate',
      ingredients: [{ name: 'chicken', quantity: '1 lb', onSale: false }],
      instructions: ['cook'],
    },
  ],
};
assert.deepEqual(findMemberVariantViolations(mainHasItem, members), []);

// 21. A variant pointing at a member not in the roster is skipped, not crashed.
const orphanMeal: Meal = {
  ...mainHasItem,
  variants: [
    {
      forMembers: ['Ghost'],
      name: 'Fish Tacos',
      ingredients: [{ name: 'fish', quantity: '1 lb', onSale: false }],
      instructions: ['cook'],
    },
  ],
};
assert.deepEqual(findMemberVariantViolations(orphanMeal, members), []);

// 22. Member names match trimmed + case-insensitively, so a casing/space drift in
//     forMembers still validates, attributed to the canonical roster name.
const driftMeal: Meal = {
  ...mainHasItem,
  variants: [
    {
      forMembers: [' sam '],
      name: 'Fish Tacos',
      ingredients: [{ name: 'fish', quantity: '1 lb', onSale: false }],
      instructions: ['cook'],
    },
  ],
};
const driftViolations = findMemberVariantViolations(driftMeal, members);
assert.ok(driftViolations.length >= 1);
assert.ok(driftViolations.every((v) => v.forMember === 'Sam'));

// 23. No roster (or empty) -> no member violations; household-only is unaffected.
assert.deepEqual(findMemberViolations(memberPlan, undefined), []);
assert.deepEqual(findMemberViolations(memberPlan, []), []);

// 24. The retry note scopes a member fix to the variant and does NOT reuse the
//     household "remove everywhere" wording, which would over-correct the main meal.
const memberNote = formatViolationsForRetry(memberViolations);
assert.ok(memberNote.includes('Sam'));
assert.ok(memberNote.includes('variant'));
assert.ok(!memberNote.includes('zero occurrences'));

// 25. Household violations still get the absolute-ban wording verbatim.
const householdNote = formatViolationsForRetry(
  findExcludedViolations(plan, ['shellfish'])
);
assert.ok(householdNote.includes('zero occurrences of any excluded term'));
assert.ok(!householdNote.includes('the variant for'));

// 26. Mixed violations emit both notes.
const mixedNote = formatViolationsForRetry([
  ...findExcludedViolations(plan, ['shellfish']),
  ...memberViolations,
]);
assert.ok(mixedNote.includes('zero occurrences of any excluded term'));
assert.ok(mixedNote.includes('the variant for Sam'));

console.log('excludedCategories: 26/26 passed');
