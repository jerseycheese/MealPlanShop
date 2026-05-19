import { useState, useEffect, useCallback, useRef } from "react";
import type {
  MealPlanResult,
  ShoppingListItem,
  ScanProgress,
} from "../../types";
import { MEAL_TYPES } from "../../types";
import { MealCard } from "./MealCard";
import { ShoppingList } from "./ShoppingList";
import { UploadCircular } from "./UploadCircular";
import { Preferences } from "./Preferences";
import { StorePicker, type FlippMerchant } from "./StorePicker";
import { API } from "./apiPaths";

const SAVED_HINT_DISMISS_MS = 3500;
const SCAN_PROGRESS_POLL_MS = 1500;
const MEAL_CARD_STAGGER_MS = 80;

const DAY_TAB_LABEL: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

function dayTabLabel(day: string): string {
  const key = day.trim().toLowerCase();
  return DAY_TAB_LABEL[key] ?? day.slice(0, 3);
}

type CircularMeta = {
  storeName: string | null;
  validThrough: string | null;
  itemCount: number;
};

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

function formatValidThrough(raw: string | null): string | null {
  if (!raw) return null;
  // PDF flow stores a free-form string like "May 19, 2026" — pass through.
  // Flipp flow stores an ISO timestamp — render it as a friendly date.
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const LOYALTY_PROGRAMS: ReadonlyArray<{
  match: readonly string[];
  label: string;
  modifier: string;
}> = [
  { match: ["food lion"], label: "MVP", modifier: "mvp" },
  { match: ["harris teeter"], label: "VIC", modifier: "vic" },
  { match: ["kroger"], label: "Plus", modifier: "plus" },
  { match: ["publix"], label: "Plus", modifier: "plus" },
  { match: ["safeway", "albertsons"], label: "Card", modifier: "generic" },
  { match: ["shoprite"], label: "Price Plus", modifier: "plus" },
];

function loyaltyProgramFor(storeName: string | null): { label: string; modifier: string } | null {
  if (!storeName) return null;
  const s = storeName.toLowerCase();
  const hit = LOYALTY_PROGRAMS.find((p) => p.match.some((m) => s.includes(m)));
  if (hit) return { label: hit.label, modifier: hit.modifier };
  return { label: "Card", modifier: "generic" };
}

function isMealPlanResult(value: unknown): value is MealPlanResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.weekPlan) && Array.isArray(v.shoppingList);
}

