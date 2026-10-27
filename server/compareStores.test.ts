import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compareStores,
  eligibleFlyers,
  readComparedStore,
  COMPARE_FILENAME,
  MIN_FLYER_ITEMS,
} from './compareStores';
import type { FlippMerchant } from './circular/sources/flipp';
import type {
  ExtractionResult,
  MealPlanResult,
  SaleItem,
  UserPreferences,
} from '../types';

let total = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  total++;
  try {
    await fn();
  } catch (err) {
    failures.push(name);
    console.error(`  x ${name}:`, err instanceof Error ? err.message : err);
  }
}

function merchant(flyerId: number, name: string, daysLeft = 3): FlippMerchant {
  return {
    flyerId,
    merchantId: flyerId,
    name,
    validFrom: '2026-10-20',
    validTo: '2026-10-30',
    daysLeft,
    logoUrl: null,
  };
}

function items(n: number): SaleItem[] {
  return Array.from({ length: n }, (_, i) => ({
    item: `item ${i}`,
    price: 1,
    unit: 'each',
    category: 'other',
  }));
}

function planCosting(cost: number): MealPlanResult {
  return {
    weekPlan: [
      {
        day: 'monday',
        dinner: {
          name: 'Dinner',
          ingredients: [],
          activeTime: 10,
          totalTime: 20,
          instructions: [],
          estimatedCalories: 500,
          estimatedCost: cost,
        },
      },
    ],
    shoppingList: [],
  };
}

export async function run(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-stores-'));
  try {
    // Fake Gemini: price each store's plan by the store's name.
    const costs: Record<string, number> = {
      Kroger: 35.5,
      ALDI: 17.5,
      Lidl: 25,
    };
    const flyerSizes: Record<string, number> = {
      Kroger: 104,
      ALDI: 56,
      Lidl: 61,
      Walmart: 8,
    };
    const merchants = [
      merchant(1, 'Kroger'),
      merchant(2, 'ALDI'),
      merchant(3, 'Walmart'),
      merchant(4, 'Lidl'),
    ];
    const deps = {
      loadPreferences: () => ({}) as UserPreferences,
      getExtraction: async (m: FlippMerchant): Promise<ExtractionResult> => ({
        items: items(flyerSizes[m.name]),
        storeName: m.name,
        validThrough: m.validTo,
      }),
      generate: async (_items: SaleItem[], _prefs: UserPreferences) => {
        // generate doesn't receive the store, so key off flyer size instead.
        const name = Object.keys(flyerSizes).find(
          (k) => flyerSizes[k] === _items.length
        )!;
        return planCosting(costs[name]);
      },
    };

    await test('ranks stores cheapest first and skips thin flyers', async () => {
      const result = await compareStores(merchants, dir, deps);
      assert.deepEqual(
        result.ranked.map((s) => [s.storeName, s.total]),
        [
          ['ALDI', 17.5],
          ['Lidl', 25],
          ['Kroger', 35.5],
        ]
      );
      assert.equal(result.skipped.length, 1);
      assert.equal(result.skipped[0].storeName, 'Walmart');
      assert.ok(flyerSizes.Walmart < MIN_FLYER_ITEMS);
    });

    await test('never writes the active plan or extraction', async () => {
      const planPath = path.join(dir, 'meal-plan.json');
      const extractionPath = path.join(dir, 'extraction.json');
      fs.writeFileSync(planPath, '{"active":"plan"}');
      fs.writeFileSync(extractionPath, '{"active":"extraction"}');
      await compareStores(merchants, dir, deps);
      assert.equal(fs.readFileSync(planPath, 'utf8'), '{"active":"plan"}');
      assert.equal(
        fs.readFileSync(extractionPath, 'utf8'),
        '{"active":"extraction"}'
      );
      assert.ok(fs.existsSync(path.join(dir, COMPARE_FILENAME)));
      const picked = readComparedStore(dir, 2);
      assert.equal(picked?.storeName, 'ALDI');
      assert.equal(picked?.extraction.items.length, 56);
    });

    await test('rethrows when every store fails', async () => {
      await assert.rejects(
        compareStores([merchant(1, 'Kroger')], dir, {
          ...deps,
          generate: async () => {
            throw new Error('No Gemini API key set.');
          },
        }),
        /No Gemini API key/
      );
    });

    await test('default set drops flyers ending today and warehouse clubs', () => {
      const list = [
        merchant(1, 'Kroger'),
        merchant(2, 'Costco'),
        merchant(3, 'ALDI', 0),
      ];
      assert.deepEqual(
        eligibleFlyers(list).map((m) => m.name),
        ['Kroger']
      );
      assert.equal(eligibleFlyers(list, { includeAll: true }).length, 3);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length}/${total} compareStores tests failed`);
  }
}
