import type { ShoppingListItem } from "../../types";

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

// Serialize the shopping list to a plaintext checklist where one line = one
// reminder — no bullets, no category headers, no prices, so it pastes straight
// into Apple Reminders (or any notes app) with each line becoming its own entry.
// Meal-plan items come first, sorted into aisle order; the user's extra items
// follow. Quantity rides in parentheses when present (e.g. "Chicken (2 lbs)").
export function formatShoppingListText(
  items: ShoppingListItem[],
  extraItemsText: string,
): string {
  const sorted = [...items].sort(
    (a, b) => categoryRank(a.category) - categoryRank(b.category),
  );
  const lines = sorted.map((item) => {
    const qty = item.quantity?.trim();
    return qty ? `${item.name} (${qty})` : item.name;
  });
  return [...lines, ...parseExtraItems(extraItemsText)].join("\n");
}
