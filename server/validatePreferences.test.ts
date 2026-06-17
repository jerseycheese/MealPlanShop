import * as assert from "node:assert/strict";
import { validatePreferences, ValidationError } from "./validatePreferences";

// A complete, valid preferences body (no maxActiveTime set).
const base = {
  householdSize: 2,
  dietaryRestrictions: ["vegetarian"],
  cuisinePreferences: ["italian"],
  excludedIngredients: ["shellfish"],
  pantryStaples: ["olive oil", "salt"],
  useUpIngredients: ["spinach"],
  mealsByDay: {
    monday: ["breakfast", "lunch", "dinner"],
    wednesday: ["dinner"],
  },
};

// Absent cap is valid and omitted from the result.
const noCap = validatePreferences(base);
assert.equal(noCap.maxActiveTime, undefined);

// A valid cap round-trips.
const withCap = validatePreferences({ ...base, maxActiveTime: 20 });
assert.equal(withCap.maxActiveTime, 20);

// 0 means "no cap" — accepted but omitted from the result.
const zeroCap = validatePreferences({ ...base, maxActiveTime: 0 });
assert.equal(zeroCap.maxActiveTime, undefined);

// A negative cap is rejected.
assert.throws(
  () => validatePreferences({ ...base, maxActiveTime: -5 }),
  ValidationError,
);

// A non-numeric cap is rejected.
assert.throws(
  () => validatePreferences({ ...base, maxActiveTime: "fast" }),
  ValidationError,
);

// A non-integer cap is rejected.
assert.throws(
  () => validatePreferences({ ...base, maxActiveTime: 15.5 }),
  ValidationError,
);

// --- mealsByDay ---

// A valid map round-trips in canonical order: days in week order, meals in
// breakfast/lunch/dinner order, regardless of the order sent.
assert.deepEqual(
  validatePreferences({
    ...base,
    mealsByDay: { wednesday: ["dinner", "breakfast"], monday: ["dinner"] },
  }).mealsByDay,
  { monday: ["dinner"], wednesday: ["breakfast", "dinner"] },
);

// Day keys are normalized (trim + lowercase), meals deduped, empty days dropped.
assert.deepEqual(
  validatePreferences({
    ...base,
    mealsByDay: { " Monday ": ["dinner", "dinner"], friday: [] },
  }).mealsByDay,
  { monday: ["dinner"] },
);

// An unknown day name is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: { funday: ["dinner"] } }),
  ValidationError,
);

// An unknown meal type is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: { monday: ["brunch"] } }),
  ValidationError,
);

// A map with no planned days (every list empty) is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: { monday: [] } }),
  ValidationError,
);

// A non-object mealsByDay is rejected.
assert.throws(
  () => validatePreferences({ ...base, mealsByDay: ["monday"] }),
  ValidationError,
);

// --- notes ---

// Absent notes are valid and omitted from the result.
assert.equal(validatePreferences(base).notes, undefined);

// A valid note round-trips, trimmed.
assert.equal(
  validatePreferences({ ...base, notes: "  cook double for leftovers  " }).notes,
  "cook double for leftovers",
);

// Empty / whitespace-only notes are dropped, not stored as "".
assert.equal(validatePreferences({ ...base, notes: "   " }).notes, undefined);

// A non-string note is rejected.
assert.throws(
  () => validatePreferences({ ...base, notes: 42 }),
  ValidationError,
);

// An over-length note is rejected.
assert.throws(
  () => validatePreferences({ ...base, notes: "x".repeat(1001) }),
  ValidationError,
);

// --- members (issue #74) ---

// A roster round-trips, and householdSize is derived from the member count —
// the sent householdSize (1) is overridden by the two members.
const roster = validatePreferences({
  ...base,
  householdSize: 1,
  members: [
    { name: "Me", excludedIngredients: [], dietaryRestrictions: [] },
    { name: "Partner", excludedIngredients: ["fish"], dietaryRestrictions: [] },
  ],
});
assert.equal(roster.householdSize, 2);
assert.deepEqual(roster.members, [
  { name: "Me", excludedIngredients: [], dietaryRestrictions: [] },
  { name: "Partner", excludedIngredients: ["fish"], dietaryRestrictions: [] },
]);

// Member name and lists are trimmed, the same way the household-wide lists are.
assert.deepEqual(
  validatePreferences({
    ...base,
    members: [{ name: "  Bo  ", excludedIngredients: ["  fish  "], dietaryRestrictions: [] }],
  }).members,
  [{ name: "Bo", excludedIngredients: ["fish"], dietaryRestrictions: [] }],
);

// No members → field omitted and householdSize is left as sent.
assert.equal(validatePreferences(base).members, undefined);
assert.equal(validatePreferences(base).householdSize, 2);

// A member missing a name is rejected.
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [{ excludedIngredients: [], dietaryRestrictions: [] }],
    }),
  ValidationError,
);

