import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type {
  Meal,
  MealPlanResult,
  SaleItem,
  ShoppingListItem,
  UserPreferences,
} from "../types";
import {
  EXCLUDED_CATEGORIES,
  expandExcludedTerms,
  matchExpandedTerm,
  type ExpandedTerm,
} from "./excludedCategories";
import { requireEnv, GEMINI_MODEL } from "./env";
export type { SaleItem, UserPreferences };

export const DEFAULT_PANTRY_STAPLES: string[] = [
  "salt",
  "black pepper",
  "olive oil",
  "butter",
  "garlic",
  "onion",
  "flour",
  "sugar",
  "soy sauce",
  "vinegar",
];

export const DEFAULT_PREFERENCES: UserPreferences = {
  householdSize: 2,
  dietaryRestrictions: ["low carb", "low sodium"],
  cuisinePreferences: ["Italian", "Mexican", "Asian", "American"],
  excludedIngredients: [],
  pantryStaples: [...DEFAULT_PANTRY_STAPLES],
  useUpIngredients: [],
  mealsPerDay: ["breakfast", "lunch", "dinner"],
  daysOfWeek: [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ],
};

// -- Prompt loading --

// Single source of truth for category->members. The prompts carry a
// {{CATEGORY_EXPANSIONS}} placeholder so the list lives only in
// EXCLUDED_CATEGORIES, not hand-copied into the .md files.
function buildCategoryExpansions(): string {
  return Object.entries(EXCLUDED_CATEGORIES)
    .map(([category, members]) => `"${category}" covers ${members.join(", ")}`)
    .join("; ");
}

function loadPrompt(relPath: string): string {
  const raw = fs.readFileSync(path.join(__dirname, relPath), "utf-8");
  return raw.replace("{{CATEGORY_EXPANSIONS}}", buildCategoryExpansions());
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
}

function scanMealForViolations(
  meal: Meal,
  expanded: ExpandedTerm[]
): ExcludedViolation[] {
  const hits: ExcludedViolation[] = [];
  const nameMatch = matchExpandedTerm(meal.name, expanded);
  if (nameMatch) {
    hits.push({
      mealName: meal.name,
      term: nameMatch.term,
      ...(nameMatch.sourceCategory ? { sourceCategory: nameMatch.sourceCategory } : {}),
    });
  }
  for (const ing of meal.ingredients) {
    const m = matchExpandedTerm(ing.name, expanded);
    if (m) {
      hits.push({
        mealName: meal.name,
        ingredient: ing.name,
        term: m.term,
        ...(m.sourceCategory ? { sourceCategory: m.sourceCategory } : {}),
      });
    }
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
    for (const slot of ["breakfast", "lunch", "dinner"] as const) {
      const meal = day[slot];
      if (!meal) continue;
      for (const v of scanMealForViolations(meal, expanded)) {
        out.push({ ...v, day: day.day, slot });
      }
    }
  }
  return out;
}

function findMealViolations(meal: Meal, excluded: string[]): ExcludedViolation[] {
  const expanded = expandExcludedTerms(excluded);
  if (expanded.length === 0) return [];
  return scanMealForViolations(meal, expanded);
}

function formatViolationsForRetry(violations: ExcludedViolation[]): string {
  const labelMap = new Map<string, string>();
  for (const v of violations) {
    if (v.sourceCategory) {
      const key = v.sourceCategory.toLowerCase();
      if (!labelMap.has(key)) {
        labelMap.set(key, `${v.sourceCategory} (e.g. "${v.term}")`);
      }
    } else {
      const key = v.term.toLowerCase();
      if (!labelMap.has(key)) labelMap.set(key, v.term);
    }
  }
  const terms = Array.from(labelMap.values());
  const examples = violations
    .slice(0, 5)
    .map((v) =>
      v.ingredient ? `"${v.ingredient}" in "${v.mealName}"` : `"${v.mealName}"`
    )
    .join("; ");
  return `Your previous response violated the excluded-ingredients constraint. Forbidden terms detected: ${terms.join(", ")}. Examples: ${examples}. Regenerate the response with zero occurrences of any excluded term in any meal name or ingredient.`;
}

// Call the model, and if the result contains excluded-ingredient violations,
// retry exactly once with a correction note. The plan and swap paths shared this
// call → check → retry-once → log flow verbatim; only the model call and the
// violation finder differ, so they're passed in. `label` tags the warning.
async function callModelWithExclusionRetry<T>(
  callModel: (extraNote?: string) => Promise<T>,
  findViolations: (result: T) => ExcludedViolation[],
  label: string,
): Promise<T> {
  let result = await callModel();
  let violations = findViolations(result);
  if (violations.length > 0) {
    console.warn(
      `${label} had ${violations.length} excluded-ingredient violations; retrying once.`,
    );
    result = await callModel(formatViolationsForRetry(violations));
    violations = findViolations(result);
    if (violations.length > 0) {
      console.warn(
        `Retry still produced ${violations.length} violations:`,
        violations.slice(0, 5),
      );
    }
  }
  return result;
}

