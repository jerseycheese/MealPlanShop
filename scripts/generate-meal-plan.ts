import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI } from "@google/genai";
import type { MealPlanResult } from "../types";

// -- Types (script-local) --

interface SaleItem {
  item: string;
  price: number;
  unit: string;
  category: string;
  priceNote?: string;
}

interface UserPreferences {
  householdSize: number;
  dietaryRestrictions: string[];
  cuisinePreferences: string[];
  mealsPerDay: string[];
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
    prepTime: { type: "number" as const },
    cookTime: { type: "number" as const },
    instructions: {
      type: "array" as const,
      items: { type: "string" as const },
    },
    estimatedCalories: { type: "number" as const },
  },
  required: [
    "name",
    "ingredients",
    "prepTime",
    "cookTime",
    "instructions",
    "estimatedCalories",
  ],
};

const mealPlanSchema = {
  type: "object" as const,
  properties: {
    weekPlan: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          day: { type: "string" as const },
          breakfast: mealSchema,
          lunch: mealSchema,
          dinner: mealSchema,
        },
        required: ["day", "breakfast", "lunch", "dinner"],
      },
    },
    shoppingList: {
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
    },
  },
  required: ["weekPlan", "shoppingList"],
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

  const userPrompt = `
## Current Sale Items

${saleItems.map((i) => `- ${i.item}: $${i.price.toFixed(2)} ${i.unit} [${i.category}]`).join("\n")}

## User Preferences

- Household size: ${preferences.householdSize}
- Dietary restrictions: ${preferences.dietaryRestrictions.length > 0 ? preferences.dietaryRestrictions.join(", ") : "None"}
- Cuisine preferences: ${preferences.cuisinePreferences.join(", ")}
- Meals to plan: ${preferences.mealsPerDay.join(", ")}

Generate a weekly meal plan for Monday through Sunday.
`;

  console.log("Generating meal plan...");
  console.log(`  Sale items: ${saleItems.length}`);
  console.log(`  Household: ${preferences.householdSize}`);
  console.log(`  Cuisines: ${preferences.cuisinePreferences.join(", ")}`);

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      responseJsonSchema: mealPlanSchema,
    },
  });

  const result: MealPlanResult = JSON.parse(response.text ?? "{}");

  console.log(`Generated plan with ${result.weekPlan.length} days`);
  console.log(`Shopping list: ${result.shoppingList.length} items`);

  return result;
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

  // Default preferences for testing — customize as needed
  const preferences: UserPreferences = {
    householdSize: 2,
    dietaryRestrictions: ["low carb", "low sodium"],
    cuisinePreferences: ["Italian", "Mexican", "Asian", "American"],
    mealsPerDay: ["breakfast", "lunch", "dinner"],
  };

  const result = await generateMealPlan(saleItems, preferences);

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
      console.log(`  ${mealType.charAt(0).toUpperCase() + mealType.slice(1)}: ${meal.name} (~${meal.estimatedCalories} cal)`);
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

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
