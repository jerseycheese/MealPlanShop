import type { UserPreferences, DayOfWeek, MealType } from "../types";
import { MEAL_TYPES, DAYS_OF_WEEK } from "../types";
import { normalize } from "../normalize";

// Extracted from index.ts so the validation can be unit-tested without booting
// the Express server (index.ts hard-exits without GEMINI_API_KEY and calls
// app.listen() at module load). Mirrors the prefs-fingerprint / mergeShoppingList
// sibling-module pattern.

export class ValidationError extends Error {}

const VALID_MEAL_TYPES = new Set<string>(MEAL_TYPES);
const VALID_DAYS_OF_WEEK = new Set<string>(DAYS_OF_WEEK);
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LEN = 40;
// Sanity ceiling for the active-time cap; nothing weeknight-realistic needs more.
const MAX_ACTIVE_TIME = 240;
// Ceiling for the free-text notes field — a few sentences of instructions, not an essay.
const MAX_NOTES_LEN = 1000;

function validateStringArray(
  key: string,
  value: unknown,
  opts: { maxItems: number; maxLen: number },
): string[] {
  if (!Array.isArray(value)) throw new ValidationError(`${key} must be an array`);
  if (value.length > opts.maxItems) {
    throw new ValidationError(`${key} can have at most ${opts.maxItems} entries`);
  }
  const cleaned: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") throw new ValidationError(`${key} entries must be strings`);
    const trimmed = v.trim();
    if (!trimmed) throw new ValidationError(`${key} entries cannot be empty`);
    if (trimmed.length > opts.maxLen) {
      throw new ValidationError(`${key} entries must be ${opts.maxLen} chars or fewer`);
    }
    cleaned.push(trimmed);
  }
  return cleaned;
}

// Validates the per-day meal map. Keys must be day names (lowercase-trimmed via
// `normalize`), values non-empty lists of valid meal types. Days with an empty
// list are dropped (a day is "planned" only if it has meals). Returns canonical
// form — days in DAYS_OF_WEEK order, meals in MEAL_TYPES order — so the fingerprint
// is stable regardless of the order the client sent.
function validateMealsByDay(value: unknown): Partial<Record<DayOfWeek, MealType[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("mealsByDay must be an object mapping days to meal lists");
  }
  const collected = new Map<string, Set<string>>();
  for (const [dayKey, meals] of Object.entries(value as Record<string, unknown>)) {
    const day = normalize(dayKey);
    if (!VALID_DAYS_OF_WEEK.has(day)) {
      throw new ValidationError("mealsByDay keys must be day names (monday-sunday)");
    }
    if (!Array.isArray(meals)) {
      throw new ValidationError("mealsByDay entries must be arrays of meal types");
    }
    const set = new Set<string>();
    for (const m of meals) {
      if (typeof m !== "string" || !VALID_MEAL_TYPES.has(m)) {
        throw new ValidationError(
          "mealsByDay meals must be 'breakfast', 'lunch', or 'dinner'",
        );
      }
      set.add(m);
    }
    if (set.size > 0) collected.set(day, set);
  }
  if (collected.size === 0) {
    throw new ValidationError(
      "mealsByDay must include at least one day with at least one meal",
    );
  }
  const out: Partial<Record<DayOfWeek, MealType[]>> = {};
  for (const day of DAYS_OF_WEEK) {
    const set = collected.get(day);
    if (set) out[day] = MEAL_TYPES.filter((m) => set.has(m));
  }
  return out;
}

export function validatePreferences(input: unknown): UserPreferences {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const p = input as Record<string, unknown>;

  const size = p.householdSize;
  if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > 20) {
    throw new ValidationError("householdSize must be an integer between 1 and 20");
  }

  // Optional active-time cap. Unset/0 means "any". When present it must be a
  // non-negative integer within a sane ceiling.
  const cap = p.maxActiveTime;
  if (cap !== undefined && cap !== null) {
    if (!Number.isInteger(cap) || (cap as number) < 0 || (cap as number) > MAX_ACTIVE_TIME) {
      throw new ValidationError(
        `maxActiveTime must be an integer between 0 and ${MAX_ACTIVE_TIME} (0 = no cap)`,
      );
    }
  }

  const listOpts = { maxItems: MAX_LIST_ITEMS, maxLen: MAX_LIST_ITEM_LEN };
  const dietary = validateStringArray("dietaryRestrictions", p.dietaryRestrictions, listOpts);
  const cuisine = validateStringArray("cuisinePreferences", p.cuisinePreferences, listOpts);
  const excluded = validateStringArray("excludedIngredients", p.excludedIngredients, listOpts);
  const pantry = validateStringArray("pantryStaples", p.pantryStaples, listOpts);
  const useUp = validateStringArray("useUpIngredients", p.useUpIngredients, listOpts);

  const excludedLower = new Set(excluded.map((s) => s.toLowerCase()));
  const pantryConflicts = pantry.filter((s) => excludedLower.has(s.toLowerCase()));
  if (pantryConflicts.length > 0) {
    throw new ValidationError(
      `Cannot have the same ingredient in both excluded ingredients and pantry staples: ${pantryConflicts.join(", ")}`,
    );
  }
  const useUpConflicts = useUp.filter((s) => excludedLower.has(s.toLowerCase()));
  if (useUpConflicts.length > 0) {
    throw new ValidationError(
      `Cannot have the same ingredient in both excluded ingredients and use-it-up list: ${useUpConflicts.join(", ")}`,
    );
  }

  const mealsByDay = validateMealsByDay(p.mealsByDay);

  // Optional free-text notes. Trim and drop when blank so empty/absent both mean
  // "no instructions" and never reach the prompt as a stray empty line.
  let notes: string | undefined;
  if (p.notes !== undefined && p.notes !== null) {
    if (typeof p.notes !== "string") {
      throw new ValidationError("notes must be a string");
    }
    if (p.notes.length > MAX_NOTES_LEN) {
      throw new ValidationError(`notes must be ${MAX_NOTES_LEN} chars or fewer`);
    }
    const trimmed = p.notes.trim();
    if (trimmed) notes = trimmed;
  }

  return {
    householdSize: size as number,
    dietaryRestrictions: dietary,
    cuisinePreferences: cuisine,
    excludedIngredients: excluded,
    pantryStaples: pantry,
    useUpIngredients: useUp,
    mealsByDay,
    ...(typeof cap === "number" && cap > 0 ? { maxActiveTime: cap } : {}),
    ...(notes ? { notes } : {}),
  };
}
