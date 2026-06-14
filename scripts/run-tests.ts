import * as path from "node:path";
import { pathToFileURL } from "node:url";

const SUITES = [
  "scripts/excludedCategories.test.ts",
  "scripts/mealPlanShape.test.ts",
  "scripts/buildMealPlanUserPrompt.test.ts",
  "server/circular/flipp.test.ts",
  "server/circular/categorize.test.ts",
  "server/mergeShoppingList.test.ts",
  "server/moveMeal.test.ts",
  "server/prefs-fingerprint.test.ts",
  "server/validatePreferences.test.ts",
  "server/dataDir.test.ts",
  "server/secrets.test.ts",
  "server/geminiErrors.test.ts",
  "server/poppler.test.ts",
  "server/lib/jsonStore.test.ts",
  "src/app/preferenceConflicts.test.ts",
  "src/app/formatValidThrough.test.ts",
  "src/app/formatDateRange.test.ts",
  "src/app/formatShoppingListText.test.ts",
];

async function main() {
  const root = path.resolve(__dirname, "..");
  let failures = 0;
  for (const suite of SUITES) {
    const abs = path.join(root, suite);
    process.stdout.write(`▶ ${suite} ... `);
    try {
      const mod = await import(pathToFileURL(abs).href);
      // Sync suites run their assertions at import time. Async suites export a
      // `run()` the harness awaits, since top-level await isn't available here.
      if (typeof (mod as { run?: unknown }).run === "function") {
        await (mod as { run: () => Promise<void> }).run();
      }
      process.stdout.write("ok\n");
    } catch (err) {
      failures += 1;
      process.stdout.write("FAIL\n");
      console.error(err);
    }
  }
  if (failures > 0) {
    console.error(`\n${failures} of ${SUITES.length} suite(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${SUITES.length} suites passed.`);
}

main();
