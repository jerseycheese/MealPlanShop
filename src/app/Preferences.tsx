import { useEffect, useRef, useState } from "react";
import type { UserPreferences } from "../../types";

const MEAL_TYPES = ["breakfast", "lunch", "dinner"] as const;
type MealType = (typeof MEAL_TYPES)[number];

interface PreferencesProps {
  onClose: () => void;
  onSaved: (prefs: UserPreferences) => void;
}

export function Preferences({ onClose, onSaved }: PreferencesProps) {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = "preferences-title";
  const householdRef = useRef<HTMLInputElement>(null);
  const initialFocused = useRef(false);

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

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
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
      onSaved(data.preferences);
    } catch {
      setError("Couldn't save");
    } finally {
      setSaving(false);
    }
  };

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
              label="Dietary restrictions"
              hint="e.g. low carb, gluten-free, no shellfish"
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
              hint="e.g. olive oil, garlic, salt, eggs"
              values={prefs.pantryStaples}
              onChange={(next) =>
                setPrefs({ ...prefs, pantryStaples: next })
              }
            />

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
          </>
        )}

        {error && <div className="preferences-modal__error">{error}</div>}

        <div className="preferences-modal__actions">
          <button
            type="button"
            className="preferences-modal__cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="preferences-modal__save"
            onClick={handleSave}
            disabled={!prefs || saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
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
