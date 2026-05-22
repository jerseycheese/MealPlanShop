import * as path from "node:path";
import { pathToFileURL } from "node:url";

const SUITES = [
  "scripts/excludedCategories.test.ts",
  "scripts/mealPlanShape.test.ts",
  "server/circular/flipp.test.ts",
  "server/mergeShoppingList.test.ts",
  "server/prefs-fingerprint.test.ts",
  "src/app/preferenceConflicts.test.ts",
];

async function main() {
  const root = path.resolve(__dirname, "..");
  let failures = 0;
  for (const suite of SUITES) {
    const abs = path.join(root, suite);
    process.stdout.write(`▶ ${suite} ... `);
    try {
      await import(pathToFileURL(abs).href);
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
