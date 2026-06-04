import { useState } from "react";

interface PlanWithoutCircularProps {
  onSubmit: (storeName: string) => void;
  disabled?: boolean;
}

// For stores that don't publish a circular (e.g. Trader Joe's). Builds a plan
// from saved preferences alone. The store name is optional — it just labels the
// plan banner.
export function PlanWithoutCircular({ onSubmit, disabled }: PlanWithoutCircularProps) {
  const [storeName, setStoreName] = useState("");

  return (
    <div className="plan-without-circular">
      <h3 className="plan-without-circular__title">No circular?</h3>
      <p className="plan-without-circular__hint">
        Plan from your preferences instead — handy for stores like Trader Joe's
        that don't run sales.
      </p>
      <div className="plan-without-circular__form">
        <label className="plan-without-circular__label">
          Store name (optional)
          <input
            type="text"
            className="plan-without-circular__input"
            placeholder="Trader Joe's"
            value={storeName}
            maxLength={100}
            disabled={disabled}
            onChange={(e) => setStoreName(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="plan-without-circular__submit"
          onClick={() => onSubmit(storeName)}
          disabled={disabled}
        >
          Plan from preferences only
        </button>
      </div>
    </div>
  );
}
