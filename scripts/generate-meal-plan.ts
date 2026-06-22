import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import type {
  Meal,
  MealPlanResult,
  HouseholdMember,
  Ingredient,
  SaleItem,
  ShoppingListItem,
  UserPreferences,
  DayOfWeek,
  MealType,
} from '../types';
import { MEAL_TYPES, DAYS_OF_WEEK } from '../types';
import {
  EXCLUDED_CATEGORIES,
  expandExcludedTerms,
  matchExpandedTerm,
  type ExpandedTerm,
} from './excludedCategories';
import { GEMINI_MODEL } from './env';
import { requireGeminiKey } from '../server/secrets';
import { toReadableGeminiError } from '../server/geminiErrors';
export type { SaleItem, UserPreferences };

export const DEFAULT_PANTRY_STAPLES: string[] = [
  'salt',
  'black pepper',
  'olive oil',
  'butter',
  'garlic',
  'onion',
  'flour',
  'sugar',
  'soy sauce',
  'vinegar',
];

export const DEFAULT_PREFERENCES: UserPreferences = {
  householdSize: 2,
  dietaryRestrictions: ['low carb', 'low sodium'],
  cuisinePreferences: ['Italian', 'Mexican', 'Asian', 'American'],
  excludedIngredients: [],
  pantryStaples: [...DEFAULT_PANTRY_STAPLES],
  useUpIngredients: [],
  // Every day, all three meals — preserves the prior all-or-nothing default.
  mealsByDay: Object.fromEntries(
    DAYS_OF_WEEK.map((d) => [d, [...MEAL_TYPES]])
  ) as Record<DayOfWeek, MealType[]>,
};

// -- Prompt loading --

// Single source of truth for category->members. The prompts carry a
// {{CATEGORY_EXPANSIONS}} placeholder so the list lives only in
// EXCLUDED_CATEGORIES, not hand-copied into the .md files.
function buildCategoryExpansions(): string {
  return Object.entries(EXCLUDED_CATEGORIES)
    .map(([category, members]) => `"${category}" covers ${members.join(', ')}`)
    .join('; ');
}

function loadPrompt(relPath: string): string {
  const raw = fs.readFileSync(path.join(__dirname, relPath), 'utf-8');
  return raw.replace('{{CATEGORY_EXPANSIONS}}', buildCategoryExpansions());
}

// -- Exclusion helpers --

export function filterExcludedSaleItems(
  items: SaleItem[],
  excluded: string[]
): SaleItem[] {
  const expanded = expandExcludedTerms(excluded);
  if (expanded.length === 0) return items;
  return items.filter(
    (it) => !matchExpandedTerm(`${it.item} ${it.category}`, expanded)
  );
}

interface ExcludedViolation {
  day?: string;
  slot?: string;
  mealName: string;
  ingredient?: string;
  term: string;
  sourceCategory?: string;
  // Set on per-member (soft-tier) hits: the member name(s) whose personal
  // excluded list the variant broke. Absent on household-wide (hard-tier) hits.
  forMember?: string;
}

// Match a dish name + its ingredient list against an expanded term set. Shared by
// the household scan and the per-member variant scan (issue #125). Order is the
// name hit first, then ingredients in array order; sourceCategory is omitted
// unless the term came from a category, and forMember is set only for member hits.
function scanNameAndIngredients(
  name: string,
  ingredients: Ingredient[],
  expanded: ExpandedTerm[],
  extra?: { forMember?: string }
): ExcludedViolation[] {
  const hits: ExcludedViolation[] = [];
  const base: Pick<ExcludedViolation, 'mealName' | 'forMember'> =
    extra?.forMember
      ? { mealName: name, forMember: extra.forMember }
      : { mealName: name };
  const nameMatch = matchExpandedTerm(name, expanded);
  if (nameMatch) {
    hits.push({
      ...base,
      term: nameMatch.term,
      ...(nameMatch.sourceCategory
        ? { sourceCategory: nameMatch.sourceCategory }
        : {}),
    });
  }
  for (const ing of ingredients) {
    const m = matchExpandedTerm(ing.name, expanded);
    if (m) {
      hits.push({
        ...base,
        ingredient: ing.name,
        term: m.term,
        ...(m.sourceCategory ? { sourceCategory: m.sourceCategory } : {}),
      });
    }
  }
  return hits;
}

