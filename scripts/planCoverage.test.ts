import * as assert from 'node:assert/strict';
import type { DayOfWeek, Meal, MealPlanResult, MealType } from '../types';
import {
  callModelWithExclusionRetry,
  findMissingMeals,
} from './generate-meal-plan';

// A plan that drops a day or a meal must not be accepted as complete (#204).

const meal: Meal = {
  name: 'Tacos',
  ingredients: [],
  activeTime: 10,
  totalTime: 20,
  instructions: [],
  estimatedCalories: 500,
  estimatedCost: 15,
};

const asked: Partial<Record<DayOfWeek, MealType[]>> = {
  monday: ['dinner'],
  tuesday: ['lunch', 'dinner'],
};

const plan = (weekPlan: MealPlanResult['weekPlan']): MealPlanResult => ({
  weekPlan,
  shoppingList: [],
});

export async function run(): Promise<void> {
  // Full coverage, with the model's capitalized day names.
  const full = plan([
    { day: 'Monday', dinner: meal },
    { day: 'Tuesday', lunch: meal, dinner: meal },
  ]);
  assert.deepEqual(findMissingMeals(full, asked), []);

  // Missing meal.
  assert.deepEqual(
    findMissingMeals(
      plan([
        { day: 'Monday', dinner: meal },
        { day: 'Tuesday', lunch: meal },
      ]),
      asked
    ),
    ['tuesday dinner']
  );

  // Missing day.
  assert.deepEqual(
    findMissingMeals(plan([{ day: 'Monday', dinner: meal }]), asked),
    ['tuesday lunch', 'tuesday dinner']
  );

  // An extra day the user didn't ask for isn't a gap.
  assert.deepEqual(
    findMissingMeals(
      plan([...full.weekPlan, { day: 'Wednesday', dinner: meal }]),
      asked
    ),
    []
  );

  const original = console.warn;
  console.warn = () => {};
  try {
    // A short first plan gets one retry whose note names what was missing.
    const notes: (string | undefined)[] = [];
    const fixed = await callModelWithExclusionRetry(
      async (note) => {
        notes.push(note);
        return notes.length === 1
          ? plan([{ day: 'Monday', dinner: meal }])
          : full;
      },
      () => [],
      'Plan',
      (r) => findMissingMeals(r, asked)
    );
    assert.equal(notes.length, 2);
    assert.match(notes[1] ?? '', /tuesday lunch, tuesday dinner/);
    assert.deepEqual(fixed.missing, []);

    // Still short after the retry: the gaps come back so the caller can refuse it.
    const short = await callModelWithExclusionRetry(
      async () => plan([]),
      () => [],
      'Plan',
      (r) => findMissingMeals(r, asked)
    );
    assert.equal(short.missing.length, 3);
  } finally {
    console.warn = original;
  }
}
