import { useEffect, useMemo, useRef, useState } from "react";
import type { UserPreferences } from "../../types";
import { findExcludedPantryConflicts } from "./preferenceConflicts";

const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
type MealType = (typeof MEAL_TYPES)[number];

const DAYS_OF_WEEK = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

interface PreferencesProps {
  onClose: () => void;
  onSaved: (prefs: UserPreferences, opts?: { regenerate?: boolean }) => void;
  canRegenerate?: boolean;
}

export function Preferences({ onClose, onSaved, canRegenerate = false }: PreferencesProps) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = "preferences-title";
  const conflictId = "preferences-conflicts";
  const householdRef = useRef<HTMLInputElement>(null);
  const initialFocused = useRef(false);
  const conflicts = useMemo(
    () =>
      prefs
        ? findExcludedPantryConflicts(
            prefs.excludedIngredients,
            prefs.pantryStaples,
          )
        : [],
    [prefs],
  );
  const hasConflicts = conflicts.length > 0;
  const conflictText =
    conflicts.length === 1
      ? `${conflicts[0]} is in both excluded ingredients and pantry staples. Remove it from one list before saving.`
      : `${conflicts.join(", ")} are in both excluded ingredients and pantry staples. Remove them from one list before saving.`;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/preferences")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setPrefs(data.preferences);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load preferences");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (prefs && !initialFocused.current && householdRef.current) {
      householdRef.current.focus();
      householdRef.current.select();
      initialFocused.current = true;
    }
  }, [prefs]);

  const persistAnd = async (opts: { regenerate: boolean }) => {
    if (!prefs) return;
    if (hasConflicts) {
      setError("Resolve preference conflicts before saving.");
      return;
    }
    if (opts.regenerate) setRegenerating(true);
    else setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Couldn't save");
        return;
      }
      onSaved(data.preferences, { regenerate: opts.regenerate });
    } catch {
      setError("Couldn't save");
    } finally {
      setSaving(false);
      setRegenerating(false);
    }
  };

  const handleSave = () => persistAnd({ regenerate: false });
  const handleSaveAndRegenerate = () => persistAnd({ regenerate: true });

  const toggleMeal = (meal: MealType) => {
    if (!prefs) return;
    const has = prefs.mealsPerDay.includes(meal);
    setPrefs({
      ...prefs,
      mealsPerDay: has
        ? prefs.mealsPerDay.filter((m) => m !== meal)
        : [...prefs.mealsPerDay, meal],
    });
  };

  const toggleDay = (day: DayOfWeek) => {
    if (!prefs) return;
    const has = prefs.daysOfWeek.includes(day);
    const next = has
      ? prefs.daysOfWeek.filter((d) => d !== day)
      : [...prefs.daysOfWeek, day];
    next.sort(
      (a, b) => DAYS_OF_WEEK.indexOf(a as DayOfWeek) - DAYS_OF_WEEK.indexOf(b as DayOfWeek)
    );
    setPrefs({ ...prefs, daysOfWeek: next });
  };

  return (
    <div
      className="preferences-modal__backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="preferences-modal__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="preferences-modal__title">
          Preferences
        </h2>
        <p className="preferences-modal__subtitle">
          These shape every meal plan. Save, then hit Regenerate to apply.
        </p>

        {!prefs ? (
          <div className="preferences-modal__loading">Loading...</div>
        ) : (
          <>
            <div className="preferences-modal__field">
              <label
                htmlFor="pref-household"
                className="preferences-modal__label"
              >
                Household size
              </label>
              <input
                ref={householdRef}
                id="pref-household"
                type="number"
                min={1}
                max={20}
                value={prefs.householdSize}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    householdSize: Number(e.target.value) || 1,
                  })
                }
                className="preferences-modal__number"
              />
            </div>

            <ChipField
              label="Dietary preferences"
              hint="e.g. low carb, organic, gluten-free, vegetarian"
              values={prefs.dietaryRestrictions}
              onChange={(next) =>
                setPrefs({ ...prefs, dietaryRestrictions: next })
              }
            />

            <ChipField
              label="Cuisine preferences"
              hint="e.g. Italian, Thai, Mexican"
              values={prefs.cuisinePreferences}
              onChange={(next) =>
                setPrefs({ ...prefs, cuisinePreferences: next })
              }
            />

            <ChipField
              label="Excluded ingredients"
              hint="e.g. seafood, shrimp, mushrooms"
              values={prefs.excludedIngredients}
              onChange={(next) =>
                setPrefs({ ...prefs, excludedIngredients: next })
              }
            />

            <ChipField
              label="Pantry staples (already on hand)"
              hint="e.g. olive oil, salt, cumin, paprika, oregano — anything you don't want on the shopping list"
              values={prefs.pantryStaples}
              onChange={(next) =>
                setPrefs({ ...prefs, pantryStaples: next })
              }
            />
            {hasConflicts && (
              <div
                id={conflictId}
                className="preferences-modal__error"
                role="alert"
              >
                {conflictText}
              </div>
            )}

            <fieldset className="preferences-modal__field">
              <legend className="preferences-modal__label">Meals per day</legend>
              <div className="preferences-modal__checkrow">
                {MEAL_TYPES.map((meal) => (
                  <label key={meal} className="preferences-modal__check">
                    <input
                      type="checkbox"
                      checked={prefs.mealsPerDay.includes(meal)}
                      onChange={() => toggleMeal(meal)}
                    />
                    {meal}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="preferences-modal__field preferences-modal__field--days">
              <legend className="preferences-modal__label">Days to plan</legend>
              <div className="preferences-modal__checkrow">
                {DAYS_OF_WEEK.map((day) => (
                  <label key={day} className="preferences-modal__check">
                    <input
                      type="checkbox"
                      checked={prefs.daysOfWeek.includes(day)}
                      onChange={() => toggleDay(day)}
                    />
                    {day}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}

        {error && <div className="preferences-modal__error">{error}</div>}

        <div className="preferences-modal__actions">
          <button
            type="button"
            className="preferences-modal__cancel"
            onClick={onClose}
            disabled={saving || regenerating}
          >
            Cancel
          </button>
          <button
            type="button"
            className="preferences-modal__save"
            onClick={handleSave}
            disabled={!prefs || saving || regenerating || hasConflicts}
            aria-describedby={hasConflicts ? conflictId : undefined}
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {canRegenerate && (
            <button
              type="button"
              className="preferences-modal__regenerate"
              onClick={handleSaveAndRegenerate}
              disabled={!prefs || saving || regenerating || hasConflicts}
              aria-describedby={hasConflicts ? conflictId : undefined}
            >
              {regenerating ? "Regenerating..." : "Save & Regenerate"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface ChipFieldProps {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}

function ChipField({ label, hint, values, onChange }: ChipFieldProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const exists = values.some(
      (v) => v.toLowerCase() === trimmed.toLowerCase()
    );
    if (!exists) onChange([...values, trimmed]);
    setDraft("");
  };

  return (
    <div className="preferences-modal__field">
      <label className="preferences-modal__label">{label}</label>
      <div className="preferences-modal__chips">
        {values.map((v, i) => (
          <span key={`${v}-${i}`} className="preferences-modal__chip">
            {v}
            <button
              type="button"
              className="preferences-modal__chip-remove"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="preferences-modal__chip-input"
          value={draft}
          placeholder={values.length === 0 ? hint : "Add another..."}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (
              e.key === "Backspace" &&
              draft === "" &&
              values.length > 0
            ) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}
