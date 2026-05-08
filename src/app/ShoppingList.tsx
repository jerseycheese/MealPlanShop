import type { ShoppingListItem } from "../../types";
import { shoppingItemKey } from "./shoppingItemKey";

const CATEGORY_ORDER = [
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

interface ShoppingListProps {
  items: ShoppingListItem[];
  checkedKeys: Set<string>;
  onToggle: (key: string) => void;
  weeklyTotal: number;
}

export function ShoppingList({ items, checkedKeys, onToggle, weeklyTotal }: ShoppingListProps) {
  const grouped = new Map<string, ShoppingListItem[]>();

  for (const item of items) {
    const cat = item.category.toLowerCase();
    if (!grouped.has(cat)) {
      grouped.set(cat, []);
    }
    grouped.get(cat)!.push(item);
  }

  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const saleCount = items.filter((i) => i.onSale).length;

  return (
    <section className="shopping-list">
      <div className="shopping-list__header">
        <h2 className="shopping-list__title">Shopping List</h2>
        <span className="shopping-list__count">
          {items.length} items ({saleCount} on sale) · ~${weeklyTotal.toFixed(2)} this week
        </span>
      </div>

      <div className="shopping-list__grid">
        {sortedCategories.map((category) => (
          <div key={category} className="shopping-list__category">
            <h3 className="shopping-list__category-name">{category}</h3>
            <ul className="shopping-list__items">
              {grouped.get(category)!.map((item) => {
                const key = shoppingItemKey(item);
                const checked = checkedKeys.has(key);
                const classes = [
                  "shopping-list__item",
                  item.onSale ? "shopping-list__item--sale" : "",
                  checked ? "shopping-list__item--checked" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={key} className="shopping-list__item-row">
                    <label className={classes}>
                      <input
                        type="checkbox"
                        className="shopping-list__item-checkbox"
                        checked={checked}
                        onChange={() => onToggle(key)}
                      />
                      <div className="shopping-list__item-info">
                        <span className="shopping-list__item-name" title={item.name}>{item.name}</span>
                        <span className="shopping-list__item-qty">{item.quantity}</span>
                      </div>
                      {item.onSale && item.salePrice != null && (
                        <span className="shopping-list__price">
                          ${item.salePrice.toFixed(2)}
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
