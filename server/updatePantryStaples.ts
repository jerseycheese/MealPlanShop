import type { UserPreferences } from '../types';
import {
  applyStapleChanges,
  withStaples,
  type StapleChanges,
} from '../src/app/pantryStaples';
import {
  MAX_LIST_ITEMS,
  MAX_LIST_ITEM_LEN,
  ValidationError,
  validatePreferences,
} from './validatePreferences';

// The pantry-staples route's logic, kept out of index.ts so it can be tested
// without booting the server. A restock adds whatever the user checked off, and
// flyer names can run long, so a name too long to be a staple is skipped and
// reported back instead of failing the whole batch. A full list is refused with
// a message the user can act on.
export function updatePantryStaples(
  prefs: UserPreferences,
  { dropMatching = [], add = [] }: StapleChanges
): { saved: UserPreferences | null; skipped: string[] } {
  const skipped = add.filter((n) => n.trim().length > MAX_LIST_ITEM_LEN);
  const next = applyStapleChanges(prefs.pantryStaples, {
    dropMatching,
    add: add.filter((n) => n.trim().length <= MAX_LIST_ITEM_LEN),
  });
  const changed =
    next.length !== prefs.pantryStaples.length ||
    next.some((s, i) => s !== prefs.pantryStaples[i]);
  if (!changed) return { saved: null, skipped };
  if (next.length > MAX_LIST_ITEMS) {
    throw new ValidationError(
      `Pantry staples are full (${MAX_LIST_ITEMS} max). Remove some in Preferences, then restock again.`
    );
  }
  return { saved: validatePreferences(withStaples(prefs, next)), skipped };
}
