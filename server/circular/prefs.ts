import * as fs from "node:fs";
import * as path from "node:path";

const PREFS_PATH = path.join(__dirname, "../../output/circular-prefs.json");

export interface CircularPrefs {
  postalCode: string | null;
  lastMerchantId: number | null;
}

const EMPTY: CircularPrefs = { postalCode: null, lastMerchantId: null };

export function loadCircularPrefs(): CircularPrefs {
  if (!fs.existsSync(PREFS_PATH)) return { ...EMPTY };
  try {
    const data = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8")) as Partial<CircularPrefs>;
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
  } catch {
    return { ...EMPTY };
  }
}

export function saveCircularPrefs(patch: Partial<CircularPrefs>): CircularPrefs {
  const current = loadCircularPrefs();
  const next: CircularPrefs = {
    postalCode: patch.postalCode !== undefined ? patch.postalCode : current.postalCode,
    lastMerchantId:
      patch.lastMerchantId !== undefined ? patch.lastMerchantId : current.lastMerchantId,
  };
  fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
  fs.writeFileSync(PREFS_PATH, JSON.stringify(next, null, 2));
  return next;
}