// -- Schema for structured output --

const mealSchema = {
  type: "object" as const,
  properties: {
    name: { type: "string" as const },
    ingredients: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          quantity: { type: "string" as const },
          onSale: { type: "boolean" as const },
        },
        required: ["name", "quantity", "onSale"],
      },
    },
    activeTime: { type: "number" as const },
    totalTime: { type: "number" as const },
    instructions: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    estimatedCalories: { type: "number" as const },
    estimatedCost: { type: "number" as const },
  },
  required: [
    "name",
    "ingredients",
    "activeTime",
    "totalTime",
    "instructions",
    "estimatedCalories",
    "estimatedCost",
  ],
};

const shoppingListSchema = {
  type: "array" as const,
  items: {
    type: "object" as const,
    properties: {
      name: { type: "string" as const },
      quantity: { type: "string" as const },
      category: { type: "string" as const },
      onSale: { type: "boolean" as const },
      salePrice: { type: ["number", "null"] as const },
    },
    required: ["name", "quantity", "category", "onSale", "salePrice"],
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
      "Model returned an unexpected meal-plan shape (missing weekPlan/shoppingList)."
    );
  }
  return value as MealPlanResult;
}

export function assertSwapShape(value: unknown): {
  meal: Meal;
  shoppingList: ShoppingListItem[];
} {
  const v = value as Record<string, unknown> | null;
  if (!v || !v.meal || typeof v.meal !== "object" || !Array.isArray(v.shoppingList)) {
    throw new Error(
      "Model returned an unexpected swap shape (missing meal/shoppingList)."
    );
  }
  return value as { meal: Meal; shoppingList: ShoppingListItem[] };
}

// -- Prompt building --

// Pure builder for the meal-plan user prompt. Extracted so the constraint wiring
// (e.g. the active-time cap) can be unit-tested without an API key or network.
export function buildMealPlanUserPrompt(
  filteredSaleItems: SaleItem[],
  preferences: UserPreferences
): string {
  const capLine =
    preferences.maxActiveTime && preferences.maxActiveTime > 0
      ? `\n- Maximum active (hands-on) time per meal: ${preferences.maxActiveTime} minutes — every meal's activeTime must be at or under this.`
      : "";

  return `
## Current Sale Items

${filteredSaleItems.map((i) => `- ${i.item}: $${i.price.toFixed(2)} ${i.unit} [${i.category}]`).join("\n")}

## User Preferences

- Household size: ${preferences.householdSize}
- Dietary preferences: ${preferences.dietaryRestrictions.length > 0 ? preferences.dietaryRestrictions.join(", ") : "None"}
- Cuisine preferences: ${preferences.cuisinePreferences.join(", ")}
- Excluded ingredients (must NOT appear in any meal): ${preferences.excludedIngredients.length > 0 ? preferences.excludedIngredients.join(", ") : "None"}
- Pantry staples on hand (do not include in the shopping list): ${preferences.pantryStaples.length > 0 ? preferences.pantryStaples.join(", ") : "None"}
- Use-it-up ingredients (already on hand — prioritize working these into meals, do not include in the shopping list): ${preferences.useUpIngredients.length > 0 ? preferences.useUpIngredients.join(", ") : "None"}
- Meals to plan: ${preferences.mealsPerDay.join(", ")}
- Days to plan: ${preferences.daysOfWeek.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}${capLine}

Generate a meal plan covering the selected days.
`;
}

// -- Main --

export async function generateMealPlan(
  saleItems: SaleItem[],
  preferences: UserPreferences
): Promise<MealPlanResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const systemPrompt = loadPrompt("../prompts/meal-plan-generation.md");

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

  const validMeals = ["breakfast", "lunch", "dinner"];
  const requestedMeals = preferences.mealsPerDay.filter((m) =>
    validMeals.includes(m)
  );
  const dayProperties: Record<string, unknown> = { day: { type: "string" } };
  for (const meal of requestedMeals) {
    dayProperties[meal] = mealSchema;
  }
  const mealPlanSchema = {
    type: "object" as const,
    properties: {
      weekPlan: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: dayProperties,
          required: ["day", ...requestedMeals],
        },
      },
      shoppingList: shoppingListSchema,
    },
    required: ["weekPlan", "shoppingList"],
  };

  console.log("Generating meal plan...");
  console.log(`  Sale items: ${filteredSaleItems.length}`);
  console.log(`  Household: ${preferences.householdSize}`);
  console.log(`  Cuisines: ${preferences.cuisinePreferences.join(", ")}`);

  const callModel = async (extraNote?: string): Promise<MealPlanResult> => {
    const contents = extraNote ? `${extraNote}\n\n${userPrompt}` : userPrompt;
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseJsonSchema: mealPlanSchema,
        httpOptions: { timeout: 120_000 },
      },
    });
    return assertMealPlanShape(JSON.parse(response.text ?? "{}"));
  };

  const result = await callModelWithExclusionRetry(
    callModel,
    (r) => findExcludedViolations(r, preferences.excludedIngredients),
    "Plan",
  );

  console.log(`Generated plan with ${result.weekPlan.length} days`);
  console.log(`Shopping list: ${result.shoppingList.length} items`);

  return result;
}

