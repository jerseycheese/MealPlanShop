import type {
  ExtractionResult,
  MealPlanResult,
  SaleItem,
  UserPreferences,
} from '../types';

// Extracted from index.ts so the generate-then-commit ordering can be unit-tested
// without booting the Express server (index.ts calls app.listen() at module load).
// Mirrors the validatePreferences / mergeShoppingList / moveMeal sibling-module pattern.

export interface ScanAndPlanDeps {
  // Resolve current preferences, read fresh so a mid-session change is honored.
  loadPreferences: () => UserPreferences;
  // Build the plan from the sale items — the one step that can fail or run long.
  generate: (
    items: SaleItem[],
    prefs: UserPreferences
  ) => Promise<MealPlanResult>;
  // Finalize the plan before it's committed (loyalty/unit joins, planId, fingerprint).
  decorate?: (
    plan: MealPlanResult,
    extraction: ExtractionResult,
    prefs: UserPreferences
  ) => MealPlanResult;
  // Persist the extraction and the finished plan together. Called once, only after
  // generation succeeds.
  commit: (extraction: ExtractionResult, plan: MealPlanResult) => void;
}

export interface ScanAndPlanResult {
  itemCount: number;
  storeName: string | null;
}

// Generate-then-commit: build the meal plan BEFORE writing anything, then hand the
// extraction and the finished plan to commit() in one step. A generation failure
// (Gemini error/timeout) or an interruption mid-call leaves the prior extraction and
// plan untouched, instead of committing the new circular and then dying before the
// plan is written — which left the UI showing a fresh store banner over a stale
// plan, with no staleness flag (#123).
export async function scanAndPlan(
  extraction: ExtractionResult,
  deps: ScanAndPlanDeps,
  opts: { allowEmpty?: boolean } = {}
): Promise<ScanAndPlanResult> {
  if (!opts.allowEmpty && extraction.items.length === 0) {
    const err = new Error(
      'No sale items extracted from this circular.'
    ) as Error & { statusCode?: number };
    err.statusCode = 422;
    throw err;
  }

  const prefs = deps.loadPreferences();
  const plan = await deps.generate(extraction.items, prefs);
  const finalPlan = deps.decorate
    ? deps.decorate(plan, extraction, prefs)
    : plan;
  deps.commit(extraction, finalPlan);

  return {
    itemCount: extraction.items.length,
    storeName: extraction.storeName,
  };
}
