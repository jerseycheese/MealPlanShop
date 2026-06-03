import * as assert from "node:assert/strict";
import type { DayPlan, Ingredient, Meal } from "../types";
import { moveMealInWeekPlan } from "./moveMeal";

let passed = 0;
let total = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  total++;
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
  }
}

function ing(name: string, quantity = "1"): Ingredient {
  return { name, quantity, onSale: false };
}

function meal(name: string, ingredients: Ingredient[] = [ing(name)]): Meal {
  return {
    name,
    ingredients,
    activeTime: 10,
    totalTime: 20,
    instructions: ["cook"],
    estimatedCalories: 400,
    estimatedCost: 5,
  };
}

// Three planned days, all with a dinner, so swap and move cases are easy to set up.
function sampleWeek(): DayPlan[] {
  return [
    { day: "tuesday", lunch: meal("Tue Lunch"), dinner: meal("Tue Dinner") },
    { day: "thursday", lunch: meal("Thu Lunch"), dinner: meal("Thu Dinner") },
    { day: "sunday", lunch: meal("Sun Lunch") },
  ];
}

// Case 1: target slot empty -> meal moves, source slot is removed entirely.
test("move into an empty same-type slot vacates the source", () => {
  const week = sampleWeek();
  const result = moveMealInWeekPlan(week, {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "sunday", mealType: "dinner" },
  });
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  assert.equal(result.swapped, false);
  const sunday = result.weekPlan.find((d) => d.day === "sunday")!;
  const tuesday = result.weekPlan.find((d) => d.day === "tuesday")!;
  assert.equal(sunday.dinner?.name, "Tue Dinner");
  assert.ok(!("dinner" in tuesday), "vacated slot should be an absent property");
});

// Case 2: target slot occupied -> the two meals trade days, same Meal refs reused.
test("move onto an occupied same-type slot swaps the two meals", () => {
  const week = sampleWeek();
  const origTueDinner = week[0].dinner;
  const origThuDinner = week[1].dinner;
  const result = moveMealInWeekPlan(week, {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "thursday", mealType: "dinner" },
  });
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  assert.equal(result.swapped, true);
  const tuesday = result.weekPlan.find((d) => d.day === "tuesday")!;
  const thursday = result.weekPlan.find((d) => d.day === "thursday")!;
  // Same object references, just relocated.
  assert.equal(thursday.dinner, origTueDinner);
  assert.equal(tuesday.dinner, origThuDinner);
});

// Case 3: moving across meal types is rejected.
test("cross-type move is rejected", () => {
  const result = moveMealInWeekPlan(sampleWeek(), {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "thursday", mealType: "lunch" },
  });
  assert.deepEqual(result, { ok: false, code: "CROSS_TYPE" });
});

// Case 4: a no-op move (same day + slot) is rejected as SAME_SLOT.
test("same-slot move is rejected", () => {
  const result = moveMealInWeekPlan(sampleWeek(), {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "tuesday", mealType: "dinner" },
  });
  assert.deepEqual(result, { ok: false, code: "SAME_SLOT" });
});

// Case 5/6: unknown days are rejected.
test("missing from-day is rejected", () => {
  const result = moveMealInWeekPlan(sampleWeek(), {
    from: { day: "monday", mealType: "dinner" },
    to: { day: "thursday", mealType: "dinner" },
  });
  assert.deepEqual(result, { ok: false, code: "FROM_DAY_MISSING" });
});

test("missing to-day is rejected", () => {
  const result = moveMealInWeekPlan(sampleWeek(), {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "monday", mealType: "dinner" },
  });
  assert.deepEqual(result, { ok: false, code: "TO_DAY_MISSING" });
});

// Case 7: an empty source slot has nothing to move.
test("empty source slot is rejected", () => {
  const result = moveMealInWeekPlan(sampleWeek(), {
    from: { day: "sunday", mealType: "dinner" }, // Sunday has no dinner
    to: { day: "tuesday", mealType: "dinner" },
  });
  assert.deepEqual(result, { ok: false, code: "FROM_EMPTY" });
});

// Case 8: the input weekPlan is never mutated.
test("input weekPlan is not mutated", () => {
  const week = sampleWeek();
  const before = JSON.parse(JSON.stringify(week));
  moveMealInWeekPlan(week, {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "thursday", mealType: "dinner" },
  });
  assert.deepEqual(week, before);
});

// Case 9: days not involved in the move are untouched (same refs).
test("uninvolved days keep their meal references", () => {
  const week = sampleWeek();
  const origSundayLunch = week[2].lunch;
  const result = moveMealInWeekPlan(week, {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "thursday", mealType: "dinner" },
  });
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  assert.equal(result.weekPlan.find((d) => d.day === "sunday")!.lunch, origSundayLunch);
});

// Case 10: the multiset of Meal objects is invariant -> proves the shopping list
// can be left untouched, since it's derived purely from the set of meals.
test("the set of meals across the week is unchanged by a move", () => {
  const week = sampleWeek();
  const collect = (plan: DayPlan[]): Set<Meal> => {
    const meals = new Set<Meal>();
    for (const d of plan) {
      for (const slot of ["breakfast", "lunch", "dinner"] as const) {
        if (d[slot]) meals.add(d[slot]!);
      }
    }
    return meals;
  };
  const before = collect(week);
  const result = moveMealInWeekPlan(week, {
    from: { day: "tuesday", mealType: "dinner" },
    to: { day: "sunday", mealType: "dinner" },
  });
  if (!result.ok) throw new Error(`expected ok, got ${result.code}`);
  const after = collect(result.weekPlan);
  assert.equal(after.size, before.size);
  for (const m of before) assert.ok(after.has(m), `meal ${m.name} should survive the move`);
});

console.log(`moveMeal: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(`moveMeal: ${failures.length} test(s) failed: ${failures.join(", ")}`);
}
