import { useEffect, useRef, useState } from "react";
import { UploadCircular } from "./UploadCircular";
import { API } from "./apiPaths";

export interface FlippMerchant {
  flyerId: number;
  merchantId: string | number | null;
  name: string;
  validFrom: string;
  validTo: string;
  daysLeft: number;
  logoUrl: string | null;
}

interface StorePickerProps {
  onFetch: (m: FlippMerchant) => void;
  onUploadFile?: (file: File) => void;
  disabled?: boolean;
}

function formatDateRange(from: string, to: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "";
  const fmt = (d: Date) => d.toLocaleDateString(undefined, opts);
  return `${fmt(a)} - ${fmt(b)}`;
}

function expiryLabel(daysLeft: number): string {
  if (daysLeft <= 0) return "Ends today";
  if (daysLeft === 1) return "Ends in 1 day";
  return `Ends in ${daysLeft} days`;
}

export function StorePicker({ onFetch, onUploadFile, disabled }: StorePickerProps) {
  const [zip, setZip] = useState("");
  const [merchants, setMerchants] = useState<FlippMerchant[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [activeZip, setActiveZip] = useState<string | null>(null);
  const autoTriggered = useRef(false);

  // Hydrate ZIP from saved prefs and auto-fetch if present.
  useEffect(() => {
    let cancelled = false;
    fetch(API.circularPrefs)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const code = typeof data?.postalCode === "string" ? data.postalCode : "";
        if (code) {
          setZip(code);
          if (!autoTriggered.current) {
            autoTriggered.current = true;
            void runFetch(code);
          }
        }
      })
      .catch(() => {
        // No prefs is fine — user will type a ZIP.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runFetch = async (code: string) => {
    setLoading(true);
    setError(null);
    setActiveZip(code);
    try {
      const res = await fetch(API.circularFlippStores, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postalCode: code }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || "Couldn't load stores");
        setMerchants(null);
      } else {
        setMerchants(data.merchants ?? []);
      }
    } catch {
      setError("Couldn't reach the circular service. Try again or upload a PDF.");
      setMerchants(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) {
      setError("Enter a 5-digit ZIP code");
      return;
    }
    void runFetch(zip);
  };

  return (
    <div className="store-picker">
      <h2 className="store-picker__header">Find this week's deals</h2>

      <form className="store-picker__zip-form" onSubmit={handleSubmit}>
        <label className="store-picker__zip-label" htmlFor="store-picker-zip">
          ZIP code
        </label>
        <input
          id="store-picker-zip"
          className="store-picker__zip-input"
          type="text"
          inputMode="numeric"
          pattern="\d{5}"
          maxLength={5}
          autoComplete="postal-code"
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
          disabled={disabled || loading}
          aria-label="ZIP code"
        />
        <button
          type="submit"
          className="store-picker__zip-submit"
          disabled={disabled || loading || zip.length !== 5}
        >
          Find stores
        </button>
      </form>

      <div
        className={`store-picker__status ${loading ? "store-picker__status--loading" : ""} ${error ? "store-picker__status--error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {loading && `Loading stores near ${activeZip ?? zip}...`}
        {!loading && error && error}
        {!loading && !error && merchants && merchants.length > 0 && (
          <>
            {merchants.length} {merchants.length === 1 ? "store" : "stores"} near{" "}
            <span className="store-picker__tabular">{activeZip}</span>
          </>
        )}
        {!loading && !error && merchants && merchants.length === 0 && (
          <>No flyers found near {activeZip}. Double-check your ZIP or upload a PDF.</>
        )}
      </div>

      {merchants && merchants.length > 0 && (
        <ul className="store-picker__merchant-grid" aria-label="Available stores">
          {merchants.map((m) => (
            <li key={m.flyerId}>
              <button
                type="button"
                className={`merchant-card ${m.daysLeft <= 2 ? "merchant-card--expiring" : ""}`}
                onClick={() => onFetch(m)}
                disabled={disabled}
                aria-label={`Use ${m.name} circular, ${expiryLabel(m.daysLeft).toLowerCase()}`}
              >
                <span className="merchant-card__name">{m.name}</span>
                <span className="merchant-card__dates">
                  {formatDateRange(m.validFrom, m.validTo)}
                </span>
                {m.daysLeft <= 2 && (
                  <span className="merchant-card__expiry-pill">{expiryLabel(m.daysLeft)}</span>
                )}
                <span className="merchant-card__cta">Use this circular</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="store-picker__fallback">
        {!showFallback ? (
          <button
            type="button"
            className="store-picker__fallback-toggle"
            onClick={() => setShowFallback(true)}
            disabled={disabled}
          >
            Or upload a PDF instead
          </button>
        ) : (
          onUploadFile && (
            <UploadCircular variant="empty" onFile={onUploadFile} disabled={disabled} />
          )
        )}
      </div>
    </div>
  );
}
