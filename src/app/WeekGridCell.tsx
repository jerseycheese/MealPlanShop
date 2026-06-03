import type { DragEvent } from "react";
import type { Meal, MealType } from "../../types";

interface WeekGridCellProps {
  day: string;
  mealType: MealType;
  meal: Meal | undefined;
  isPickedUp: boolean;
  isValidTarget: boolean;
  moving: boolean;
  // True when a move is in flight or the plan is stale — show the cell but don't
  // let it be dragged or tapped.
  interactionDisabled: boolean;
  onActivate: () => void; // tap / click / keyboard (Enter, Space)
  onPick: () => void; // native drag started on this cell
  onDrop: () => void; // a valid drag was dropped on this cell
  onDragEnd: () => void; // drag finished (dropped or aborted)
}

export function WeekGridCell({
  day,
  mealType,
  meal,
  isPickedUp,
  isValidTarget,
  moving,
  interactionDisabled,
  onActivate,
  onPick,
  onDrop,
  onDragEnd,
}: WeekGridCellProps) {
  const hasMeal = Boolean(meal);
  const onSale = Boolean(meal?.ingredients.some((i) => i.onSale));

  // Busy/stale: render the meal (or an empty marker) with no interaction.
  if (interactionDisabled) {
    return (
      <div
        className={`week-grid-cell week-grid-cell--static ${hasMeal ? "" : "week-grid-cell--empty"}`}
      >
        {hasMeal ? (
          <span className="week-grid-cell__name">{meal!.name}</span>
        ) : (
          <span className="week-grid-cell__dash" aria-hidden="true">
            —
          </span>
        )}
      </div>
    );
  }

  const handleDragOver = (e: DragEvent) => {
    if (!isValidTarget) return; // not a valid drop -> let the browser show no-drop
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  if (hasMeal) {
    const label = isPickedUp
      ? `${mealType} on ${day}: ${meal!.name}. Picked up. Press to cancel.`
      : isValidTarget
        ? `${mealType} on ${day}: ${meal!.name}. Press to swap here.`
        : `${mealType} on ${day}: ${meal!.name}. Press to pick up and move.`;
    return (
      <button
        type="button"
        className={`week-grid-cell week-grid-cell--filled${
          isPickedUp ? " week-grid-cell--lifted" : ""
        }${isValidTarget ? " week-grid-cell--target" : ""}${
          moving ? " week-grid-cell--moving" : ""
        }`}
        draggable
        aria-pressed={isPickedUp}
        aria-busy={moving}
        aria-label={label}
        onClick={onActivate}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", `${day}|${mealType}`);
          e.dataTransfer.effectAllowed = "move";
          onPick();
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDrop={(e) => {
          if (!isValidTarget) return;
          e.preventDefault();
          onDrop();
        }}
      >
        <span className="week-grid-cell__name">{meal!.name}</span>
        {onSale && <span className="week-grid-cell__sale-dot" aria-hidden="true" />}
      </button>
    );
  }

  // Empty slot: only interactive while it's a valid drop target for the picked meal.
  return (
    <button
      type="button"
      className={`week-grid-cell week-grid-cell--empty${
        isValidTarget ? " week-grid-cell--target" : ""
      }`}
      disabled={!isValidTarget}
      aria-label={
        isValidTarget
          ? `Empty ${mealType} on ${day}. Press to move here.`
          : `Empty ${mealType} on ${day}.`
      }
      onClick={onActivate}
      onDragOver={handleDragOver}
      onDrop={(e) => {
        if (!isValidTarget) return;
        e.preventDefault();
        onDrop();
      }}
    >
      <span className="week-grid-cell__dash" aria-hidden="true">
        {isValidTarget ? "+" : "—"}
      </span>
    </button>
  );
}
