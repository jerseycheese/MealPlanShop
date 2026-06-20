import type { ShoppingListItem, ExtraItem } from "../../types";
import { normalize } from "../../normalize";

// Aisle order for the on-screen list and the copied text alike. Lives here (not
// in ShoppingList.tsx) so the formatter can sort without importing the component.
export const CATEGORY_ORDER = [
  "produce",
  "meat",
  "seafood",
  "deli",
  "dairy",
  "bakery",
  "pantry",
  "snacks",
  "beverages",
];

// One textarea line = one extra item. Trim and drop blanks so a stray newline
// doesn't become an empty reminder when the list is pasted.
export function parseExtraItems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category.toLowerCase());
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Deduped, aisle-ordered rows carrying both the display label and the category —
// the shared core behind the copied text and the Reminders push. Meal-plan items
// and the user's extras merge into one list (so an extra slots into its aisle
// rather than trailing at the end), then de-dupe by normalized name with meal-plan
// items winning over a same-named extra — a "cumin" ingredient beats an added
// "Cumin". Quantity rides in parentheses for meal items when present ("Chicken
// (2 lbs)"); extras carry no quantity.
//
// Array.prototype.sort is stable, which matters here: listing meal items before
// extras keeps the meal item as the dedupe winner and preserves intra-aisle
// order. Don't swap it for an unstable sort.
function buildShoppingListRows(
  items: ShoppingListItem[],
  extras: ExtraItem[],
): { label: string; category: string }[] {
  type Row = { name: string; category: string; quantity?: string };
  const all: Row[] = [
    ...items.map((i) => ({
      name: i.name,
      category: i.category,
      quantity: i.quantity,
    })),
    ...extras.map((e) => ({ name: e.name, category: e.category })),
  ];
  const seen = new Set<string>();
  const deduped = all.filter((row) => {
    const key = normalize(row.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  return deduped.map((row) => {
    const qty = row.quantity?.trim();
    return {
      label: qty ? `${row.name} (${qty})` : row.name,
      category: row.category,
    };
  });
}

// Flat one-line-per-item list, no headers — for the copied text.
export function buildShoppingListLines(
  items: ShoppingListItem[],
  extras: ExtraItem[],
): string[] {
  return buildShoppingListRows(items, extras).map((row) => row.label);
}

// Same items, grouped under an aisle divider per category — for the Reminders
// push. Real Reminders sections aren't scriptable, so a flat Standard list can't
// carry headers; these divider rows fake it so the list still reads by aisle.
// One divider per category, in aisle order (mirrors the on-screen grouping).
export function buildReminderLines(
  items: ShoppingListItem[],
  extras: ExtraItem[],
): string[] {
  const groups = new Map<string, string[]>();
  for (const row of buildShoppingListRows(items, extras)) {
    const cat = (row.category || "other").toLowerCase();
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(row.label);
  }
  const cats = [...groups.keys()].sort(
    (a, b) => categoryRank(a) - categoryRank(b),
  );
  const out: string[] = [];
  for (const cat of cats) {
    out.push(`—— ${cat.toUpperCase()} ——`);
    out.push(...groups.get(cat)!);
  }
  return out;
}

// Serialize the shopping list to a plaintext checklist where one line = one
// reminder — no bullets, no category headers, no prices, so it pastes straight
// into Apple Reminders (or any notes app) with each line becoming its own entry.
export function formatShoppingListText(
  items: ShoppingListItem[],
  extras: ExtraItem[],
): string {
  return buildShoppingListLines(items, extras).join("\n");
}
