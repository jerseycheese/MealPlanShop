import type { DayPlan, MealType } from "../types";

export interface MoveSpec {
  from: { day: string; mealType: MealType };
  to: { day: string; mealType: MealType };
}

export type MoveErrorCode =
  | "SAME_SLOT" // from === to: a no-op, nothing to do
  | "CROSS_TYPE" // moving across meal types isn't allowed (locked decision)
  | "FROM_DAY_MISSING"
  | "TO_DAY_MISSING"
  | "FROM_EMPTY"; // source slot has no meal to move

export type MoveOutcome =
  | { ok: true; weekPlan: DayPlan[]; swapped: boolean }
  | { ok: false; code: MoveErrorCode };

// Relocate a single meal within the week. A meal can only move to the SAME meal
// type on a different day. If the target slot already holds a meal the two trade
// places (swap); otherwise the meal moves and the source slot is vacated.
//
// This is a pure relocation: the multiset of Meal objects across the week is
// unchanged, which is why a move never has to touch the shopping list. Returns a
// NEW weekPlan and never mutates the input. Meal objects are reused by reference
// (we're relocating the same meal, not copying it).
export function moveMealInWeekPlan(
  weekPlan: DayPlan[],
  spec: MoveSpec,
): MoveOutcome {
  const { from, to } = spec;

  if (from.day === to.day && from.mealType === to.mealType) {
    return { ok: false, code: "SAME_SLOT" };
  }
  if (from.mealType !== to.mealType) {
    return { ok: false, code: "CROSS_TYPE" };
  }

  const fromIdx = weekPlan.findIndex((d) => d.day === from.day);
  if (fromIdx === -1) return { ok: false, code: "FROM_DAY_MISSING" };
  const toIdx = weekPlan.findIndex((d) => d.day === to.day);
  if (toIdx === -1) return { ok: false, code: "TO_DAY_MISSING" };

  const movingMeal = weekPlan[fromIdx][from.mealType];
  if (!movingMeal) return { ok: false, code: "FROM_EMPTY" };
  const targetMeal = weekPlan[toIdx][to.mealType];

  // Shallow-clone each DayPlan so we don't mutate the caller's array. Slots are
  // plain properties, so cloning the DayPlan objects is enough.
  const next = weekPlan.map((d) => ({ ...d }));
  next[toIdx][to.mealType] = movingMeal;
  if (targetMeal) {
    next[fromIdx][from.mealType] = targetMeal;
  } else {
    // Vacated slot is dropped entirely so the JSON matches generated plans,
    // where an absent meal type is a missing property rather than undefined.
    delete next[fromIdx][from.mealType];
  }

  return { ok: true, weekPlan: next, swapped: Boolean(targetMeal) };
}
