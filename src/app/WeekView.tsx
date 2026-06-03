import { Fragment } from "react";
import type { DayPlan, MealType } from "../../types";
import { MEAL_TYPES, DAYS_OF_WEEK } from "../../types";
import { WeekGridCell } from "./WeekGridCell";

interface WeekViewProps {
  weekPlan: DayPlan[];
  pickedUp: { day: string; mealType: MealType } | null;
  movingPair: { from: string; to: string; mealType: MealType } | null;
  // True when a move is in flight or the plan is stale — cells render read-only.
  interactionDisabled: boolean;
  statusMessage: string | null;
  moveError: string | null;
  onCellActivate: (day: string, mealType: MealType) => void;
  onCellPick: (day: string, mealType: MealType) => void;
  onCellDrop: (day: string, mealType: MealType) => void;
  onCellDragEnd: () => void;
}

function dayOrder(day: string): number {
  const i = (DAYS_OF_WEEK as readonly string[]).indexOf(day.toLowerCase());
  return i === -1 ? DAYS_OF_WEEK.length : i;
}

function dayShort(day: string): string {
  return day.charAt(0).toUpperCase() + day.slice(1, 3).toLowerCase();
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function WeekView({
  weekPlan,
  pickedUp,
  movingPair,
  interactionDisabled,
  statusMessage,
  moveError,
  onCellActivate,
  onCellPick,
  onCellDrop,
  onCellDragEnd,
}: WeekViewProps) {
  const days = [...weekPlan].sort((a, b) => dayOrder(a.day) - dayOrder(b.day));

  return (
    <section className="week-view" aria-label="Week at a glance">
      <div className="week-view__grid">
        <div className="week-view__corner" aria-hidden="true" />
        {MEAL_TYPES.map((type) => (
          <div key={type} className="week-view__col-head">
            {capitalize(type)}
          </div>
        ))}

        {days.map((d) => (
          <Fragment key={d.day}>
            <div className="week-view__row-head">{dayShort(d.day)}</div>
            {MEAL_TYPES.map((type) => {
              const meal = d[type];
              const isPickedUp =
                !!pickedUp && pickedUp.day === d.day && pickedUp.mealType === type;
              const isValidTarget =
                !!pickedUp && pickedUp.mealType === type && pickedUp.day !== d.day;
              const moving =
                !!movingPair &&
                movingPair.mealType === type &&
                (movingPair.from === d.day || movingPair.to === d.day);
              return (
                <WeekGridCell
                  key={`${d.day}-${type}`}
                  day={d.day}
                  mealType={type}
                  meal={meal}
                  isPickedUp={isPickedUp}
                  isValidTarget={isValidTarget}
                  moving={moving}
                  interactionDisabled={interactionDisabled}
                  onActivate={() => onCellActivate(d.day, type)}
                  onPick={() => onCellPick(d.day, type)}
                  onDrop={() => onCellDrop(d.day, type)}
                  onDragEnd={onCellDragEnd}
                />
              );
            })}
          </Fragment>
        ))}
      </div>

      <p className="week-view__hint">
        Drag a meal to another day, or tap one to pick it up and tap where it should go.
      </p>

      <div className="week-view__status" role="status" aria-live="polite">
        {statusMessage}
      </div>
      {moveError && (
        <div className="week-view__error" role="alert">
          {moveError}
        </div>
      )}
    </section>
  );
}
