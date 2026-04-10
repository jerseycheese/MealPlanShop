import type { Meal } from "../../types";

interface MealCardProps {
  meal: Meal;
  type: string;
  expanded: boolean;
  onToggle: () => void;
  animationDelay: number;
}

export function MealCard({
  meal,
  type,
  expanded,
  onToggle,
  animationDelay,
}: MealCardProps) {
  const totalTime = meal.prepTime + meal.cookTime;
  const saleCount = meal.ingredients.filter((i) => i.onSale).length;

  return (
    <article
      className={`meal-card ${expanded ? "meal-card--expanded" : ""}`}
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <button className="meal-card__header" onClick={onToggle}>
        <div className="meal-card__header-top">
          <span className="meal-card__type">{type}</span>
          <span className="meal-card__chevron">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
        <h3 className="meal-card__name">{meal.name}</h3>
        <div className="meal-card__meta">
          <span className="meal-card__pill">
            {totalTime} min
          </span>
          <span className="meal-card__pill">
            {meal.estimatedCalories} cal
          </span>
          {saleCount > 0 && (
            <span className="meal-card__pill meal-card__pill--sale">
              {saleCount} on sale
            </span>
          )}
        </div>
      </button>

      <div className="meal-card__details">
        <div className="meal-card__details-inner">
          <div className="meal-card__section">
            <h4 className="meal-card__section-title">Ingredients</h4>
            <ul className="meal-card__ingredients">
              {meal.ingredients.map((ing, i) => (
                <li
                  key={i}
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
                <li key={i} className="meal-card__step">
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <div className="meal-card__times">
            <span>Prep: {meal.prepTime} min</span>
            <span>Cook: {meal.cookTime} min</span>
          </div>
        </div>
      </div>
    </article>
  );
}
