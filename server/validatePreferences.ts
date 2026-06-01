import type { UserPreferences } from "../types";
import { MEAL_TYPES, DAYS_OF_WEEK } from "../types";

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

// Validates an enum array (mealsPerDay, daysOfWeek) and dedupes preserving
// first-seen order. `normalize` lets daysOfWeek lowercase-trim before checking.
function validateEnumArray(
  key: string,
  value: unknown,
  allowed: Set<string>,
  invalidMsg: string,
  normalize: (s: string) => string = (s) => s,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${key} must include at least one entry`);
  }
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") throw new ValidationError(`${key} entries must be strings`);
    const normalized = normalize(v);
    if (!allowed.has(normalized)) throw new ValidationError(invalidMsg);
    if (!out.includes(normalized)) out.push(normalized);
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

  const meals = validateEnumArray(
    "mealsPerDay",
    p.mealsPerDay,
    VALID_MEAL_TYPES,
    "mealsPerDay entries must be 'breakfast', 'lunch', or 'dinner'",
  );
  const days = validateEnumArray(
    "daysOfWeek",
    p.daysOfWeek,
    VALID_DAYS_OF_WEEK,
    "daysOfWeek entries must be lowercase day names (monday-sunday)",
    (s) => s.trim().toLowerCase(),
  );

  return {
    householdSize: size as number,
    dietaryRestrictions: dietary,
    cuisinePreferences: cuisine,
    excludedIngredients: excluded,
    pantryStaples: pantry,
    useUpIngredients: useUp,
    mealsPerDay: meals,
    daysOfWeek: days,
    ...(typeof cap === "number" && cap > 0 ? { maxActiveTime: cap } : {}),
  };
}
