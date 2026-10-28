import * as fs from 'node:fs';
import * as path from 'node:path';
import { MEAL_TYPES } from '../types';
import type {
  ExtractionResult,
  MealPlanResult,
  SaleItem,
  UserPreferences,
} from '../types';
import type { FlippMerchant } from './circular/sources/flipp';
import { readJsonOrNull, writeJsonAtomic } from './lib/jsonStore';

// "Which nearby store makes this week cheapest" (#133). Plans one week per store
// and ranks them by estimated cost. Results go to their own file so comparing
// never touches the active extraction.json / meal-plan.json; picking a store
// later commits that store's saved extraction + plan.

export const COMPARE_FILENAME = 'store-compare.json';

// Thin flyers rank as falsely cheap: estimatedCost only counts what Gemini can
// see on sale, so an 8-item flyer comes back with $0 breakfasts. Below this
// size a store is listed as skipped instead of ranked.
export const MIN_FLYER_ITEMS = 20;

const WAREHOUSE_CLUBS = new Set(['Costco', "Sam's Club"]);

// Default compare set: drop flyers ending today (a plan you can't shop all
// week) and warehouse clubs (bulk sizes skew the totals). includeAll keeps them.
export function eligibleFlyers(
  merchants: FlippMerchant[],
  opts: { includeAll?: boolean } = {}
): FlippMerchant[] {
  if (opts.includeAll) return merchants;
  return merchants.filter(
    (m) => m.daysLeft > 0 && !WAREHOUSE_CLUBS.has(m.name)
  );
}

export function planTotal(plan: MealPlanResult): number {
  let total = 0;
  for (const day of plan.weekPlan) {
    for (const t of MEAL_TYPES) total += day[t]?.estimatedCost ?? 0;
  }
  return Math.round(total * 100) / 100;
}

export interface ComparedStore {
  flyerId: number;
  merchantId: string | number | null;
  storeName: string;
  total: number;
  saleItemsUsed: number;
  listItems: number;
  mealCount: number;
  flyerItems: number;
  extraction: ExtractionResult;
  plan: MealPlanResult;
}

export interface SkippedStore {
  flyerId: number;
  storeName: string;
  reason: string;
}

export interface StoreComparison {
  comparedAt: string;
  ranked: ComparedStore[];
  skipped: SkippedStore[];
}

export interface CompareStoresDeps {
  getExtraction: (m: FlippMerchant) => Promise<ExtractionResult>;
  loadPreferences: () => UserPreferences;
  generate: (
    items: SaleItem[],
    prefs: UserPreferences
  ) => Promise<MealPlanResult>;
  decorate?: (
    plan: MealPlanResult,
    extraction: ExtractionResult,
    prefs: UserPreferences
  ) => MealPlanResult;
  onStore?: (m: FlippMerchant, index: number, total: number) => void;
}

// Serial on purpose: Flipp is an unofficial endpoint (one fetch per flyer,
// never parallel), and Gemini calls are slow enough that order doesn't matter.
// Writes only <outputDir>/store-compare.json.
export async function compareStores(
  merchants: FlippMerchant[],
  outputDir: string,
  deps: CompareStoresDeps
): Promise<StoreComparison> {
  const prefs = deps.loadPreferences();
  const ranked: ComparedStore[] = [];
  const skipped: SkippedStore[] = [];
  let firstError: unknown = null;

  for (let i = 0; i < merchants.length; i++) {
    const m = merchants[i];
    deps.onStore?.(m, i + 1, merchants.length);
    try {
      const extraction = await deps.getExtraction(m);
      if (extraction.items.length < MIN_FLYER_ITEMS) {
        skipped.push({
          flyerId: m.flyerId,
          storeName: m.name,
          reason: `Only ${extraction.items.length} sale items, too few to price a week`,
        });
        continue;
      }
      const raw = await deps.generate(extraction.items, prefs);
      const plan = deps.decorate ? deps.decorate(raw, extraction, prefs) : raw;
      ranked.push({
        flyerId: m.flyerId,
        merchantId: m.merchantId,
        storeName: m.name,
        total: planTotal(plan),
        saleItemsUsed: plan.shoppingList.filter((s) => s.onSale).length,
        listItems: plan.shoppingList.length,
        mealCount: plan.weekPlan.reduce(
          (n, d) => n + MEAL_TYPES.filter((t) => d[t]).length,
          0
        ),
        flyerItems: extraction.items.length,
        extraction,
        plan,
      });
    } catch (err) {
      firstError ??= err;
      skipped.push({
        flyerId: m.flyerId,
        storeName: m.name,
        reason: err instanceof Error ? err.message : 'Failed',
      });
    }
  }

  // Every store failed the same way (no API key, Gemini down): surface that
  // error instead of an empty table.
  if (ranked.length === 0 && firstError) throw firstError;

  ranked.sort((a, b) => a.total - b.total);
  const result: StoreComparison = {
    comparedAt: new Date().toISOString(),
    ranked,
    skipped,
  };
  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonAtomic(path.join(outputDir, COMPARE_FILENAME), result);
  return result;
}

export function readComparedStore(
  outputDir: string,
  flyerId: number
): ComparedStore | null {
  const saved = readJsonOrNull<StoreComparison>(
    path.join(outputDir, COMPARE_FILENAME)
  );
  return saved?.ranked?.find((s) => s.flyerId === flyerId) ?? null;
}

// Make a compared store the active plan by handing its saved extraction + plan
// to the same commit a normal fetch uses. Returns null when the store isn't in
// the last comparison.
export function commitComparedStore(
  outputDir: string,
  flyerId: number,
  commit: (extraction: ExtractionResult, plan: MealPlanResult) => void
): ComparedStore | null {
  const picked = readComparedStore(outputDir, flyerId);
  if (picked) commit(picked.extraction, picked.plan);
  return picked;
}
