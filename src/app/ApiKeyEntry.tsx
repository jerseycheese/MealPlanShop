import { useEffect, useState } from "react";
import { API } from "./endpoints";
import { fetchJson } from "./fetchJson";

const KEY_PAGE_URL = "https://aistudio.google.com/apikey";

interface ApiKeyEntryProps {
  // Fired after the stored key changes (saved or cleared), and once on initial
  // load, so a parent can flip out of its first-run gate.
  onChange?: (hasKey: boolean) => void;
}

// Paste / replace / clear the Gemini API key. Self-contained: fetches its own
// masked status, so it drops into both the first-run gate and the Preferences
// modal unchanged. The raw key only ever travels up to the server — what comes
// back is always masked.
export function ApiKeyEntry({ onChange }: ApiKeyEntryProps) {
  const [masked, setMasked] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ hasKey?: boolean; masked?: unknown }>(API.secretsStatus)
      .then((data) => {
        if (cancelled) return;
        setMasked(typeof data.masked === "string" ? data.masked : null);
        onChange?.(!!data.hasKey);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load key status.");
      });
    return () => {
      cancelled = true;
    };
    // Run once on mount — onChange is only used to report the initial state here.
  }, []);

  const handleSave = async () => {
    const key = draft.trim();
    if (!key) {
      setError("Paste a key first.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(API.secrets, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ geminiApiKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || "Couldn't save the key.");
        return;
      }
      setMasked(typeof data.masked === "string" ? data.masked : null);
      setDraft("");
      setSaved(true);
      onChange?.(true);
    } catch {
      setError("Couldn't save the key.");
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(API.secrets, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || "Couldn't clear the key.");
        return;
      }
      // The server reports the effective status after clearing — a GEMINI_API_KEY
      // in the env stays in effect, so don't assume the key is gone.
      setMasked(typeof data.masked === "string" ? data.masked : null);
      onChange?.(!!data.hasKey);
    } catch {
      setError("Couldn't clear the key.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="api-key-entry">
      {masked && (
        <div className="api-key-entry__current">
          <span className="api-key-entry__current-label">Current key</span>
          <code className="api-key-entry__masked">{masked}</code>
          <button
            type="button"
            className="api-key-entry__clear"
            onClick={handleClear}
            disabled={busy}
          >
            Clear
          </button>
        </div>
      )}
      <div className="api-key-entry__row">
        <input
          type="password"
          className="api-key-entry__input"
          placeholder={
            masked ? "Paste a new key to replace it" : "Paste your Gemini API key"
          }
          value={draft}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
          }}
          disabled={busy}
        />
        <button
          type="button"
          className="api-key-entry__save"
          onClick={handleSave}
          disabled={busy || !draft.trim()}
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      <p className="api-key-entry__hint">
        Get a free key at{" "}
        <a href={KEY_PAGE_URL} target="_blank" rel="noreferrer">
          aistudio.google.com/apikey
        </a>
        . Stored locally on this machine, never uploaded.
      </p>
      {saved && <p className="api-key-entry__saved">Key saved.</p>}
      {error && <p className="api-key-entry__error">{error}</p>}
    </div>
  );
}