// -- Per-meal swap --

export async function generateMealSwap(
  currentPlan: MealPlanResult,
  day: string,
  mealType: "breakfast" | "lunch" | "dinner",
  saleItems: SaleItem[],
  preferences: UserPreferences
): Promise<{ meal: Meal; shoppingList: ShoppingListItem[] }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const systemPrompt = loadPrompt("../prompts/meal-swap.md");

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

${filteredSaleItems.map((i) => `- ${i.item}: $${i.price.toFixed(2)} ${i.unit} [${i.category}]`).join("\n")}

## User Preferences

- Household size: ${preferences.householdSize}
- Dietary preferences: ${preferences.dietaryRestrictions.length > 0 ? preferences.dietaryRestrictions.join(", ") : "None"}
- Cuisine preferences: ${preferences.cuisinePreferences.join(", ")}
- Excluded ingredients (must NOT appear in any meal): ${preferences.excludedIngredients.length > 0 ? preferences.excludedIngredients.join(", ") : "None"}
- Pantry staples on hand (do not include in the shopping list): ${preferences.pantryStaples.length > 0 ? preferences.pantryStaples.join(", ") : "None"}
- Use-it-up ingredients (already on hand — prioritize working these into meals, do not include in the shopping list): ${preferences.useUpIngredients.length > 0 ? preferences.useUpIngredients.join(", ") : "None"}
- Meals to plan: ${preferences.mealsPerDay.join(", ")}
- Days to plan: ${preferences.daysOfWeek.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(", ")}${
    preferences.maxActiveTime && preferences.maxActiveTime > 0
      ? `\n- Maximum active (hands-on) time per meal: ${preferences.maxActiveTime} minutes — the replacement meal's activeTime must be at or under this.`
      : ""
  }

Generate one replacement meal for the slot above, plus the regenerated full-week shopping list.
`;

  const swapSchema = {
    type: "object" as const,
    properties: {
      meal: mealSchema,
      shoppingList: shoppingListSchema,
    },
    required: ["meal", "shoppingList"],
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
        responseMimeType: "application/json",
        responseJsonSchema: swapSchema,
        httpOptions: { timeout: 60_000 },
      },
    });
    return assertSwapShape(JSON.parse(response.text ?? "{}"));
  };

  const parsed = await callModelWithExclusionRetry(
    callModel,
    (r) => findMealViolations(r.meal, preferences.excludedIngredients),
    "Swap",
  );

  console.log(`Replacement: ${parsed.meal.name}`);
  console.log(`Shopping list: ${parsed.shoppingList.length} items`);

  return parsed;
}

// -- CLI entry point --

async function main() {
  requireEnv("GEMINI_API_KEY");

  // Load sale items from extraction output or a provided file
  const itemsPath =
    process.argv[2] || path.join(__dirname, "../output/extraction.json");

  if (!fs.existsSync(itemsPath)) {
    console.error(`Sale items file not found: ${itemsPath}`);
    console.error(
      "Run the circular scanner first: npm run scan -- <image-path>"
    );
    process.exit(1);
  }

  const extraction = JSON.parse(fs.readFileSync(itemsPath, "utf-8"));
  const saleItems: SaleItem[] = extraction.items || extraction;

  const result = await generateMealPlan(saleItems, DEFAULT_PREFERENCES);

  // Write output
  const outputPath = path.join(__dirname, "../output/meal-plan.json");
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nOutput written to: ${outputPath}`);

  // Print summary
  console.log("\n--- Weekly Meal Plan ---");
  for (const day of result.weekPlan) {
    console.log(`\n${day.day}:`);
    for (const mealType of ["breakfast", "lunch", "dinner"] as const) {
      const meal = day[mealType];
      if (!meal) continue;
      console.log(`  ${mealType.charAt(0).toUpperCase() + mealType.slice(1)}: ${meal.name} (~${meal.estimatedCalories} cal, ~$${meal.estimatedCost.toFixed(2)})`);
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
    const saleTag = item.onSale ? ` [SALE $${item.salePrice}]` : "";
    console.log(
      `  [${item.category.padEnd(10)}] ${item.name.padEnd(30)} ${item.quantity}${saleTag}`
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