function scanMealForViolations(
  meal: Meal,
  expanded: ExpandedTerm[]
): ExcludedViolation[] {
  const hits = scanNameAndIngredients(meal.name, meal.ingredients, expanded);
  // Per-member variants must still honor the absolute household exclusions — an
  // alternative dish can't smuggle in an ingredient the whole house banned.
  for (const variant of meal.variants ?? []) {
    hits.push(
      ...scanNameAndIngredients(variant.name, variant.ingredients, expanded)
    );
  }
  return hits;
}

export function findExcludedViolations(
  plan: MealPlanResult,
  excluded: string[]
): ExcludedViolation[] {
  const expanded = expandExcludedTerms(excluded);
  if (expanded.length === 0) return [];
  const out: ExcludedViolation[] = [];
  for (const day of plan.weekPlan) {
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const meal = day[slot];
      if (!meal) continue;
      for (const v of scanMealForViolations(meal, expanded)) {
        out.push({ ...v, day: day.day, slot });
      }
    }
  }
  return out;
}

function findMealViolations(
  meal: Meal,
  excluded: string[]
): ExcludedViolation[] {
  const expanded = expandExcludedTerms(excluded);
  if (expanded.length === 0) return [];
  return scanMealForViolations(meal, expanded);
}

// -- Per-member (soft-tier) variant validation (issue #125) --
//
// The household scan above enforces the absolute excluded list against everything,
// variants included. This adds the soft tier: a variant exists for specific members,
// so it must also honor THOSE members' personal "won't eat" lists — otherwise the
// chicken swap added because "Sam won't eat fish" can itself come back with fish.

// A variant is one shared dish for everyone in its forMembers, so it must satisfy
// the *union* of those members' personal excluded lists. Member names are matched
// trimmed + case-insensitively, so a casing drift in the model's forMembers doesn't
// silently skip a member. Variants whose members are all unknown (or who exclude
// nothing) are left alone.
export function findMemberVariantViolations(
  meal: Meal,
  members: HouseholdMember[] | undefined
): ExcludedViolation[] {
  if (!members || members.length === 0) return [];
  const byName = new Map(members.map((m) => [m.name.trim().toLowerCase(), m]));
  const hits: ExcludedViolation[] = [];
  for (const variant of meal.variants ?? []) {
    const known = variant.forMembers
      .map((n) => byName.get(n.trim().toLowerCase()))
      .filter((m): m is HouseholdMember => m !== undefined);
    if (known.length === 0) continue;
    const expanded = expandExcludedTerms(
      known.flatMap((m) => m.excludedIngredients)
    );
    if (expanded.length === 0) continue;
    const forMember = known.map((m) => m.name).join(', ');
    hits.push(
      ...scanNameAndIngredients(variant.name, variant.ingredients, expanded, {
        forMember,
      })
    );
  }
  return hits;
}

export function findMemberViolations(
  plan: MealPlanResult,
  members: HouseholdMember[] | undefined
): ExcludedViolation[] {
  if (!members || members.length === 0) return [];
  const out: ExcludedViolation[] = [];
  for (const day of plan.weekPlan) {
    for (const slot of ['breakfast', 'lunch', 'dinner'] as const) {
      const meal = day[slot];
      if (!meal) continue;
      for (const v of findMemberVariantViolations(meal, members)) {
        out.push({ ...v, day: day.day, slot });
      }
    }
  }
  return out;
}

// Deduped "forbidden terms" labels — a category hint when the term came from one
// (e.g. `shellfish (e.g. "shrimp")`), otherwise the literal term.
function labelTerms(violations: ExcludedViolation[]): string[] {
  const labelMap = new Map<string, string>();
  for (const v of violations) {
    if (v.sourceCategory) {
      const key = v.sourceCategory.toLowerCase();
      if (!labelMap.has(key))
        labelMap.set(key, `${v.sourceCategory} (e.g. "${v.term}")`);
    } else {
      const key = v.term.toLowerCase();
      if (!labelMap.has(key)) labelMap.set(key, v.term);
    }
  }
  return Array.from(labelMap.values());
}

function exampleOf(v: ExcludedViolation): string {
  return v.ingredient
    ? `"${v.ingredient}" in "${v.mealName}"`
    : `"${v.mealName}"`;
}

