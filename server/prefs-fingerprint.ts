import * as crypto from "node:crypto";
import type { UserPreferences } from "../types";

export function computePrefsFingerprint(prefs: UserPreferences): string {
  // Sort top-level keys so re-ordered JSON produces the same hash. List values
  // (e.g. dietaryRestrictions) keep their order — reordering is intentional input.
  const canonical = JSON.stringify(prefs, Object.keys(prefs).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
