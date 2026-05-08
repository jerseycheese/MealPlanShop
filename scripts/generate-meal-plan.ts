import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type {
  Meal,
  MealPlanResult,
  ShoppingListItem,
  UserPreferences,
} from "../types";
export type { UserPreferences };

// -- Types (script-local) --

export interface SaleItem {
  item: string;
  price: number;
  unit: string;
  category: string;
  priceNote?: string;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  householdSize: 2,
  dietaryRestrictions: ["low carb", "low sodium"],
  cuisinePreferences: ["Italian", "Mexican", "Asian", "American"],
  excludedIngredients: [],
  pantryStaples: [],
  mealsPerDay: ["breakfast", "lunch", "dinner"],
};

// -- Exclusion helpers --

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedExcluded(terms: string[]): string[] {
  return terms.map((t) => t.trim()).filter(Boolean);
}

function matchExcludedTerm(text: string, excluded: string[]): string | null {
  for (const term of excluded) {
    // Unicode-aware word boundary so terms with accents (acai, jalapeno)
    // still match. JavaScript's \b is ASCII-only and would fail on those.
    const re = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegex(term)}(?![\\p{L}\\p{N}_])`,
      "iu"
    );
    if (re.test(text)) return term;
  }
  return null;
}

export function filterExcludedSaleItems(
  items: SaleItem[],
  excluded: string[]
): SaleItem[] {
  const terms = normalizedExcluded(excluded);
  if (terms.length === 0) return items;
  return items.filter(
    (it) => !matchExcludedTerm(`${it.item} ${it.category}`, terms)
  );
}

interface ExcludedViolation {
  day?: string;
  slot?: string;
  mealName: string;
  ingredient?: string;
  term: string;
}

function scanMealForViolations(meal: Meal, excluded: string[]): ExcludedViolation[] {
  const hits: ExcludedViolation[] = [];
  const nameTerm = matchExcludedTerm(meal.name, excluded);
  if (nameTerm) hits.push({ mealName: meal.name, term: nameTerm });
  for (const ing of meal.ingredients) {
    const t = matchExcludedTerm(ing.name, excluded);
    if (t) hits.push({ mealName: meal.name, ingredient: ing.name, term: t });
  }
  return hits;
}

export function findExcludedViolations(
  plan: MealPlanResult,
  excluded: string[]
): ExcludedViolation[] {
  const terms = normalizedExcluded(excluded);
  if (terms.length === 0) return [];
  const out: ExcludedViolation[] = [];
  for (const day of plan.weekPlan) {
    for (const slot of ["breakfast", "lunch", "dinner"] as const) {
      const meal = day[slot];
      if (!meal) continue;
      for (const v of scanMealForViolations(meal, terms)) {
        out.push({ ...v, day: day.day, slot });
      }
    }
  }
  return out;
}

function findMealViolations(meal: Meal, excluded: string[]): ExcludedViolation[] {
  const terms = normalizedExcluded(excluded);
  if (terms.length === 0) return [];
  return scanMealForViolations(meal, terms);
}

function formatViolationsForRetry(violations: ExcludedViolation[]): string {
  const terms = Array.from(new Set(violations.map((v) => v.term)));
  const examples = violations
    .slice(0, 5)
    .map((v) =>
      v.ingredient ? `"${v.ingredient}" in "${v.mealName}"` : `"${v.mealName}"`
    )
    .join("; ");
  return `Your previous response violated the excluded-ingredients constraint. Forbidden terms detected: ${terms.join(", ")}. Examples: ${examples}. Regenerate the response with zero occurrences of any excluded term in any meal name or ingredient.`;
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

// -- Main --

export async function generateMealPlan(
  saleItems: SaleItem[],
  preferences: UserPreferences
): Promise<MealPlanResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const systemPrompt = fs.readFileSync(
    path.join(__dirname, "../prompts/meal-plan-generation.md"),
    "utf-8"
  );

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
## Current Sale Items

${filteredSaleItems.map((i) => `- ${i.item}: $${i.price.toFixed(2)} ${i.unit} [${i.category}]`).join("\n")}

## User Preferences

- Household size: ${preferences.householdSize}
- Dietary restrictions: ${preferences.dietaryRestrictions.length > 0 ? preferences.dietaryRestrictions.join(", ") : "None"}
- Cuisine preferences: ${preferences.cuisinePreferences.join(", ")}
- Excluded ingredients (must NOT appear in any meal): ${preferences.excludedIngredients.length > 0 ? preferences.excludedIngredients.join(", ") : "None"}
- Pantry staples on hand (do not include in the shopping list): ${preferences.pantryStaples.length > 0 ? preferences.pantryStaples.join(", ") : "None"}
- Meals to plan: ${preferences.mealsPerDay.join(", ")}

Generate a weekly meal plan for Monday through Sunday.
`;

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
      model: "gemini-3-flash-preview",
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseJsonSchema: mealPlanSchema,
      },
    });
    return JSON.parse(response.text ?? "{}") as MealPlanResult;
  };

  let result = await callModel();
  let violations = findExcludedViolations(result, preferences.excludedIngredients);
  if (violations.length > 0) {
    console.warn(
      `Plan had ${violations.length} excluded-ingredient violations; retrying once.`
    );
    result = await callModel(formatViolationsForRetry(violations));
    violations = findExcludedViolations(result, preferences.excludedIngredients);
    if (violations.length > 0) {
      console.warn(
        `Retry still produced ${violations.length} violations:`,
        violations.slice(0, 5)
      );
    }
  }

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

  const systemPrompt = fs.readFileSync(
    path.join(__dirname, "../prompts/meal-swap.md"),
    "utf-8"
  );

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
- Dietary restrictions: ${preferences.dietaryRestrictions.length > 0 ? preferences.dietaryRestrictions.join(", ") : "None"}
- Cuisine preferences: ${preferences.cuisinePreferences.join(", ")}
- Excluded ingredients (must NOT appear in any meal): ${preferences.excludedIngredients.length > 0 ? preferences.excludedIngredients.join(", ") : "None"}
- Pantry staples on hand (do not include in the shopping list): ${preferences.pantryStaples.length > 0 ? preferences.pantryStaples.join(", ") : "None"}
- Meals to plan: ${preferences.mealsPerDay.join(", ")}

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
      model: "gemini-3-flash-preview",
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseJsonSchema: swapSchema,
      },
    });
    return JSON.parse(response.text ?? "{}") as {
      meal: Meal;
      shoppingList: ShoppingListItem[];
    };
  };

  let parsed = await callModel();
  let violations = findMealViolations(parsed.meal, preferences.excludedIngredients);
  if (violations.length > 0) {
    console.warn(
      `Swap had ${violations.length} excluded-ingredient violations; retrying once.`
    );
    parsed = await callModel(formatViolationsForRetry(violations));
    violations = findMealViolations(parsed.meal, preferences.excludedIngredients);
    if (violations.length > 0) {
      console.warn(
        `Retry still produced ${violations.length} violations:`,
        violations.slice(0, 5)
      );
    }
  }

  console.log(`Replacement: ${parsed.meal.name}`);
  console.log(`Shopping list: ${parsed.shoppingList.length} items`);

  return parsed;
}

// -- CLI entry point --

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env file");
    process.exit(1);
  }

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
