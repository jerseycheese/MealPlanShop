import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { scanCircular } from "./scan-circular";
import { generateMealPlan } from "./generate-meal-plan";

async function main() {
  const imagePath = process.argv[2];

  if (!imagePath) {
    console.error(
      "Usage: npm run pipeline -- <path-to-circular-image>"
    );
    console.error(
      "Example: npm run pipeline -- samples/weekly-circular.jpg"
    );
    process.exit(1);
  }

  if (!fs.existsSync(imagePath)) {
    console.error(`File not found: ${imagePath}`);
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env file");
    process.exit(1);
  }

  console.log("=== MealPlanShop Pipeline ===\n");

  // Step 1: Extract sale items from circular photo
  console.log("--- Step 1: Scanning circular ---");
  const extraction = await scanCircular(imagePath);
  console.log("");

  if (extraction.items.length === 0) {
    console.error("No sale items extracted. Check the image quality.");
    process.exit(1);
  }

  // Step 2: Generate meal plan from sale items
  console.log("--- Step 2: Generating meal plan ---");
  const preferences = {
    householdSize: 2,
    dietaryRestrictions: [],
    cuisinePreferences: ["Italian", "Mexican", "Asian", "American"],
    mealsPerDay: ["breakfast", "lunch", "dinner"],
  };

  const mealPlan = await generateMealPlan(extraction.items, preferences);
  console.log("");

  // Write combined output
  const output = {
    circular: {
      storeName: extraction.storeName,
      validThrough: extraction.validThrough,
      saleItemCount: extraction.items.length,
    },
    saleItems: extraction.items,
    preferences,
    mealPlan: mealPlan.weekPlan,
    shoppingList: mealPlan.shoppingList,
  };

  const outputPath = path.join(__dirname, "../output/full-pipeline.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`Full output written to: ${outputPath}`);

  // Print final summary
  console.log("\n=== Pipeline Complete ===");
  console.log(`  Sale items found: ${extraction.items.length}`);
  console.log(`  Days planned: ${mealPlan.weekPlan.length}`);
  console.log(`  Shopping list items: ${mealPlan.shoppingList.length}`);

  const saleCount = mealPlan.shoppingList.filter((i) => i.onSale).length;
  const totalItems = mealPlan.shoppingList.length;
  const salePct = totalItems > 0 ? ((saleCount / totalItems) * 100).toFixed(0) : "0";
  console.log(`  Items on sale: ${saleCount}/${totalItems} (${salePct}%)`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
