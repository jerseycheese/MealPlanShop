// Single source of truth for category -> member expansion. Injected into the
// meal-plan / meal-swap prompts at runtime via the {{CATEGORY_EXPANSIONS}}
// placeholder (see scripts/generate-meal-plan.ts), and used for code-side
// exclusion validation below.
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole-word, case-insensitive containment. Uses a unicode-aware word boundary
// so terms with accents (acai, jalapeno) still match — JavaScript's \b is
// ASCII-only and would fail on those. Avoids substring false positives like
// "egg" matching "eggplant" or "oil" matching "broiler".
export function containsWholeWord(text: string, term: string): boolean {
  const trimmed = term.trim();
  if (!trimmed) return false;
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegex(trimmed)}(?![\\p{L}\\p{N}_])`,
    "iu"
  );
  return re.test(text);
}

export function matchExpandedTerm(
  text: string,
  expanded: ExpandedTerm[]
): ExpandedTerm | null {
  for (const entry of expanded) {
    if (containsWholeWord(text, entry.term)) return entry;
  }
  return null;
}
