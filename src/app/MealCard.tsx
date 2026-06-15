import type { Meal } from "../../types";

function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

interface MealCardProps {
  meal: Meal;
  type: string;
  expanded: boolean;
  onToggle: () => void;
  animationDelay: number;
  onSwap?: () => void;
  swapping?: boolean;
  swapDisabled?: boolean;
  swapDisabledReason?: string | null;
  swapError?: string | null;
}

export function MealCard({
  meal,
  type,
  expanded,
  onToggle,
  animationDelay,
  onSwap,
  swapping = false,
  swapDisabled = false,
  swapDisabledReason = null,
  swapError = null,
}: MealCardProps) {
  const saleCount = meal.ingredients.filter((i) => i.onSale).length;

  return (
    <article
      className={`meal-card ${expanded ? "meal-card--expanded" : ""}`}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="meal-card__header">
        {/*
          The toggle covers the whole header so the entire card title area is
          clickable, but it stays empty (labeled via aria-label) so the SWAP
          button and the meal heading aren't nested inside another interactive
          element — that nesting is invalid HTML and confuses screen readers.
        */}
        <button
          type="button"
          className="meal-card__toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${type}: ${meal.name}`}
        />
        <div className="meal-card__header-top">
          <span className="meal-card__type">{type}</span>
          <div className="meal-card__header-actions">
            {onSwap && (
              <button
                type="button"
                aria-label={`Swap ${type}`}
                aria-busy={swapping}
                aria-disabled={swapping || swapDisabled}
                title={swapDisabled && swapDisabledReason ? swapDisabledReason : undefined}
                className={`meal-card__swap ${swapping ? "meal-card__swap--loading" : ""}`}
                onClick={() => {
                  if (swapping || swapDisabled) return;
                  onSwap();
                }}
              >
                {swapping ? "Swapping..." : "Swap"}
              </button>
            )}
            <span className="meal-card__chevron" aria-hidden="true">
              {expanded ? "▲" : "▼"}
            </span>
          </div>
        </div>
        <h3 className="meal-card__name">{meal.name}</h3>
        <div className="meal-card__meta">
          <span className="meal-card__pill meal-card__pill--time">
            {formatMinutes(meal.activeTime)} active / {formatMinutes(meal.totalTime)} total
          </span>
          <span className="meal-card__pill">
            {meal.estimatedCalories} cal
          </span>
          {saleCount > 0 && (
            <span className="meal-card__pill">
              ~${(meal.estimatedCost ?? 0).toFixed(2)}
            </span>
          )}
          {saleCount > 0 && (
            <span className="meal-card__pill meal-card__pill--sale">
              {saleCount} on sale
            </span>
          )}
        </div>
      </div>

      {swapError && (
        <div className="meal-card__swap-error" role="alert">
          {swapError}
        </div>
      )}

      <div className="meal-card__details" aria-hidden={!expanded}>
        <div className="meal-card__details-inner">
          <div className="meal-card__section">
            <h4 className="meal-card__section-title">Ingredients</h4>
            <ul className="meal-card__ingredients">
              {meal.ingredients.map((ing) => (
                <li
                  key={`${ing.name}|${ing.quantity}`}
                  className={`meal-card__ingredient ${ing.onSale ? "meal-card__ingredient--sale" : ""}`}
                >
                  <span className="meal-card__ingredient-qty">{ing.quantity}</span>
                  <span className="meal-card__ingredient-name">{ing.name}</span>
                  {ing.onSale && <span className="meal-card__sale-badge">Sale</span>}
                </li>
              ))}
            </ul>
          </div>

          <div className="meal-card__section">
            <h4 className="meal-card__section-title">Instructions</h4>
            <ol className="meal-card__instructions">
              {meal.instructions.map((step, i) => (
                <li key={`step-${i}`} className="meal-card__step">
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div className="meal-card__times">
            <span>Active: {formatMinutes(meal.activeTime)}</span>
            <span>Total: {formatMinutes(meal.totalTime)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
