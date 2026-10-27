export interface ComparedStoreRow {
  flyerId: number;
  storeName: string;
  total: number;
  saleItemsUsed: number;
  listItems: number;
  mealCount: number;
  flyerItems: number;
}

export interface StoreComparisonView {
  ranked: ComparedStoreRow[];
  skipped: { flyerId: number; storeName: string; reason: string }[];
}

interface StoreCompareProps {
  comparison: StoreComparisonView;
  onUse: (flyerId: number) => void;
  onDismiss: () => void;
  disabled?: boolean;
}

export function StoreCompare({
  comparison,
  onUse,
  onDismiss,
  disabled,
}: StoreCompareProps) {
  return (
    <section className="store-compare" aria-label="Store comparison">
      <div className="store-compare__header">
        <h2 className="store-compare__title">Cheapest store this week</h2>
        <button
          type="button"
          className="store-compare__dismiss"
          onClick={onDismiss}
          disabled={disabled}
        >
          Close
        </button>
      </div>
      <p className="store-compare__note">
        Totals are Gemini's estimates and lean on what's on sale, so treat close
        ones as a tie.
      </p>
      {comparison.ranked.length === 0 ? (
        <p className="store-compare__empty">
          None of the stores could be ranked. The reasons are below.
        </p>
      ) : (
        <div className="store-compare__scroll">
          <table className="store-compare__table">
            <thead>
              <tr>
                <th scope="col">Store</th>
                <th scope="col">Est. total</th>
                <th scope="col">Sale items used</th>
                <th scope="col">Meals</th>
                <th scope="col" aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {comparison.ranked.map((s) => (
                <tr key={s.flyerId}>
                  <th scope="row">{s.storeName}</th>
                  <td>${s.total.toFixed(2)}</td>
                  <td>
                    {s.saleItemsUsed}/{s.listItems}
                  </td>
                  <td>{s.mealCount}</td>
                  <td>
                    <button
                      type="button"
                      className="store-compare__use"
                      onClick={() => onUse(s.flyerId)}
                      disabled={disabled}
                    >
                      Use this store
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {comparison.skipped.length > 0 && (
        <ul className="store-compare__skipped">
          {comparison.skipped.map((s) => (
            <li key={s.flyerId}>
              Skipped {s.storeName}: {s.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