// The two tiers need different correction wording. Household violations get the
// absolute "remove it everywhere" note. Member violations must stay scoped to the
// offending variant — the ingredient may be fine in the main meal for everyone
// else — so the household phrasing would over-correct. Emit only the part(s) that
// apply; the retry wrapper only calls this when there's at least one violation.
export function formatViolationsForRetry(
  violations: ExcludedViolation[]
): string {
  const household = violations.filter((v) => !v.forMember);
  const member = violations.filter((v) => v.forMember);
  const parts: string[] = [];

  if (household.length > 0) {
    const examples = household.slice(0, 5).map(exampleOf).join('; ');
    parts.push(
      `Your previous response violated the excluded-ingredients constraint. Forbidden terms detected: ${labelTerms(household).join(', ')}. Examples: ${examples}. Regenerate the response with zero occurrences of any excluded term in any meal name or ingredient.`
    );
  }

  if (member.length > 0) {
    // Group by the member(s) a variant serves so each fix stays scoped to that
    // variant rather than banning the term for the whole house.
    const byMember = new Map<string, ExcludedViolation[]>();
    for (const v of member) {
      const key = v.forMember as string;
      const list = byMember.get(key);
      if (list) list.push(v);
      else byMember.set(key, [v]);
    }
    const lines = Array.from(byMember.entries())
      .map(
        ([who, vs]) =>
          `the variant for ${who} must avoid ${labelTerms(vs).join(', ')} (found ${exampleOf(vs[0])})`
      )
      .join('; ');
    parts.push(
      `Some per-member variant dishes contain an ingredient that member won't eat. Fix ONLY the variant — keep the main meal and every other member's portion exactly as they are: ${lines}.`
    );
  }

  return parts.join('\n\n');
}

// Call the model, and if the result contains excluded-ingredient violations,
// retry exactly once with a correction note. The plan and swap paths shared this
// call → check → retry-once → log flow verbatim; only the model call and the
// violation finder differ, so they're passed in. `label` tags the warning.
async function callModelWithExclusionRetry<T>(
  callModel: (extraNote?: string) => Promise<T>,
  findViolations: (result: T) => ExcludedViolation[],
  label: string
): Promise<T> {
  let result = await callModel();
  let violations = findViolations(result);
  if (violations.length > 0) {
    console.warn(
      `${label} had ${violations.length} excluded-ingredient violations; retrying once.`
    );
    result = await callModel(formatViolationsForRetry(violations));
    violations = findViolations(result);
    if (violations.length > 0) {
      console.warn(
        `Retry still produced ${violations.length} violations:`,
        violations.slice(0, 5)
      );
    }
  }
  return result;
}

// -- Schema for structured output --

const ingredientsSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      name: { type: 'string' as const },
      quantity: { type: 'string' as const },
      onSale: { type: 'boolean' as const },
    },
    required: ['name', 'quantity', 'onSale'],
  },
};

const mealSchema = {
  type: 'object' as const,
  properties: {
    name: { type: 'string' as const },
    ingredients: ingredientsSchema,
    activeTime: { type: 'number' as const },
    totalTime: { type: 'number' as const },
    instructions: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
    estimatedCalories: { type: 'number' as const },
    estimatedCost: { type: 'number' as const },
    // Optional per-member alternative dishes (issue #74). Only present when a
    // meal includes something a household member excludes.
    variants: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          forMembers: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
          name: { type: 'string' as const },
          ingredients: ingredientsSchema,
          instructions: {
            type: 'array' as const,
            items: { type: 'string' as const },
          },
        },
        required: ['forMembers', 'name', 'ingredients', 'instructions'],
      },
    },
  },
  required: [
    'name',
    'ingredients',
    'activeTime',
    'totalTime',
    'instructions',
    'estimatedCalories',
    'estimatedCost',
  ],
};

const shoppingListSchema = {
  type: 'array' as const,
  items: {
    type: 'object' as const,
    properties: {
      name: { type: 'string' as const },
      quantity: { type: 'string' as const },
      category: { type: 'string' as const },
      onSale: { type: 'boolean' as const },
      salePrice: { type: ['number', 'null'] as const },
    },
    required: ['name', 'quantity', 'category', 'onSale', 'salePrice'],
  },
};

// -- Response shape guards --

// The model is asked for structured JSON, but a timeout, safety block, or empty
// completion can yield "{}" or a wrong shape. Validate before we dereference so
// callers get a clear error instead of "Cannot read properties of undefined".
export function assertMealPlanShape(value: unknown): MealPlanResult {
  const v = value as Record<string, unknown> | null;
  if (!v || !Array.isArray(v.weekPlan) || !Array.isArray(v.shoppingList)) {
    throw new Error(
      'Model returned an unexpected meal-plan shape (missing weekPlan/shoppingList).'
    );
  }
  return value as MealPlanResult;
}

