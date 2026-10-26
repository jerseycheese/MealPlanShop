import * as crypto from 'node:crypto';
import type {
  ExtractionResult,
  MealPlanResult,
  UserPreferences,
} from '../types';
import { attachLoyaltyFlags } from './attachLoyaltyFlags';
import { attachSaleUnits } from './attachSaleUnits';
import { computePrefsFingerprint } from './prefs-fingerprint';

// Finalizes a freshly generated plan before it's committed: joins the
// loyalty-card flag and the per-unit price label (lb vs each, issue #121)
// from the circular's sale items onto on-sale shopping-list rows — the meal
// plan prompt doesn't know about either — then stamps planId/fingerprint.
// This is the one seam all three generate paths (upload, Flipp, regenerate)
// share via runScanAndPlan; a route that bypassed it is how #142 happened.
export function decorateMealPlan(
  mealPlan: MealPlanResult,
  extraction: ExtractionResult,
  prefs: UserPreferences
): MealPlanResult {
  if (Array.isArray(mealPlan.shoppingList)) {
    attachLoyaltyFlags(mealPlan.shoppingList, extraction.items);
    attachSaleUnits(mealPlan.shoppingList, extraction.items);
  }

  return {
    ...mealPlan,
    planId: crypto.randomUUID(),
    prefsFingerprint: computePrefsFingerprint(prefs),
  };
}