// A blank member name is rejected.
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [{ name: "  ", excludedIngredients: [], dietaryRestrictions: [] }],
    }),
  ValidationError,
);

// A non-object member entry is rejected.
assert.throws(
  () => validatePreferences({ ...base, members: ["Me"] }),
  ValidationError,
);

// An over-length per-member list entry is rejected (same cap as household lists).
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [{ name: "X", excludedIngredients: ["y".repeat(41)], dietaryRestrictions: [] }],
    }),
  ValidationError,
);

// More than the member cap is rejected.
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: Array.from({ length: 21 }, (_, i) => ({
        name: `M${i}`,
        excludedIngredients: [],
        dietaryRestrictions: [],
      })),
    }),
  ValidationError,
);

// --- per-member cuisinePreferences (issue #74 phase 2a) ---

// A per-member cuisine list round-trips and is trimmed, same as the other lists.
assert.deepEqual(
  validatePreferences({
    ...base,
    members: [
      {
        name: "Me",
        excludedIngredients: [],
        dietaryRestrictions: [],
        cuisinePreferences: ["  Thai  ", "Indian"],
      },
    ],
  }).members,
  [
    {
      name: "Me",
      excludedIngredients: [],
      dietaryRestrictions: [],
      cuisinePreferences: ["Thai", "Indian"],
    },
  ],
);

// An empty per-member cuisine list is omitted, leaving the member shape (and its
// fingerprint) byte-identical to a member that never carried the field.
assert.deepEqual(
  validatePreferences({
    ...base,
    members: [
      { name: "Me", excludedIngredients: [], dietaryRestrictions: [], cuisinePreferences: [] },
    ],
  }).members,
  [{ name: "Me", excludedIngredients: [], dietaryRestrictions: [] }],
);

// A member saved before this field existed (no cuisinePreferences key) still
// validates and the result omits the field — no migration needed.
assert.deepEqual(
  validatePreferences({
    ...base,
    members: [{ name: "Me", excludedIngredients: [], dietaryRestrictions: [] }],
  }).members,
  [{ name: "Me", excludedIngredients: [], dietaryRestrictions: [] }],
);

// An over-length per-member cuisine entry is rejected (same 40-char cap).
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [
        {
          name: "X",
          excludedIngredients: [],
          dietaryRestrictions: [],
          cuisinePreferences: ["z".repeat(41)],
        },
      ],
    }),
  ValidationError,
);

// --- per-member sizing hints: caloriesPerMeal + portionMultiplier (phase 2b) ---

// Both fields round-trip. portionMultiplier is a fractional value to prove a
// non-integer positive number is accepted (unlike the integer calorie target).
assert.deepEqual(
  validatePreferences({
    ...base,
    members: [
      {
        name: "Me",
        excludedIngredients: [],
        dietaryRestrictions: [],
        caloriesPerMeal: 600,
        portionMultiplier: 1.5,
      },
    ],
  }).members,
  [
    {
      name: "Me",
      excludedIngredients: [],
      dietaryRestrictions: [],
      caloriesPerMeal: 600,
      portionMultiplier: 1.5,
    },
  ],
);

// 0 (and absent) sizing fields are omitted, leaving the member byte-identical to
// one that never carried them — no migration, fingerprint stays stable.
assert.deepEqual(
  validatePreferences({
    ...base,
    members: [
      {
        name: "Me",
        excludedIngredients: [],
        dietaryRestrictions: [],
        caloriesPerMeal: 0,
        portionMultiplier: 0,
      },
    ],
  }).members,
  [{ name: "Me", excludedIngredients: [], dietaryRestrictions: [] }],
);

// A non-integer calorie target is rejected (the field is whole-number only).
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [
        { name: "X", excludedIngredients: [], dietaryRestrictions: [], caloriesPerMeal: 15.5 },
      ],
    }),
  ValidationError,
);

// A negative calorie target is rejected.
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [
        { name: "X", excludedIngredients: [], dietaryRestrictions: [], caloriesPerMeal: -100 },
      ],
    }),
  ValidationError,
);

// An over-ceiling calorie target is rejected.
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [
        { name: "X", excludedIngredients: [], dietaryRestrictions: [], caloriesPerMeal: 5001 },
      ],
    }),
  ValidationError,
);

// A non-numeric portion multiplier is rejected.
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [
        { name: "X", excludedIngredients: [], dietaryRestrictions: [], portionMultiplier: "big" },
      ],
    }),
  ValidationError,
);

// An over-ceiling portion multiplier is rejected.
assert.throws(
  () =>
    validatePreferences({
      ...base,
      members: [
        { name: "X", excludedIngredients: [], dietaryRestrictions: [], portionMultiplier: 11 },
      ],
    }),
  ValidationError,
);

console.log("validatePreferences: 36/36 passed");
