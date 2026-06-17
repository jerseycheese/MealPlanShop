import type {
  UserPreferences,
  HouseholdMember,
  DayOfWeek,
  MealType,
} from "../types";
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
// Matches the householdSize ceiling — the member roster *is* the household.
const MAX_MEMBERS = 20;
// Sanity ceiling for the active-time cap; nothing weeknight-realistic needs more.
const MAX_ACTIVE_TIME = 240;
// Sanity ceilings for the per-member sizing hints (issue #74 phase 2b).
const MAX_MEAL_CALORIES = 5000; // a per-serving target; anything higher is a typo
const MAX_PORTION_MULTIPLIER = 10; // 10x a normal portion is already absurd
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

// Validates an optional positive numeric field the way maxActiveTime is — finite,
// in-range, integer when asked (calorie targets) or any positive number otherwise
// (portion multipliers like 1.5). Returns undefined for absent/null/0 so the field
// is omitted from stored prefs, keeping the member shape (and fingerprint) stable
// for households that don't use it (issue #74 phase 2b, skip-migrations).
function validateOptionalPositiveNumber(
  key: string,
  value: unknown,
  opts: { integer: boolean; max: number },
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${key} must be a number`);
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new ValidationError(`${key} must be an integer`);
  }
  if (value < 0 || value > opts.max) {
    throw new ValidationError(`${key} must be between 0 and ${opts.max}`);
  }
  return value > 0 ? value : undefined; // 0 = "unset", omitted like maxActiveTime
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

// Validates the per-member roster (issue #74). Each member's excluded-ingredients,
// dietary-restrictions, and (phase 2a) cuisine-preferences lists go through the
// same validateStringArray as the household-wide lists; the (phase 2b) per-member
// caloriesPerMeal and portionMultiplier sizing hints go through
// validateOptionalPositiveNumber. All three optional fields are omitted when empty/
// unset, so existing rosters that predate them validate unchanged and keep their
// fingerprint stable (skip-migrations). Returns undefined when the roster is
// absent/empty so the field never lands in stored prefs for households that don't
// use it. Per-member lists skip the household-only cross-list conflict checks.
function validateMembers(
  value: unknown,
  listOpts: { maxItems: number; maxLen: number },
): HouseholdMember[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("members must be an array");
  if (value.length > MAX_MEMBERS) {
    throw new ValidationError(`members can have at most ${MAX_MEMBERS} entries`);
  }
  const out: HouseholdMember[] = [];
  for (const m of value) {
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      throw new ValidationError("each member must be an object");
    }
    const rec = m as Record<string, unknown>;
    if (typeof rec.name !== "string") {
      throw new ValidationError("member name must be a string");
    }
    const name = rec.name.trim();
    if (!name) throw new ValidationError("member name cannot be empty");
    if (name.length > MAX_LIST_ITEM_LEN) {
      throw new ValidationError(`member name must be ${MAX_LIST_ITEM_LEN} chars or fewer`);
    }
    const member: HouseholdMember = {
      name,
      excludedIngredients: validateStringArray(
        "member excludedIngredients",
        rec.excludedIngredients,
        listOpts,
      ),
      dietaryRestrictions: validateStringArray(
        "member dietaryRestrictions",
        rec.dietaryRestrictions,
        listOpts,
      ),
    };
    // Optional per-member cuisine lean (phase 2a). Tolerate it being absent on
    // rosters saved before this field existed, and omit it when empty so the
    // stored shape (and fingerprint) for members who don't use it is unchanged.
    const cuisine = validateStringArray(
      "member cuisinePreferences",
      rec.cuisinePreferences ?? [],
      listOpts,
    );
    if (cuisine.length > 0) member.cuisinePreferences = cuisine;
    // Optional per-member sizing hints (phase 2b). Validated like maxActiveTime and
    // omitted when unset/0, so a member who sets neither stays shape-identical.
    const calories = validateOptionalPositiveNumber(
      "member caloriesPerMeal",
      rec.caloriesPerMeal,
      { integer: true, max: MAX_MEAL_CALORIES },
    );
    if (calories !== undefined) member.caloriesPerMeal = calories;
    const portion = validateOptionalPositiveNumber(
      "member portionMultiplier",
      rec.portionMultiplier,
      { integer: false, max: MAX_PORTION_MULTIPLIER },
    );
    if (portion !== undefined) member.portionMultiplier = portion;
    out.push(member);
  }
  return out.length > 0 ? out : undefined;
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
  const members = validateMembers(p.members, listOpts);
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
    // Roster model: the member list *is* the household, so its length wins.
    householdSize: members ? members.length : (size as number),
    ...(members ? { members } : {}),
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
