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

// Build the unified shopping list as one line per item, in aisle order, with
// duplicates removed. Meal-plan items and the user's extras merge into a single
// ordered list (so an extra slots into its aisle next to meal items rather than
// being dumped at the end), then de-dupe by normalized name with meal-plan items
// winning over a same-named extra — a "cumin" ingredient beats an added "Cumin".
// Quantity rides in parentheses for meal items when present ("Chicken (2 lbs)");
// extras carry no quantity.
//
// This is the single source feeding both the copied text and the Send-to-
// Reminders push. Array.prototype.sort is stable, which matters here: listing
// meal items before extras keeps the meal item as the dedupe winner and
// preserves intra-aisle order. Don't swap it for an unstable sort.
export function buildShoppingListLines(
  items: ShoppingListItem[],
  extras: ExtraItem[],
): string[] {
  type Line = { name: string; category: string; quantity?: string };
  const all: Line[] = [
    ...items.map((i) => ({
      name: i.name,
      category: i.category,
      quantity: i.quantity,
    })),
    ...extras.map((e) => ({ name: e.name, category: e.category })),
  ];
  const seen = new Set<string>();
  const deduped = all.filter((line) => {
    const key = normalize(line.name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => categoryRank(a.category) - categoryRank(b.category));
  return deduped.map((line) => {
    const qty = line.quantity?.trim();
    return qty ? `${line.name} (${qty})` : line.name;
  });
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