export function assertSwapShape(value: unknown): {
  meal: Meal;
  shoppingList: ShoppingListItem[];
} {
  const v = value as Record<string, unknown> | null;
  if (
    !v ||
    !v.meal ||
    typeof v.meal !== 'object' ||
    !Array.isArray(v.shoppingList)
  ) {
    throw new Error(
      'Model returned an unexpected swap shape (missing meal/shoppingList).'
    );
  }
  return value as { meal: Meal; shoppingList: ShoppingListItem[] };
}

// -- Prompt building --

// Renders the per-day meal selection as prompt lines, one per planned day in week
// order: "  - Sunday: breakfast, dinner". Days with no meals are omitted. Shared
// by the plan and swap prompts.
export function formatMealsByDay(
  mealsByDay: Partial<Record<DayOfWeek, MealType[]>>
): string {
  return DAYS_OF_WEEK.filter((d) => mealsByDay[d]?.length)
    .map(
      (d) =>
        `  - ${d.charAt(0).toUpperCase() + d.slice(1)}: ${mealsByDay[d]!.join(', ')}`
    )
    .join('\n');
}

// Renders the per-member roster as a prompt block (issue #74). Empty when no
// members are set, so single-profile households read exactly as before. Member
// exclusions are *personal* — they ask for a per-member variant dish, not a
// house-wide ban (that's what the Excluded ingredients line above is for).
export function formatMembers(members: HouseholdMember[] | undefined): string {
  if (!members || members.length === 0) return '';
  const lines = members
    .map((m) => {
      const excluded =
        m.excludedIngredients.length > 0
          ? m.excludedIngredients.join(', ')
          : 'none';
      const dietary =
        m.dietaryRestrictions.length > 0
          ? m.dietaryRestrictions.join(', ')
          : 'none';
      // Only render a cuisine clause when the member set one — its absence is the
      // signal to fall back to the household-wide cuisine list for that member.
      const cuisine =
        m.cuisinePreferences && m.cuisinePreferences.length > 0
          ? `; prefers: ${m.cuisinePreferences.join(', ')}`
          : '';
      // Only render a sizing clause when the member set one — its absence means
      // their variant is sized like the main meal.
      const calories =
        m.caloriesPerMeal && m.caloriesPerMeal > 0
          ? `; target: ~${m.caloriesPerMeal} cal/serving`
          : '';
      const portion =
        m.portionMultiplier && m.portionMultiplier > 0
          ? `; portion: ${m.portionMultiplier}x`
          : '';
      return `  - ${m.name} — won't eat: ${excluded}; dietary: ${dietary}${cuisine}${calories}${portion}`;
    })
    .join('\n');
  return `\n- Household members and their individual dietary needs (personal, not house-wide). When a planned meal includes something a member won't eat, or breaks their dietary restriction, add a "variants" entry to that meal: an alternative dish for that member that avoids it, reusing the meal's shared sides where you can. When a member lists "prefers" cuisines, lean their variant dish toward one of those cuisines — a soft preference like the household cuisine list, not a hard rule; members with no "prefers" fall back to the household cuisines. When a member lists a calorie "target" or a "portion" multiplier, size their variant dish toward it — a soft lean like the cuisine hint, not a hard rule; a member with neither is sized like the main meal. Members with "none" eat the main dish as-is. Put every variant ingredient in the shopping list too.\n${lines}`;
}

// Pure builder for the meal-plan user prompt. Extracted so the constraint wiring
// (e.g. the active-time cap) can be unit-tested without an API key or network.
export function buildMealPlanUserPrompt(
  filteredSaleItems: SaleItem[],
  preferences: UserPreferences
): string {
  const capLine =
    preferences.maxActiveTime && preferences.maxActiveTime > 0
      ? `\n- Maximum active (hands-on) time per meal: ${preferences.maxActiveTime} minutes — every meal's activeTime must be at or under this.`
      : '';
  const notesLine = preferences.notes
    ? `\n- Special instructions (honor these): ${preferences.notes}`
    : '';
  const membersLine = formatMembers(preferences.members);

  return `
## Current Sale Items

${filteredSaleItems.map((i) => `- ${i.item}: $${i.price.toFixed(2)} ${i.unit} [${i.category}]`).join('\n')}

## User Preferences

- Household size: ${preferences.householdSize}
- Dietary preferences: ${preferences.dietaryRestrictions.length > 0 ? preferences.dietaryRestrictions.join(', ') : 'None'}
- Cuisine preferences: ${preferences.cuisinePreferences.join(', ')}
- Excluded ingredients (must NOT appear in any meal): ${preferences.excludedIngredients.length > 0 ? preferences.excludedIngredients.join(', ') : 'None'}
- Pantry staples on hand (do not include in the shopping list): ${preferences.pantryStaples.length > 0 ? preferences.pantryStaples.join(', ') : 'None'}
- Use-it-up ingredients (already on hand — prioritize working these into meals, do not include in the shopping list): ${preferences.useUpIngredients.length > 0 ? preferences.useUpIngredients.join(', ') : 'None'}
- Meals to plan, per day (generate exactly these meals for each day listed, and only these days):
${formatMealsByDay(preferences.mealsByDay)}${membersLine}${capLine}${notesLine}

Generate a meal plan covering exactly the days and meals listed above.
`;
}

