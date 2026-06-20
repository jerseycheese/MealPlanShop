import * as assert from "node:assert/strict";
import type { ShoppingListItem, ExtraItem } from "../../types";
import {
  buildShoppingListLines,
  formatShoppingListText,
  parseExtraItems,
} from "./formatShoppingListText";

function item(
  name: string,
  category: string,
  quantity = "",
): ShoppingListItem {
  return { name, quantity, category, onSale: false, salePrice: null };
}

function extra(name: string, category = "other"): ExtraItem {
  return { name, price: null, category };
}

// Meal items get sorted into aisle order and rendered one-per-line as
// "name (qty)"; a blank quantity drops the parens. This is the paste-into-
// Reminders contract.
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

// Extras slot into their aisle alongside meal items (not dumped at the end), and
// blank/whitespace-only names are dropped so they never become empty reminders.
{
  const items = [item("Spinach", "produce", "1 bag")];
  const extras = [
    extra("Paper towels", "other"),
    extra("  "),
    extra("Bananas", "produce"),
  ];
  const out = formatShoppingListText(items, extras);
  assert.equal(out, "Spinach (1 bag)\nBananas\nPaper towels");
}

// A name that's both a meal ingredient and an extra appears once — the meal item
// (with its quantity) wins, case-insensitively.
{
  const items = [item("Cumin", "pantry", "1 tsp")];
  const lines = buildShoppingListLines(items, [extra("cumin", "pantry")]);
  assert.deepEqual(lines, ["Cumin (1 tsp)"]);
}

// No items and no extras is an empty string, not a stray newline.
assert.equal(formatShoppingListText([], []), "");
assert.equal(formatShoppingListText([], [extra("   "), extra("  ")]), "");

// parseExtraItems is the single source of the trim-and-drop-blanks rule.
assert.deepEqual(parseExtraItems("milk\n eggs \n\n  "), ["milk", "eggs"]);
assert.deepEqual(parseExtraItems(""), []);

console.log("formatShoppingListText: 7/7 passed");
