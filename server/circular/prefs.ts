import * as fs from "node:fs";
import * as path from "node:path";
import { readJsonOrNull, writeJsonAtomic } from "../lib/jsonStore";

const PREFS_PATH = path.join(__dirname, "../../output/circular-prefs.json");

export interface CircularPrefs {
  postalCode: string | null;
  lastMerchantId: number | null;
}

const EMPTY: CircularPrefs = { postalCode: null, lastMerchantId: null };

export function loadCircularPrefs(): CircularPrefs {
  const data = readJsonOrNull<Partial<CircularPrefs>>(PREFS_PATH);
  if (!data) return { ...EMPTY };
  return {
    postalCode:
      typeof data.postalCode === "string" && /^\d{5}$/.test(data.postalCode)
        ? data.postalCode
        : null,
    lastMerchantId:
      typeof data.lastMerchantId === "number" && Number.isFinite(data.lastMerchantId)
        ? data.lastMerchantId
        : null,
  };
}

export function saveCircularPrefs(patch: Partial<CircularPrefs>): CircularPrefs {
  const current = loadCircularPrefs();
  const next: CircularPrefs = {
    postalCode: patch.postalCode !== undefined ? patch.postalCode : current.postalCode,
    lastMerchantId:
      patch.lastMerchantId !== undefined ? patch.lastMerchantId : current.lastMerchantId,
  };
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
  writeJsonAtomic(PREFS_PATH, next);
  return next;
}