function progressLabel(p: ScanProgress): string | null {
  switch (p.stage) {
    case "preparing":
      return "Preparing circular...";
    case "scanning":
      return p.storeName
        ? `Scanning ${p.storeName} page ${p.page} of ${p.pages}...`
        : `Scanning page ${p.page} of ${p.pages}...`;
    case "fetching":
      return `Fetching ${p.merchant} circular...`;
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
  const [showStorePicker, setShowStorePicker] = useState(false);

  // Monotonic counter to discard stale shopping-list-state PUT responses.
  // Without this, rapid toggles race: an older request resolving after a newer
  // one would revert (on failure) state that the newer one already replaced.
  const shoppingListPutSeq = useRef(0);

  const busy = generating || uploading || swappingKey !== null;

  const fetchCircular = useCallback(async () => {
    try {
      const res = await fetch(API.circular);
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
      const res = await fetch(API.mealPlan);
      if (!res.ok) throw new Error(`meal-plan request failed: ${res.status}`);
      const data = await res.json();
      if (data.exists === false) {
        setMealPlan(null);
        setStale(false);
        setCheckedKeys(new Set());
      } else {
        const { exists: _, stale: staleFlag, ...plan } = data;
        if (!isMealPlanResult(plan)) {
          throw new Error("meal-plan response failed validation");
        }
        const planResult = plan;
        setMealPlan(planResult);
        setStale(staleFlag === true);
        try {
          const stateRes = await fetch(API.shoppingListState);
          if (!stateRes.ok) throw new Error(`shopping-list-state failed: ${stateRes.status}`);
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
    fetch(API.preferences)
      .then((r) => r.json())
      .then((data) => {
        setMealsPerDay(data.preferences.mealsPerDay);
        setPantryStaples(data.preferences.pantryStaples ?? []);
      })
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.error("Failed to load preferences", err);
        }
      });
  }, []);

  useEffect(() => {
    if (!savedHint) return;
    const timer = window.setTimeout(() => setSavedHint(false), SAVED_HINT_DISMISS_MS);
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
        const res = await fetch(API.circularProgress);
        const data: ScanProgress = await res.json();
        if (!cancelled) setScanProgress(data);
      } catch {
        // poll failures are non-fatal
      }
    };
    poll();
    const interval = setInterval(poll, SCAN_PROGRESS_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [uploading]);

  const handleRegenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(API.mealPlanGenerate, { method: "POST" });
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
      const res = await fetch(API.mealPlanSwap, {
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

  const handleFlippFetch = async (m: FlippMerchant) => {
    setShowStorePicker(false);
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(API.circularFlippFetch, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flyerId: m.flyerId,
          merchantId: typeof m.merchantId === "number" ? m.merchantId : null,
          merchantName: m.name,
          validThrough: m.validTo,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Fetch failed");
      } else {
        await fetchMealPlan();
        await fetchCircular();
        setExpandedMeals(new Set());
        setSelectedDay(0);
      }
    } catch {
      setError("Failed to fetch circular");
    } finally {
      setUploading(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("circular", file);
      const res = await fetch(API.circularUpload, {
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

    const seq = ++shoppingListPutSeq.current;
    const snapshot = [...next];
    fetch(API.shoppingListState, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, checkedKeys: snapshot }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch(() => {
        // Only revert if this is still the latest in-flight request. A newer
        // toggle reflects the user's current intent; reverting an older one
        // would clobber it.
        if (seq !== shoppingListPutSeq.current) return;
        setCheckedKeys((current) => {
          const reverted = new Set(current);
          if (reverted.has(key)) reverted.delete(key);
          else reverted.add(key);
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
            <>
              <button
                className="header__change-store"
                onClick={() => setShowStorePicker(true)}
                disabled={busy}
                type="button"
              >
                Change store
              </button>
              <UploadCircular
                variant="header"
                onFile={handleUpload}
                disabled={busy}
              />
            </>
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
                // Optimistically mark stale so Swap is blocked during the
                // refetch window. The GET response will clear the flag if
                // the new prefs still match the saved plan's fingerprint.
                setStale(true);
                fetchMealPlan();
              }
            }
          }}
        />
      )}

      {showStorePicker && (
        <div
          className="store-picker-modal__backdrop"
          onClick={() => setShowStorePicker(false)}
        >
          <div
            className="store-picker-modal__dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Change store"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="store-picker-modal__close"
              onClick={() => setShowStorePicker(false)}
              aria-label="Close"
            >
              x
            </button>
            <StorePicker
              onFetch={handleFlippFetch}
              onUploadFile={handleUpload}
              disabled={busy}
            />
          </div>
        </div>
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
              Valid through {formatValidThrough(circular.validThrough)}
            </span>
          )}
          {mealPlan?.shoppingList.some((i) => i.requiresLoyaltyCard) && (
            <span className="circular-banner__loyalty">
              Some prices require a loyalty card
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
            Pick your store's weekly circular and we'll build a meal plan around the deals.
          </p>
          <div className="empty-state__picker">
            <StorePicker
              onFetch={handleFlippFetch}
              onUploadFile={handleUpload}
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
              {MEAL_TYPES.flatMap((type, i) => {
                if (!mealsPerDay.includes(type)) return [];
                const meal = day[type];
                if (!meal) return [];
                const key = `${day.day}-${type}`;
                const isSwapping = swappingKey === key;
                return (
                  <MealCard
                    key={key}
                    meal={meal}
                    type={type.charAt(0).toUpperCase() + type.slice(1)}
                    expanded={expandedMeals.has(key)}
                    onToggle={() => toggleMeal(key)}
                    animationDelay={i * MEAL_CARD_STAGGER_MS}
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
              .flatMap((d) => MEAL_TYPES.map((t) => d[t]?.estimatedCost ?? 0))
              .reduce((a, b) => a + b, 0)}
            loyaltyProgram={loyaltyProgramFor(circular?.storeName ?? null)}
          />
        </>
      )}
    </div>
  );
}
