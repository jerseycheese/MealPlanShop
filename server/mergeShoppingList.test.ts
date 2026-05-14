import * as assert from "node:assert/strict";
import type { DayPlan, Ingredient, Meal, ShoppingListItem } from "../types";
import { shoppingItemKey } from "../src/app/shoppingItemKey";
import { mergeShoppingListAfterSwap } from "./mergeShoppingList";

let passed = 0;
let total = 0;
function test(name: string, fn: () => void): void {
  total++;
  fn();
  passed++;
  void name;
}

function ing(name: string, quantity = "1"): Ingredient {
  return { name, quantity, onSale: false };
}

function meal(name: string, ingredients: Ingredient[]): Meal {
  return {
    name,
    ingredients,
    activeTime: 10,
    totalTime: 20,
    instructions: ["cook"],
    estimatedCalories: 400,
    estimatedCost: 5,
  };
}

function sli(
  name: string,
  opts: Partial<Omit<ShoppingListItem, "name">> = {},
): ShoppingListItem {
  return {
    name,
    quantity: opts.quantity ?? "1",
    category: opts.category ?? "other",
    onSale: opts.onSale ?? false,
    salePrice: opts.salePrice ?? null,
  };
}

// Case 1: ingredient shared by swapped-out meal + another meal -> prior entry kept verbatim.
test("shared ingredient kept verbatim", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", lunch: meal("Chicken Bowl", [ing("Chicken")]) },
    { day: "Tuesday", dinner: meal("Chicken Soup", [ing("Chicken")]) },
  ];
  const priorChicken = sli("Chicken", {
    quantity: "2 lbs",
    category: "meat",
    onSale: true,
    salePrice: 5.99,
  });
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 0,
    swappedSlot: "lunch",
    newMeal: meal("Tofu Bowl", [ing("Tofu")]),
    priorList: [priorChicken],
    regeneratedList: [sli("chicken", { quantity: "1 lb", category: "meat" })],
  });
  const kept = merged.find((i) => i.name === "Chicken");
  assert.ok(kept, "Chicken entry should be retained");
  assert.equal(shoppingItemKey(kept!), shoppingItemKey(priorChicken));
});

// Case 2: ingredient unique to the swapped-out meal -> dropped.
test("ingredient unique to swapped-out meal is dropped", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", lunch: meal("Caesar Salad", [ing("Anchovies")]) },
    { day: "Tuesday", dinner: meal("Pasta", [ing("Pasta")]) },
  ];
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 0,
    swappedSlot: "lunch",
    newMeal: meal("Tofu Bowl", [ing("Tofu")]),
    priorList: [sli("Anchovies"), sli("Pasta")],
    regeneratedList: [sli("Tofu"), sli("Pasta")],
  });
  assert.equal(
    merged.find((i) => i.name.toLowerCase() === "anchovies"),
    undefined,
  );
});

// Case 3: ingredient genuinely new to the swapped-in meal -> added from regenerated list.
test("new ingredient sourced from regenerated list", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", lunch: meal("Pasta", [ing("Pasta")]) },
  ];
  const regeneratedTofu = sli("Tofu", {
    quantity: "1 block",
    category: "produce",
    onSale: true,
    salePrice: 2.99,
  });
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 0,
    swappedSlot: "lunch",
    newMeal: meal("Tofu Bowl", [ing("Tofu")]),
    priorList: [sli("Pasta")],
    regeneratedList: [regeneratedTofu],
  });
  assert.deepEqual(
    merged.find((i) => i.name === "Tofu"),
    regeneratedTofu,
  );
});

// Case 4: new ingredient absent from regenerated list -> synthesized fallback.
test("new ingredient absent from regenerated list is synthesized", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", lunch: meal("Pasta", [ing("Pasta")]) },
  ];
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 0,
    swappedSlot: "lunch",
    newMeal: meal("Tempeh Stir Fry", [ing("Tempeh", "8 oz")]),
    priorList: [sli("Pasta")],
    regeneratedList: [],
  });
  assert.deepEqual(
    merged.find((i) => i.name === "Tempeh"),
    {
      name: "Tempeh",
      quantity: "8 oz",
      category: "other",
      onSale: false,
      salePrice: null,
    },
  );
});

