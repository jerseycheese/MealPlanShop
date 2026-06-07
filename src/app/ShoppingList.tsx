import { useState } from "react";
import type { ShoppingListItem } from "../../types";
import { shoppingItemKey } from "./shoppingItemKey";
import { CATEGORY_ORDER, formatShoppingListText } from "./formatShoppingListText";

interface ShoppingListProps {
  items: ShoppingListItem[];
  checkedKeys: Set<string>;
  onToggle: (key: string) => void;
  weeklyTotal: number;
  loyaltyProgram?: { label: string; modifier: string } | null;
  extraItemsText: string;
  onExtraItemsChange: (text: string) => void;
  onExtraItemsCommit: () => void;
}

export function ShoppingList({
  items,
  checkedKeys,
  onToggle,
  weeklyTotal,
  loyaltyProgram,
  extraItemsText,
  onExtraItemsChange,
  onExtraItemsCommit,
}: ShoppingListProps) {
  const [copied, setCopied] = useState(false);
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
  const copyText = formatShoppingListText(items, extraItemsText);

  // Copy the whole list (meal items + extras) as plaintext so it pastes into
  // Reminders one-line-per-item. Clipboard API needs a secure context; localhost
  // counts, so this works for the local-first setup. Swallow failures and just
  // skip the confirmation rather than throwing at the user.
  const handleCopy = async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="shopping-list">
      <div className="shopping-list__header">
        <div className="shopping-list__heading">
          <h2 className="shopping-list__title">Shopping List</h2>
          <span className="shopping-list__count">
            {items.length} items
            {saleCount > 0 &&
              ` (${saleCount} on sale) · ~$${weeklyTotal.toFixed(2)} this week`}
          </span>
        </div>
        <button
          type="button"
          className="shopping-list__copy"
          onClick={handleCopy}
          disabled={!copyText}
        >
          {copied ? "Copied" : "Copy list"}
        </button>
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
                        {item.requiresLoyaltyCard && loyaltyProgram && (
                          <span
                            className={`loyalty-chip loyalty-chip--${loyaltyProgram.modifier}`}
                            aria-label={`Requires ${loyaltyProgram.label} loyalty card`}
                          >
                            {loyaltyProgram.label}
                          </span>
                        )}
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

      <div className="shopping-list__extra">
        <label className="shopping-list__extra-label" htmlFor="shopping-list-extra">
          Extra items (milk, paper towels, anything not from the plan)
        </label>
        <textarea
          id="shopping-list-extra"
          className="shopping-list__extra-input"
          rows={4}
          placeholder={"One per line — these get added to the copied list"}
          value={extraItemsText}
          onChange={(e) => onExtraItemsChange(e.target.value)}
          onBlur={onExtraItemsCommit}
        />
      </div>
    </section>
  );
}
