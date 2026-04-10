import { useState, useEffect, useCallback } from "react";
import type { MealPlanResult, Meal } from "../../types";
import { MealCard } from "./MealCard";
import { ShoppingList } from "./ShoppingList";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;

export function App() {
  const [mealPlan, setMealPlan] = useState<MealPlanResult | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const fetchMealPlan = useCallback(async () => {
    try {
      const res = await fetch("/api/meal-plan");
      const data = await res.json();
      if (data.exists === false) {
        setMealPlan(null);
      } else {
        const { exists: _, ...plan } = data;
        setMealPlan(plan as MealPlanResult);
      }
      setError(null);
    } catch {
      setError("Failed to load meal plan");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchMealPlan();
  }, [fetchMealPlan]);

  const handleRegenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/meal-plan/generate", { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Generation failed");
      } else {
        await fetchMealPlan();
        setExpandedMeals(new Set());
      }
    } catch {
      setError("Failed to generate meal plan");
    } finally {
      setGenerating(false);
    }
  };

  const toggleMeal = (key: string) => {
    setExpandedMeals((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (!loaded) {
    return (
      <div className="app">
        <div className="loading-state">Loading...</div>
      </div>
    );
  }

  const day = mealPlan?.weekPlan[selectedDay];

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">MealPlanShop</h1>
        <button
          className={`header__regenerate ${generating ? "header__regenerate--loading" : ""}`}
          onClick={handleRegenerate}
          disabled={generating}
        >
          {generating ? "Generating..." : mealPlan ? "Regenerate" : "Generate Plan"}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {!mealPlan ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No meal plan yet</h2>
          <p className="empty-state__text">
            Generate your first weekly meal plan based on current grocery store sales.
          </p>
        </div>
      ) : (
        <>
          <nav className="day-tabs">
            {mealPlan.weekPlan.map((d, i) => (
              <button
                key={d.day}
                className={`day-tabs__tab ${i === selectedDay ? "day-tabs__tab--active" : ""}`}
                onClick={() => setSelectedDay(i)}
              >
                {DAY_LABELS[i]}
              </button>
            ))}
          </nav>

          {day && (
            <main className="day-view">
              <h2 className="day-view__title">{day.day}</h2>
              {MEAL_TYPES.map((type, i) => {
                const meal: Meal = day[type];
                const key = `${day.day}-${type}`;
                return (
                  <MealCard
                    key={key}
                    meal={meal}
                    type={type.charAt(0).toUpperCase() + type.slice(1)}
                    expanded={expandedMeals.has(key)}
                    onToggle={() => toggleMeal(key)}
                    animationDelay={i * 80}
                  />
                );
              })}
            </main>
          )}

          <ShoppingList items={mealPlan.shoppingList} />
        </>
      )}
    </div>
  );
}
