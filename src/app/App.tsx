import { useState, useEffect, useCallback } from "react";
import type { MealPlanResult, Meal } from "../../types";
import { MealCard } from "./MealCard";
import { ShoppingList } from "./ShoppingList";
import { UploadCircular } from "./UploadCircular";
import { Preferences } from "./Preferences";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ALL_MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;

type ScanProgress =
  | { stage: "idle" }
  | { stage: "preparing" }
  | { stage: "scanning"; page: number; pages: number; storeName: string | null }
  | { stage: "planning" };

function progressLabel(p: ScanProgress): string | null {
  switch (p.stage) {
    case "preparing":
      return "Preparing circular...";
    case "scanning":
      return p.storeName
        ? `Scanning ${p.storeName} page ${p.page} of ${p.pages}...`
        : `Scanning page ${p.page} of ${p.pages}...`;
    case "planning":
      return "Building meal plan...";
    default:
      return null;
  }
}

export function App() {
  const [mealPlan, setMealPlan] = useState<MealPlanResult | null>(null);
  const [selectedDay, setSelectedDay] = useState(0);
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress>({
    stage: "idle",
  });
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [savedHint, setSavedHint] = useState(false);
  const [mealsPerDay, setMealsPerDay] = useState<string[]>([
    "breakfast",
    "lunch",
    "dinner",
  ]);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());

  const busy = generating || uploading;

  const fetchMealPlan = useCallback(async () => {
    try {
      const res = await fetch("/api/meal-plan");
      const data = await res.json();
      if (data.exists === false) {
        setMealPlan(null);
        setCheckedKeys(new Set());
      } else {
        const { exists: _, ...plan } = data;
        const planResult = plan as MealPlanResult;
        setMealPlan(planResult);
        try {
          const stateRes = await fetch("/api/shopping-list-state");
          const state = await stateRes.json();
          if (
            planResult.planId &&
            state.planId === planResult.planId &&
            Array.isArray(state.checkedKeys)
          ) {
            setCheckedKeys(new Set(state.checkedKeys));
          } else {
            setCheckedKeys(new Set());
          }
        } catch {
          setCheckedKeys(new Set());
        }
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

  useEffect(() => {
    fetch("/api/preferences")
      .then((r) => r.json())
      .then((data) => setMealsPerDay(data.preferences.mealsPerDay))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!savedHint) return;
    const timer = window.setTimeout(() => setSavedHint(false), 3500);
    return () => window.clearTimeout(timer);
  }, [savedHint]);

  useEffect(() => {
    if (!uploading) {
      setScanProgress({ stage: "idle" });
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/circular/progress");
        const data: ScanProgress = await res.json();
        if (!cancelled) setScanProgress(data);
      } catch {
        // poll failures are non-fatal
      }
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [uploading]);

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

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("circular", file);
      const res = await fetch("/api/circular/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Upload failed");
      } else {
        await fetchMealPlan();
        setExpandedMeals(new Set());
        setSelectedDay(0);
      }
    } catch {
      setError("Failed to upload circular");
    } finally {
      setUploading(false);
    }
  };

  const toggleChecked = (key: string) => {
    if (!mealPlan?.planId) return;
    const planId = mealPlan.planId;
    const next = new Set(checkedKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setCheckedKeys(next);
    fetch("/api/shopping-list-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, checkedKeys: [...next] }),
    }).catch(() => {
      setCheckedKeys((current) => {
        const reverted = new Set(current);
        if (reverted.has(key)) {
          reverted.delete(key);
        } else {
          reverted.add(key);
        }
        return reverted;
      });
    });
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
  const busyLabel = uploading
    ? (progressLabel(scanProgress) ?? "Scanning circular...")
    : generating
      ? "Generating..."
      : null;
  const compactBusyLabel = uploading
    ? scanProgress.stage === "scanning"
      ? `Scanning ${scanProgress.page}/${scanProgress.pages}...`
      : (progressLabel(scanProgress) ?? "Scanning...")
    : busyLabel;

  return (
    <div className="app">
      <header className="header">
        <h1 className="header__title">MealPlanShop</h1>
        <div className="header__actions">
          <button
            className="header__prefs"
            onClick={() => setShowPrefs(true)}
            disabled={busy}
          >
            Preferences
          </button>
          {mealPlan && (
            <>
              <UploadCircular
                variant="header"
                onFile={handleUpload}
                disabled={busy}
              />
              <button
                className={`header__regenerate ${busy ? "header__regenerate--loading" : ""}`}
                onClick={handleRegenerate}
                disabled={busy}
              >
                {compactBusyLabel ?? "Regenerate"}
              </button>
            </>
          )}
        </div>
      </header>

      {showPrefs && (
        <Preferences
          onClose={() => setShowPrefs(false)}
          onSaved={(prefs) => {
            setMealsPerDay(prefs.mealsPerDay);
            setShowPrefs(false);
            setSavedHint(true);
          }}
        />
      )}

      {savedHint && (
        <div className="saved-hint">
          Preferences saved &mdash; click Regenerate to apply.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {busy && !mealPlan && (
        <div className="processing-banner">
          {busyLabel ?? "Processing..."}{" "}
          <span className="processing-banner__hint">
            Multi-page PDFs can take several minutes.
          </span>
        </div>
      )}

      {!mealPlan ? (
        <div className="empty-state">
          <h2 className="empty-state__title">No meal plan yet</h2>
          <p className="empty-state__text">
            Upload your store's weekly circular and we'll build a meal plan around the deals.
          </p>
          <div className="empty-state__upload">
            <UploadCircular
              variant="empty"
              onFile={handleUpload}
              disabled={busy}
            />
          </div>
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
              {ALL_MEAL_TYPES.filter(
                (type) => mealsPerDay.includes(type) && day[type]
              ).map((type, i) => {
                const meal = day[type] as Meal;
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

          <ShoppingList
            items={mealPlan.shoppingList}
            checkedKeys={checkedKeys}
            onToggle={toggleChecked}
          />
        </>
      )}
    </div>
  );
}
