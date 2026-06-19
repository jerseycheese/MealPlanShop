import * as assert from "node:assert/strict";
import type { ShoppingListItem } from "../../types";
import { formatShoppingListText, parseExtraItems } from "./formatShoppingListText";

function item(
  name: string,
  category: string,
  quantity = "",
): ShoppingListItem {
  return { name, quantity, category, onSale: false, salePrice: null };
}

// Items get sorted into aisle order and rendered one-per-line as "name (qty)";
// a blank quantity drops the parens. This is the paste-into-Reminders contract.
{
  const items = [
    item("Greek yogurt", "dairy", "2 containers"),
    item("Chicken breast", "meat", "2 lbs"),
    item("Spinach", "produce", "1 bag"),
    item("Salt", "pantry"),
  ];
  const out = formatShoppingListText(items, []);
  assert.equal(
    out,
    "Spinach (1 bag)\nChicken breast (2 lbs)\nGreek yogurt (2 containers)\nSalt",
  );
}

// Extra item names append after the meal-plan items, one per line, with blank/
// whitespace-only entries dropped so they never become empty reminders.
{
  const items = [item("Spinach", "produce", "1 bag")];
  const out = formatShoppingListText(items, ["Paper towels", "  ", "Dog food"]);
  assert.equal(out, "Spinach (1 bag)\nPaper towels\nDog food");
}

// No items and no extras is an empty string, not a stray newline.
assert.equal(formatShoppingListText([], []), "");
assert.equal(formatShoppingListText([], ["   ", "  "]), "");

// parseExtraItems is the single source of the trim-and-drop-blanks rule.
assert.deepEqual(parseExtraItems("milk\n eggs \n\n  "), ["milk", "eggs"]);
assert.deepEqual(parseExtraItems(""), []);

console.log("formatShoppingListText: 6/6 passed");
