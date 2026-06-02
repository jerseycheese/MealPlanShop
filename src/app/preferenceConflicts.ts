import { normalize } from "../../normalize";

// Returns the entries of `primary` that also appear (case-insensitively) in
// `against`, deduped and preserving first-seen order.
function findOverlap(primary: string[], against: string[]): string[] {
  const againstSet = new Set(against.map(normalize).filter(Boolean));
  const seen = new Set<string>();
  const conflicts: string[] = [];

  for (const ingredient of primary) {
    const normalized = normalize(ingredient);
    if (!normalized || !againstSet.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    conflicts.push(ingredient.trim());
  }

  return conflicts;
}

export function findExcludedPantryConflicts(
  excludedIngredients: string[],
  pantryStaples: string[],
): string[] {
  return findOverlap(excludedIngredients, pantryStaples);
}

export function findExcludedUseUpConflicts(
  excludedIngredients: string[],
  useUpIngredients: string[],
): string[] {
  return findOverlap(excludedIngredients, useUpIngredients);
}