// -- Main --

export async function generateMealPlan(
  saleItems: SaleItem[],
  preferences: UserPreferences
): Promise<MealPlanResult> {
  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });

  const systemPrompt = loadPrompt('../prompts/meal-plan-generation.md');

  const filteredSaleItems = filterExcludedSaleItems(
    saleItems,
    preferences.excludedIngredients
  );
  if (filteredSaleItems.length < saleItems.length) {
    console.log(
      `  Filtered ${saleItems.length - filteredSaleItems.length} sale items matching excluded ingredients`
    );
  }

  const userPrompt = buildMealPlanUserPrompt(filteredSaleItems, preferences);

  // The array-items schema is uniform across days, but per-day selection means
  // different days carry different meals. So every meal used on ANY planned day is
  // an optional property (required is just ["day"]); the prompt states exactly
  // which meals each specific day must have.
  const usedMeals = MEAL_TYPES.filter((m) =>
    DAYS_OF_WEEK.some((d) => preferences.mealsByDay[d]?.includes(m))
  );
  const dayProperties: Record<string, unknown> = { day: { type: 'string' } };
  for (const meal of usedMeals) {
    dayProperties[meal] = mealSchema;
  }
  const mealPlanSchema = {
    type: 'object' as const,
    properties: {
      weekPlan: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: dayProperties,
          required: ['day'],
        },
      },
      shoppingList: shoppingListSchema,
    },
    required: ['weekPlan', 'shoppingList'],
  };

  console.log('Generating meal plan...');
  console.log(`  Sale items: ${filteredSaleItems.length}`);
  console.log(`  Household: ${preferences.householdSize}`);
  console.log(`  Cuisines: ${preferences.cuisinePreferences.join(', ')}`);

  const callModel = async (extraNote?: string): Promise<MealPlanResult> => {
    const contents = extraNote ? `${extraNote}\n\n${userPrompt}` : userPrompt;
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseJsonSchema: mealPlanSchema,
        httpOptions: { timeout: 120_000 },
      },
    });
    return assertMealPlanShape(JSON.parse(response.text ?? '{}'));
  };

  const result = await callModelWithExclusionRetry(
    callModel,
    (r) => [
      ...findExcludedViolations(r, preferences.excludedIngredients),
      ...findMemberViolations(r, preferences.members),
    ],
    'Plan'
  ).catch((err: unknown) => {
    throw toReadableGeminiError(err, GEMINI_MODEL);
  });

  console.log(`Generated plan with ${result.weekPlan.length} days`);
  console.log(`Shopping list: ${result.shoppingList.length} items`);

  return result;
}

// -- Per-meal swap --

