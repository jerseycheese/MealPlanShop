function normalizeIngredient(value: string): string {
  return value.trim().toLowerCase();
}

export function findExcludedPantryConflicts(
  excludedIngredients: string[],
  pantryStaples: string[],
): string[] {
  const pantry = new Set(
    pantryStaples.map(normalizeIngredient).filter(Boolean),
  );
  const seen = new Set<string>();
  const conflicts: string[] = [];

  for (const ingredient of excludedIngredients) {
    const normalized = normalizeIngredient(ingredient);
    if (!normalized || !pantry.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    conflicts.push(ingredient.trim());
  }

  return conflicts;
}
