import * as crypto from "node:crypto";
import type { UserPreferences } from "../types";

// Recursively sort object keys at every depth so re-ordered JSON hashes the same.
// Array order is preserved — for lists (e.g. dietaryRestrictions) reordering is
// intentional input. Crucially this also reaches nested objects like mealsByDay,
// whose day keys a top-level key allow-list would have silently dropped.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function computePrefsFingerprint(prefs: UserPreferences): string {
  const canonical = JSON.stringify(canonicalize(prefs));
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

// A plan is stale when its stored fingerprint is absent or no longer matches the
// fingerprint of the current preferences. A missing/non-string fingerprint counts
// as stale (e.g. plans generated before fingerprinting existed).
export function isPlanFingerprintStale(
  plan: { prefsFingerprint?: string },
  prefs: UserPreferences,
): boolean {
  return (
    typeof plan.prefsFingerprint !== "string" ||
    plan.prefsFingerprint !== computePrefsFingerprint(prefs)
  );
}
