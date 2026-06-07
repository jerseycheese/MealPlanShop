import { useEffect, useMemo, useRef, useState } from "react";
import type { UserPreferences, MealType, DayOfWeek } from "../../types";
import { MEAL_TYPES, DAYS_OF_WEEK } from "../../types";
import {
  findExcludedPantryConflicts,
  findExcludedUseUpConflicts,
} from "./preferenceConflicts";
import { API } from "./endpoints";
import { fetchJson } from "./fetchJson";
import { ApiKeyEntry } from "./ApiKeyEntry";

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
  const importInputRef = useRef<HTMLInputElement>(null);
  const initialFocused = useRef(false);
  const pantryConflicts = useMemo(
    () =>
      prefs
        ? findExcludedPantryConflicts(
            prefs.excludedIngredients,
            prefs.pantryStaples,
          )
        : [],
    [prefs],
  );
  const useUpConflicts = useMemo(
    () =>
      prefs
        ? findExcludedUseUpConflicts(
            prefs.excludedIngredients,
            prefs.useUpIngredients,
          )
        : [],
    [prefs],
  );
  const hasConflicts = pantryConflicts.length > 0 || useUpConflicts.length > 0;
  const conflictMessages = [
    conflictMessage(pantryConflicts, "pantry staples"),
    conflictMessage(useUpConflicts, "use-it-up ingredients"),
  ].filter((m): m is string => m !== null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ preferences: UserPreferences }>(API.preferences)
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
      const res = await fetch(API.preferences, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      });
      if (!res.ok && res.status >= 500) {
        throw new Error(`preferences save failed: ${res.status}`);
      }
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

  // Download the current preferences as JSON — a portable backup that survives
  // checkout churn and seeds a fresh machine (issue #91).
  const handleExport = () => {
    if (!prefs) return;
    const blob = new Blob([JSON.stringify(prefs, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mealplanshop-preferences.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Restore preferences from an uploaded JSON file. Routed through the same
  // PUT /api/preferences as Save, so the server validates it and a bad file
  // surfaces the same way a bad form would.
  const handleImportFile = async (file: File) => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("That file isn't valid JSON.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(API.preferences, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || "Couldn't import those preferences.");
        return;
      }
      onSaved(data.preferences);
    } catch {
      setError("Couldn't import those preferences.");
    } finally {
      setSaving(false);
    }
  };

  // Toggle one meal for one day. Keeps each day's list in MEAL_TYPES order, and
  // drops the day key entirely once its last meal is unchecked (empty = unplanned).
  const toggleDayMeal = (day: DayOfWeek, meal: MealType) => {
    if (!prefs) return;
    const current = prefs.mealsByDay[day] ?? [];
    const nextMeals = current.includes(meal)
      ? current.filter((m) => m !== meal)
      : MEAL_TYPES.filter((m) => m === meal || current.includes(m));
    const nextMap = { ...prefs.mealsByDay };
    if (nextMeals.length > 0) nextMap[day] = nextMeals;
    else delete nextMap[day];
    setPrefs({ ...prefs, mealsByDay: nextMap });
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

            <div className="preferences-modal__field preferences-modal__field--active-time">
              <label
                htmlFor="pref-active-time"
                className="preferences-modal__label"
              >
                Max active time per meal (min)
              </label>
              <input
                id="pref-active-time"
                type="number"
                min={0}
                max={240}
                placeholder="No limit"
                value={prefs.maxActiveTime ?? ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPrefs({
                    ...prefs,
                    maxActiveTime: Number.isFinite(v) && v > 0 ? v : undefined,
                  });
                }}
                className="preferences-modal__number preferences-modal__number--active-time"
              />
              <p className="preferences-modal__hint">
                Caps each meal's hands-on time. Leave blank for no limit.
              </p>
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

            <ChipField
              label="Use these up (already on hand)"
              hint="e.g. spinach, rotisserie chicken, zucchini — perishables to build this week's meals around"
              values={prefs.useUpIngredients}
              onChange={(next) =>
                setPrefs({ ...prefs, useUpIngredients: next })
              }
            />
            {hasConflicts && (
              <div
                id={conflictId}
                className="preferences-modal__error"
                role="alert"
              >
                {conflictMessages.map((m) => (
                  <p key={m} className="preferences-modal__error-line">
                    {m}
                  </p>
                ))}
              </div>
            )}

            <fieldset className="preferences-modal__field preferences-modal__field--daymeals">
              <legend className="preferences-modal__label">Meals per day</legend>
              <div className="day-meals">
                {DAYS_OF_WEEK.map((day) => {
                  const meals = prefs.mealsByDay[day] ?? [];
                  return (
                    <div key={day} className="day-meals__row">
                      <span className="day-meals__day">{day}</span>
                      <div className="preferences-modal__checkrow day-meals__meals">
                        {MEAL_TYPES.map((meal) => (
                          <label key={meal} className="preferences-modal__check">
                            <input
                              type="checkbox"
                              checked={meals.includes(meal)}
                              onChange={() => toggleDayMeal(day, meal)}
                            />
                            {meal}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="preferences-modal__field preferences-modal__field--notes">
              <label htmlFor="pref-notes" className="preferences-modal__label">
                Notes / special instructions
              </label>
              <textarea
                id="pref-notes"
                className="preferences-modal__notes"
                rows={3}
                placeholder="e.g. cook dinners double for leftovers; keep lunches mild"
                value={prefs.notes ?? ""}
                onChange={(e) => setPrefs({ ...prefs, notes: e.target.value })}
              />
              <p className="preferences-modal__hint">
                Free-form. Gets added to the plan so one-off requests the fields
                above can't capture still get honored.
              </p>
            </div>

            <div className="preferences-modal__field preferences-modal__field--apikey">
              <span className="preferences-modal__label">Gemini API key</span>
              <ApiKeyEntry />
            </div>

            <div className="preferences-modal__backup">
              <span className="preferences-modal__backup-label">Backup</span>
              <button
                type="button"
                className="preferences-modal__backup-btn"
                onClick={handleExport}
                disabled={!prefs || saving || regenerating}
              >
                Export
              </button>
              <button
                type="button"
                className="preferences-modal__backup-btn"
                onClick={() => importInputRef.current?.click()}
                disabled={saving || regenerating}
              >
                Import
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="preferences-modal__import-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                  e.target.value = "";
                }}
              />
            </div>
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

function conflictMessage(conflicts: string[], listLabel: string): string | null {
  if (conflicts.length === 0) return null;
  return conflicts.length === 1
    ? `${conflicts[0]} is in both excluded ingredients and ${listLabel}. Remove it from one list before saving.`
    : `${conflicts.join(", ")} are in both excluded ingredients and ${listLabel}. Remove them from one list before saving.`;
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