export async function generateMealSwap(
  currentPlan: MealPlanResult,
  day: string,
  mealType: 'breakfast' | 'lunch' | 'dinner',
  saleItems: SaleItem[],
  preferences: UserPreferences
): Promise<{ meal: Meal; shoppingList: ShoppingListItem[] }> {
  const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });

  const systemPrompt = loadPrompt('../prompts/meal-swap.md');

  const filteredSaleItems = filterExcludedSaleItems(
    saleItems,
    preferences.excludedIngredients
  );
  if (filteredSaleItems.length < saleItems.length) {
    console.log(
      `  Filtered ${saleItems.length - filteredSaleItems.length} sale items matching excluded ingredients`
    );
  }

  const userPrompt = `
## Current Weekly Meal Plan

${JSON.stringify(currentPlan.weekPlan, null, 2)}

## Slot to Replace

- Day: ${day}
- Meal type: ${mealType}

## Current Sale Items

${filteredSaleItems.map((i) => `- ${i.item}: $${i.price.toFixed(2)} ${i.unit} [${i.category}]`).join('\n')}

## User Preferences

- Household size: ${preferences.householdSize}
- Dietary preferences: ${preferences.dietaryRestrictions.length > 0 ? preferences.dietaryRestrictions.join(', ') : 'None'}
- Cuisine preferences: ${preferences.cuisinePreferences.join(', ')}
- Excluded ingredients (must NOT appear in any meal): ${preferences.excludedIngredients.length > 0 ? preferences.excludedIngredients.join(', ') : 'None'}
- Pantry staples on hand (do not include in the shopping list): ${preferences.pantryStaples.length > 0 ? preferences.pantryStaples.join(', ') : 'None'}
- Use-it-up ingredients (already on hand — prioritize working these into meals, do not include in the shopping list): ${preferences.useUpIngredients.length > 0 ? preferences.useUpIngredients.join(', ') : 'None'}
- Meals to plan, per day:
${formatMealsByDay(preferences.mealsByDay)}${formatMembers(preferences.members)}${
    preferences.maxActiveTime && preferences.maxActiveTime > 0
      ? `\n- Maximum active (hands-on) time per meal: ${preferences.maxActiveTime} minutes — the replacement meal's activeTime must be at or under this.`
      : ''
  }${
    preferences.notes
      ? `\n- Special instructions (honor these): ${preferences.notes}`
      : ''
  }

Generate one replacement meal for the slot above, plus the regenerated full-week shopping list.
`;

  const swapSchema = {
    type: 'object' as const,
    properties: {
      meal: mealSchema,
      shoppingList: shoppingListSchema,
    },
    required: ['meal', 'shoppingList'],
  };

  console.log(`Swapping ${day} ${mealType}...`);

  const callModel = async (
    extraNote?: string
  ): Promise<{ meal: Meal; shoppingList: ShoppingListItem[] }> => {
    const contents = extraNote ? `${extraNote}\n\n${userPrompt}` : userPrompt;
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseJsonSchema: swapSchema,
        httpOptions: { timeout: 60_000 },
      },
    });
    return assertSwapShape(JSON.parse(response.text ?? '{}'));
  };

  const parsed = await callModelWithExclusionRetry(
    callModel,
    (r) => [
      ...findMealViolations(r.meal, preferences.excludedIngredients),
      ...findMemberVariantViolations(r.meal, preferences.members),
    ],
    'Swap'
  ).catch((err: unknown) => {
    throw toReadableGeminiError(err, GEMINI_MODEL);
  });

  console.log(`Replacement: ${parsed.meal.name}`);
  console.log(`Shopping list: ${parsed.shoppingList.length} items`);

  return parsed;
}

// -- CLI entry point --

async function main() {
  // Load sale items from extraction output or a provided file
  const itemsPath =
    process.argv[2] || path.join(__dirname, '../output/extraction.json');

  if (!fs.existsSync(itemsPath)) {
    console.error(`Sale items file not found: ${itemsPath}`);
    console.error(
      'Run the circular scanner first: npm run scan -- <image-path>'
    );
    process.exit(1);
  }

  const extraction = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
  const saleItems: SaleItem[] = extraction.items || extraction;

  const result = await generateMealPlan(saleItems, DEFAULT_PREFERENCES);

  // Write output
  const outputPath = path.join(__dirname, '../output/meal-plan.json');
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nOutput written to: ${outputPath}`);

  // Print summary
  console.log('\n--- Weekly Meal Plan ---');
  for (const day of result.weekPlan) {
    console.log(`\n${day.day}:`);
    for (const mealType of ['breakfast', 'lunch', 'dinner'] as const) {
      const meal = day[mealType];
      if (!meal) continue;
      console.log(
        `  ${mealType.charAt(0).toUpperCase() + mealType.slice(1)}: ${meal.name} (~${meal.estimatedCalories} cal, ~$${meal.estimatedCost.toFixed(2)})`
      );
      for (const [i, step] of meal.instructions.entries()) {
        console.log(`    ${i + 1}. ${step}`);
      }
    }
  }

  const saleCount = result.shoppingList.filter((i) => i.onSale).length;
  console.log(
    `\n--- Shopping List: ${result.shoppingList.length} items (${saleCount} on sale) ---`
  );
  for (const item of result.shoppingList) {
    const saleTag = item.onSale ? ` [SALE $${item.salePrice}]` : '';
    console.log(
      `  [${item.category.padEnd(10)}] ${item.name.padEnd(30)} ${item.quantity}${saleTag}`
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