// Case 5: regenerated list renames an item still needed by an unchanged meal -> prior name kept.
test("rename of an unrelated still-needed item is ignored", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", breakfast: meal("Smoothie", [ing("Bananas")]) },
    { day: "Tuesday", lunch: meal("Pasta", [ing("Pasta")]) },
  ];
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 1,
    swappedSlot: "lunch",
    newMeal: meal("Tofu Bowl", [ing("Tofu")]),
    priorList: [sli("Bananas"), sli("Pasta")],
    regeneratedList: [sli("Banana"), sli("Tofu")],
  });
  assert.ok(merged.find((i) => i.name === "Bananas"));
  assert.equal(merged.find((i) => i.name === "Banana"), undefined);
});

// Case 6: swapped-in meal shares an ingredient with an unchanged meal -> single prior entry, no duplicate.
test("swapped-in ingredient shared with unchanged meal is not duplicated", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", breakfast: meal("Rice Porridge", [ing("Rice")]) },
    { day: "Tuesday", lunch: meal("Pasta", [ing("Pasta")]) },
  ];
  const priorRice = sli("Rice", { quantity: "3 cups", category: "grains" });
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 1,
    swappedSlot: "lunch",
    newMeal: meal("Fried Rice", [ing("Rice")]),
    priorList: [priorRice, sli("Pasta")],
    regeneratedList: [sli("rice", { quantity: "5 cups" }), sli("Egg")],
  });
  const riceEntries = merged.filter((i) => i.name.toLowerCase() === "rice");
  assert.equal(riceEntries.length, 1);
  assert.deepEqual(riceEntries[0], priorRice);
});

// Case 7: an undefined DayPlan slot does not throw.
test("undefined slot does not throw", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", dinner: meal("Pasta", [ing("Pasta")]) },
  ];
  assert.doesNotThrow(() =>
    mergeShoppingListAfterSwap({
      weekPlan,
      swappedDayIndex: 0,
      swappedSlot: "dinner",
      newMeal: meal("Tofu Bowl", [ing("Tofu")]),
      priorList: [sli("Pasta")],
      regeneratedList: [sli("Tofu")],
    }),
  );
});

// Case 8: empty newMeal ingredients and empty priorList -> no throw, empty result.
test("empty inputs produce an empty list without throwing", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", lunch: meal("Pasta", [ing("Pasta")]) },
  ];
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 0,
    swappedSlot: "lunch",
    newMeal: meal("Empty", []),
    priorList: [],
    regeneratedList: [],
  });
  assert.deepEqual(merged, []);
});

// Case 9: duplicate names in priorList are both carried (no dedupe).
test("duplicate prior entries are both carried", () => {
  const weekPlan: DayPlan[] = [
    { day: "Monday", lunch: meal("Dressing", [ing("Olive Oil")]) },
  ];
  const a = sli("Olive Oil", { quantity: "1 bottle", category: "pantry" });
  const b = sli("olive oil ", { quantity: "2 tbsp", category: "pantry" });
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 0,
    swappedSlot: "dinner",
    newMeal: meal("Side", [ing("Bread")]),
    priorList: [a, b],
    regeneratedList: [sli("Bread")],
  });
  assert.equal(
    merged.filter((i) => i.name.trim().toLowerCase() === "olive oil").length,
    2,
  );
});

// Case 10: ordering -> retained prior entries first (prior order), then new entries (newMeal order).
test("merged list preserves prior order then appends new in meal order", () => {
  const weekPlan: DayPlan[] = [
    {
      day: "Monday",
      lunch: meal("Stew", [ing("Carrots"), ing("Potatoes")]),
    },
  ];
  const merged = mergeShoppingListAfterSwap({
    weekPlan,
    swappedDayIndex: 0,
    swappedSlot: "dinner",
    newMeal: meal("Stir Fry", [ing("Broccoli"), ing("Garlic")]),
    priorList: [sli("Carrots"), sli("Potatoes")],
    regeneratedList: [sli("Broccoli"), sli("Garlic")],
  });
  assert.deepEqual(
    merged.map((i) => i.name),
    ["Carrots", "Potatoes", "Broccoli", "Garlic"],
  );
});

console.log(`mergeShoppingList: ${passed}/${total} passed`);
