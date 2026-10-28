import * as crypto from 'node:crypto';
import type {
  ExtractionResult,
  MealPlanResult,
  SaleItem,
  ShoppingListItem,
  UserPreferences,
} from '../types';
import { attachLoyaltyFlags } from './attachLoyaltyFlags';
import { attachSaleUnits } from './attachSaleUnits';
import { computePrefsFingerprint } from './prefs-fingerprint';

// Joins the loyalty-card flag and the per-unit price label from the circular's
// sale items onto shopping-list rows. Neither the plan prompt nor the swap prompt
// knows about them. Both decorateMealPlan and the swap route call this, so a new
// row-level join lands on every path at once (#159). Mutates and returns rows.
export function attachSaleJoins(
  rows: ShoppingListItem[],
  saleItems: SaleItem[]
): ShoppingListItem[] {
  attachLoyaltyFlags(rows, saleItems);
  attachSaleUnits(rows, saleItems);
  return rows;
}

// Finalizes a freshly generated plan before it's committed: joins the
// loyalty-card flag and the per-unit price label (lb vs each, issue #121)
// from the circular's sale items onto on-sale shopping-list rows — the meal
// plan prompt doesn't know about either — then stamps planId/fingerprint.
// This is the one seam every generate path shares: the server's three
// (upload, Flipp, regenerate) via runScanAndPlan, and the plan/pipeline CLIs
// via writeMealPlan. A path that bypassed it is how #142 and #155 happened.
export function decorateMealPlan(
  mealPlan: MealPlanResult,
  extraction: ExtractionResult,
  prefs: UserPreferences
): MealPlanResult {
  if (Array.isArray(mealPlan.shoppingList)) {
    attachSaleJoins(mealPlan.shoppingList, extraction.items);
  }

  return {
    ...mealPlan,
    planId: crypto.randomUUID(),
    prefsFingerprint: computePrefsFingerprint(prefs),
  };
}
