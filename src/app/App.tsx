import { useState, useEffect, useCallback } from "react";
import type { MealPlanResult, Meal, ShoppingListItem } from "../../types";
import { MealCard } from "./MealCard";
import { ShoppingList } from "./ShoppingList";
import { UploadCircular } from "./UploadCircular";
import { Preferences } from "./Preferences";

const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

function dayTabLabel(day: string): string {
  return DAY_LABELS[day.trim().toLowerCase()] ?? day.slice(0, 3);
}
const ALL_MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;

type CircularMeta = {
  storeName: string | null;
  validThrough: string | null;
  itemCount: number;
};

type ScanProgress =
  | { stage: "idle" }
  | { stage: "preparing" }
  | { stage: "scanning"; page: number; pages: number; storeName: string | null }
  | { stage: "planning" };

function filterPantry(
  items: ShoppingListItem[],
  pantry: string[]
): ShoppingListItem[] {
  if (pantry.length === 0) return items;
  const needles = pantry
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (needles.length === 0) return items;
  return items.filter((item) => {
    const name = item.name.toLowerCase();
    return !needles.some((n) => name.includes(n));
  });
}

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
  const [stale, setStale] = useState(false);
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
  const [pantryStaples, setPantryStaples] = useState<string[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [circular, setCircular] = useState<CircularMeta | null>(null);
  const [swappingKey, setSwappingKey] = useState<string | null>(null);
  const [swapError, setSwapError] = useState<{ key: string; message: string } | null>(null);

  const busy = generating || uploading || swappingKey !== null;

  const fetchCircular = useCallback(async () => {
    try {
      const res = await fetch("/api/circular");
      const data = await res.json();
      if (data.exists === false) {
        setCircular(null);
        return;
      }
      setCircular({
        storeName: typeof data.storeName === "string" ? data.storeName : null,
        validThrough:
          typeof data.validThrough === "string" ? data.validThrough : null,
        itemCount: typeof data.itemCount === "number" ? data.itemCount : 0,
      });
    } catch {
      setCircular(null);
    }
  }, []);

  const fetchMealPlan = useCallback(async () => {
    try {
      const res = await fetch("/api/meal-plan");
      const data = await res.json();
      if (data.exists === false) {
        setMealPlan(null);
        setStale(false);
        setCheckedKeys(new Set());
      } else {
        const { exists: _, stale: staleFlag, ...plan } = data;
        const planResult = plan as MealPlanResult;
        setMealPlan(planResult);
        setStale(staleFlag === true);
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
    fetchCircular();
  }, [fetchMealPlan, fetchCircular]);

  useEffect(() => {
    fetch("/api/preferences")
      .then((r) => r.json())
      .then((data) => {
        setMealsPerDay(data.preferences.mealsPerDay);
        setPantryStaples(data.preferences.pantryStaples ?? []);
      })
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

  const handleSwap = async (
    dayName: string,
    mealType: "breakfast" | "lunch" | "dinner"
  ) => {
    const key = `${dayName}-${mealType}`;
    setSwappingKey(key);
    setSwapError(null);
    try {
      const res = await fetch("/api/meal-plan/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: dayName, mealType }),
      });
      const data = await res.json();
      if (!data.success) {
        setSwapError({ key, message: data.error || "Swap failed" });
      } else {
        await fetchMealPlan();
      }
    } catch {
      setSwapError({ key, message: "Failed to swap meal" });
    } finally {
      setSwappingKey(null);
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
        await fetchCircular();
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
            <UploadCircular
              variant="header"
              onFile={handleUpload}
              disabled={busy}
            />
          )}
        </div>
      </header>

      {showPrefs && (
        <Preferences
          canRegenerate={!!mealPlan}
          onClose={() => setShowPrefs(false)}
          onSaved={(prefs, opts) => {
            setMealsPerDay(prefs.mealsPerDay);
            setPantryStaples(prefs.pantryStaples);
            setShowPrefs(false);
            if (opts?.regenerate) {
              handleRegenerate();
            } else {
              setSavedHint(true);
              if (mealPlan) {
                fetchMealPlan();
              }
            }
          }}
        />
      )}

      {savedHint && (
        <div className="saved-hint">
          Preferences saved. They'll apply on the next regenerate.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {circular && (circular.storeName || circular.validThrough) && (
        <div className="circular-banner">
          {circular.storeName && (
            <span className="circular-banner__store">{circular.storeName}</span>
          )}
          {circular.validThrough && (
            <span className="circular-banner__dates">
              Valid through {circular.validThrough}
            </span>
          )}
        </div>
      )}

      {busyLabel && (
        <div className="processing-banner">
          {busyLabel}{" "}
          {!mealPlan && (
            <span className="processing-banner__hint">
              Multi-page PDFs can take several minutes.
            </span>
          )}
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
          {stale && !generating && (
            <div className="meal-plan-stale-banner" role="status">
              <span className="meal-plan-stale-banner__text">
                Your preferences changed since this plan was generated.
              </span>
              <button
                className="meal-plan-stale-banner__cta"
                onClick={handleRegenerate}
                disabled={busy}
              >
                Regenerate to apply
              </button>
            </div>
          )}

          <nav className="day-tabs">
            {mealPlan.weekPlan.map((d, i) => (
              <button
                key={d.day}
                className={`day-tabs__tab ${i === selectedDay ? "day-tabs__tab--active" : ""}`}
                onClick={() => setSelectedDay(i)}
              >
                {dayTabLabel(d.day)}
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
                const isSwapping = swappingKey === key;
                return (
                  <MealCard
                    key={key}
                    meal={meal}
                    type={type.charAt(0).toUpperCase() + type.slice(1)}
                    expanded={expandedMeals.has(key)}
                    onToggle={() => toggleMeal(key)}
                    animationDelay={i * 80}
                    onSwap={() => handleSwap(day.day, type)}
                    swapping={isSwapping}
                    swapDisabled={(busy && !isSwapping) || stale}
                    swapDisabledReason={
                      stale ? "Regenerate first to apply preference changes" : null
                    }
                    swapError={swapError?.key === key ? swapError.message : null}
                  />
                );
              })}
            </main>
          )}

          <ShoppingList
            items={filterPantry(mealPlan.shoppingList, pantryStaples)}
            checkedKeys={checkedKeys}
            onToggle={toggleChecked}
            weeklyTotal={mealPlan.weekPlan
              .flatMap((d) => ALL_MEAL_TYPES.map((t) => d[t]?.estimatedCost ?? 0))
              .reduce((a, b) => a + b, 0)}
          />
        </>
      )}
    </div>
  );
}
