import { useState } from 'react';
import type { ExtraItem, ShoppingListItem } from '../../types';
import { shoppingItemKey } from './shoppingItemKey';
import { formatSalePrice } from './formatSalePrice';
import {
  buildReminderLines,
  CATEGORY_ORDER,
  formatShoppingListText,
  parseExtraItems,
} from './formatShoppingListText';

interface ShoppingListProps {
  items: ShoppingListItem[];
  checkedKeys: Set<string>;
  onToggle: (key: string) => void;
  mealPlanTotal: number;
  loyaltyProgram?: { label: string; modifier: string } | null;
  extras: ExtraItem[];
  onAddExtras: (names: string[]) => void;
  onRemoveExtra: (name: string) => void;
  remindersSupported: boolean;
  onSendToReminders: (
    lines: string[]
  ) => Promise<{ success: boolean; error?: string }>;
}

// Stable checkbox key for an extra item, namespaced so it can't collide with a
// meal-plan item's key in the shared checkedKeys set.
function extraKey(name: string): string {
  return `extra:${name.trim().toLowerCase()}`;
}

// A row in a category section is either a meal-plan item or a user-added extra.
// They share the aisle grouping but render slightly differently (extras carry a
// remove button and an estimated price; meal items carry sale/loyalty info).
type Row =
  | { kind: 'meal'; item: ShoppingListItem }
  | { kind: 'extra'; item: ExtraItem };

export function ShoppingList({
  items,
  checkedKeys,
  onToggle,
  mealPlanTotal,
  loyaltyProgram,
  extras,
  onAddExtras,
  onRemoveExtra,
  remindersSupported,
  onSendToReminders,
}: ShoppingListProps) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Group meal-plan items and extras together by category so extras land in the
  // right store section (cheddar -> dairy, paper towels -> other) instead of a
  // separate bucket.
  const grouped = new Map<string, Row[]>();
  const pushRow = (category: string, row: Row) => {
    const cat = (category || 'other').toLowerCase();
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(row);
  };
  for (const item of items) pushRow(item.category, { kind: 'meal', item });
  for (const ex of extras) pushRow(ex.category, { kind: 'extra', item: ex });

  const sortedCategories = [...grouped.keys()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const saleCount = items.filter((i) => i.onSale).length;
  // Extras with a Gemini estimate fold into the total; uncosted ones (null) just
  // don't move it. Total = the meal-plan estimate plus whatever the extras add.
  const extrasTotal = extras.reduce((sum, e) => sum + (e.price ?? 0), 0);
  const total = mealPlanTotal + extrasTotal;
  const totalItems = items.length + extras.length;
  const copyText = formatShoppingListText(items, extras);
  // De-duped, aisle-ordered lines for Apple Reminders, with an aisle divider row
  // before each group so the flat Standard list reads like sections.
  const reminderLines = buildReminderLines(items, extras);

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

  // Push the list to Apple Reminders. App owns the fetch; this manages the
  // button feedback and surfaces the server's error inline — the macOS
  // Automation-permission message needs to stay readable, not flash past.
  const handleSendToReminders = async () => {
    if (sending || reminderLines.length === 0) return;
    setSending(true);
    setSendError(null);
    const result = await onSendToReminders(reminderLines);
    setSending(false);
    if (result.success) {
      setSent(true);
      window.setTimeout(() => setSent(false), 2000);
    } else {
      setSendError(result.error ?? "Couldn't send to Reminders.");
    }
  };

  const handleAdd = () => {
    const names = parseExtraItems(draft);
    if (names.length === 0) return;
    onAddExtras(names);
    setDraft('');
  };

  const renderMealRow = (item: ShoppingListItem) => {
    const key = shoppingItemKey(item);
    const checked = checkedKeys.has(key);
    const classes = [
      'shopping-list__item',
      item.onSale ? 'shopping-list__item--sale' : '',
      checked ? 'shopping-list__item--checked' : '',
    ]
      .filter(Boolean)
      .join(' ');
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
            <span className="shopping-list__item-name" title={item.name}>
              {item.name}
            </span>
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
              {formatSalePrice(item.salePrice, item.unit)}
            </span>
          )}
        </label>
      </li>
    );
  };

  const renderExtraRow = (ex: ExtraItem) => {
    const key = extraKey(ex.name);
    const checked = checkedKeys.has(key);
    const classes = [
      'shopping-list__item',
      checked ? 'shopping-list__item--checked' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <li
        key={key}
        className="shopping-list__item-row shopping-list__item-row--extra"
      >
        <label className={classes}>
          <input
            type="checkbox"
            className="shopping-list__item-checkbox"
            checked={checked}
            onChange={() => onToggle(key)}
          />
          <div className="shopping-list__item-info">
            <span className="shopping-list__item-name" title={ex.name}>
              {ex.name}
            </span>
          </div>
          <span className="shopping-list__price shopping-list__price--extra">
            {ex.price != null ? `$${ex.price.toFixed(2)}` : '—'}
          </span>
        </label>
        <button
          type="button"
          className="shopping-list__extra-remove"
          onClick={() => onRemoveExtra(ex.name)}
          aria-label={`Remove ${ex.name}`}
        >
          ×
        </button>
      </li>
    );
  };

  return (
    <section className="shopping-list">
      <div className="shopping-list__header">
        <div className="shopping-list__heading">
          <h2 className="shopping-list__title">Shopping List</h2>
          <span className="shopping-list__count">
            {totalItems} items
            {saleCount > 0 && ` (${saleCount} on sale)`}
          </span>
          {mealPlanTotal > 0 && (
            <>
              <span className="shopping-list__totals">
                Meal plan ~${mealPlanTotal.toFixed(2)} · Listed items ~$
                {total.toFixed(2)}
              </span>
              <span className="shopping-list__totals-note">
                Planned meals plus extras you added — not a full-trip total.
              </span>
            </>
          )}
        </div>
        <div className="shopping-list__actions">
          <button
            type="button"
            className="shopping-list__copy"
            onClick={handleCopy}
            disabled={!copyText}
          >
            {copied ? 'Copied' : 'Copy list'}
          </button>
          {remindersSupported && (
            <button
              type="button"
              className="shopping-list__send-reminders"
              onClick={handleSendToReminders}
              disabled={sending || reminderLines.length === 0}
            >
              {sending ? 'Sending…' : sent ? 'Sent' : 'Send to Reminders'}
            </button>
          )}
        </div>
      </div>
      {sendError && (
        <p className="shopping-list__send-error" role="alert">
          {sendError}
        </p>
      )}

      <div className="shopping-list__grid">
        {sortedCategories.map((category) => (
          <div key={category} className="shopping-list__category">
            <h3 className="shopping-list__category-name">{category}</h3>
            <ul className="shopping-list__items">
              {grouped
                .get(category)!
                .map((row) =>
                  row.kind === 'meal'
                    ? renderMealRow(row.item)
                    : renderExtraRow(row.item)
                )}
            </ul>
          </div>
        ))}
      </div>

      <div className="shopping-list__extra">
        <label
          className="shopping-list__extra-label"
          htmlFor="shopping-list-extra"
        >
          Add items (milk, paper towels — one per line)
        </label>
        <textarea
          id="shopping-list-extra"
          className="shopping-list__extra-input"
          rows={3}
          placeholder={'One per line, then Add — price and aisle are estimated'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          className="shopping-list__extra-add"
          onClick={handleAdd}
          disabled={!draft.trim()}
        >
          Add
        </button>
      </div>
    </section>
  );
}
