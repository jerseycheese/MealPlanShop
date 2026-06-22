import * as assert from 'node:assert/strict';
import { scanAndPlan } from './scanAndPlan';
import type {
  ExtractionResult,
  MealPlanResult,
  SaleItem,
  UserPreferences,
} from '../types';

let passed = 0;
let total = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  total++;
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
  }
}

const PREFS = {} as UserPreferences;
const PLAN: MealPlanResult = { weekPlan: [], shoppingList: [] };

function saleItem(item: string): SaleItem {
  return { item, price: 1.99, unit: 'each', category: 'other' };
}

function extractionWith(
  items: SaleItem[],
  storeName: string | null = 'Test Store'
): ExtractionResult {
  return { items, storeName, validThrough: null };
}

export async function run(): Promise<void> {
  // The core of #123: a failed plan must commit nothing, so the prior extraction
  // and plan survive intact instead of stranding a new circular next to an old plan.
  await test('generation failure commits nothing', async () => {
    let committed = 0;
    await assert.rejects(
      scanAndPlan(extractionWith([saleItem('milk')]), {
        loadPreferences: () => PREFS,
        generate: async () => {
          throw new Error('Gemini boom');
        },
        commit: () => {
          committed += 1;
        },
      }),
      /Gemini boom/
    );
    assert.equal(committed, 0, 'commit must not run when generation fails');
  });

  // On success, the extraction and the finished plan are committed together, once.
  await test('success commits extraction and plan together once', async () => {
    const commits: Array<{ ext: ExtractionResult; plan: MealPlanResult }> = [];
    const ext = extractionWith([saleItem('chicken')]);
    const result = await scanAndPlan(ext, {
      loadPreferences: () => PREFS,
      generate: async () => PLAN,
      commit: (e, p) => commits.push({ ext: e, plan: p }),
    });
    assert.equal(commits.length, 1, 'commit runs exactly once');
    assert.equal(commits[0].ext, ext, 'the extraction is committed');
    assert.equal(commits[0].plan, PLAN, 'the plan is committed');
    assert.deepEqual(result, { itemCount: 1, storeName: 'Test Store' });
  });

  // The decorated (finalized) plan is what gets committed, not the raw model output.
  await test('the decorated plan is what gets committed', async () => {
    const commits: MealPlanResult[] = [];
    const decorated: MealPlanResult = {
      weekPlan: [],
      shoppingList: [],
      planId: 'abc',
    };
    await scanAndPlan(extractionWith([saleItem('rice')]), {
      loadPreferences: () => PREFS,
      generate: async () => PLAN,
      decorate: () => decorated,
      commit: (_ext, plan) => commits.push(plan),
    });
    assert.equal(commits[0], decorated);
  });

  // Empty extraction without allowEmpty is rejected before generating or committing.
  await test('empty extraction is rejected before generating', async () => {
    let generated = 0;
    let committed = 0;
    await assert.rejects(
      scanAndPlan(extractionWith([]), {
        loadPreferences: () => PREFS,
        generate: async () => {
          generated += 1;
          return PLAN;
        },
        commit: () => {
          committed += 1;
        },
      }),
      (err: unknown) => (err as { statusCode?: number }).statusCode === 422
    );
    assert.equal(generated, 0, 'no generation on an empty circular');
    assert.equal(committed, 0, 'no commit on an empty circular');
  });

  // allowEmpty (the no-circular path, e.g. Trader Joe's) plans from preferences alone.
  await test('allowEmpty lets an empty circular plan from preferences', async () => {
    let committed = 0;
    const result = await scanAndPlan(
      extractionWith([], "Trader Joe's"),
      {
        loadPreferences: () => PREFS,
        generate: async () => PLAN,
        commit: () => {
          committed += 1;
        },
      },
      { allowEmpty: true }
    );
    assert.equal(committed, 1, 'allowEmpty commits');
    assert.deepEqual(result, { itemCount: 0, storeName: "Trader Joe's" });
  });

  console.log(`scanAndPlan: ${passed}/${total} passed`);
  if (failures.length > 0) {
    throw new Error(
      `scanAndPlan: ${failures.length} test(s) failed: ${failures.join(', ')}`
    );
  }
}
