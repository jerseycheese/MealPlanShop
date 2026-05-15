// Static map mirroring the category seeds in:
//   prompts/meal-plan-generation.md (line 6)
//   prompts/meal-swap.md (line 6)
// If you change one, change all three.
export const EXCLUDED_CATEGORIES: Record<string, string[]> = {
  shellfish: ["shrimp", "crab", "lobster", "scallops", "mussels", "oysters", "clams"],
  nuts: ["almonds", "walnuts", "pecans", "cashews", "hazelnuts", "pistachios"],
  dairy: ["milk", "cheese", "butter", "yogurt", "cream"],
  "red meat": ["beef", "pork", "lamb", "venison"],
  poultry: ["chicken", "turkey", "duck"],
  gluten: ["wheat", "barley", "rye"],
};

export interface ExpandedTerm {
  term: string;
  sourceCategory: string | null;
}

export function expandExcludedTerms(terms: string[]): ExpandedTerm[] {
  const out: ExpandedTerm[] = [];
  const seen = new Set<string>();
  const push = (term: string, sourceCategory: string | null) => {
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ term, sourceCategory });
  };

  for (const raw of terms) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const members = EXCLUDED_CATEGORIES[trimmed.toLowerCase()];
    if (members) {
      push(trimmed, null);
      for (const member of members) push(member, trimmed);
    } else {
      push(trimmed, null);
    }
  }
  return out;
}
