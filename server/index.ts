import express from "express";
import multer from "multer";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { scanCircular } from "../scripts/scan-circular";
import {
  generateMealPlan,
  generateMealSwap,
  DEFAULT_PREFERENCES,
} from "../scripts/generate-meal-plan";
import {
  computePrefsFingerprint,
  isPlanFingerprintStale,
} from "./prefs-fingerprint";
import { mergeShoppingListAfterSwap } from "./mergeShoppingList";
import type {
  MealPlanResult,
  UserPreferences,
  ExtractionResult,
  ScanProgress,
} from "../types";
import { MEAL_TYPES, DAYS_OF_WEEK } from "../types";
import { listFlyers, fetchFlyer } from "./circular/sources/flipp";
import { loadCircularPrefs, saveCircularPrefs } from "./circular/prefs";

const app = express();
const PORT = parseInt(process.env.API_PORT ?? process.env.PORT ?? "3101", 10);
const PROJECT_ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");
const MEAL_PLAN_PATH = path.join(OUTPUT_DIR, "meal-plan.json");
const EXTRACTION_PATH = path.join(OUTPUT_DIR, "extraction.json");
const PREFERENCES_PATH = path.join(OUTPUT_DIR, "preferences.json");
const SHOPPING_LIST_STATE_PATH = path.join(OUTPUT_DIR, "shopping-list-state.json");
const FLIPP_CACHE_DIR = path.join(OUTPUT_DIR, "flipp-cache");
const VALID_MEAL_TYPES = new Set<string>(MEAL_TYPES);
const VALID_DAYS_OF_WEEK = new Set<string>(DAYS_OF_WEEK);
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LEN = 40;
const MAX_CHECKED_KEYS = 500;
const MAX_KEY_LEN = 200;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

let processing = false;
let scanProgress: ScanProgress = { stage: "idle" };

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function readJsonOrNull<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

// Serialize routes that mutate output/ — concurrent runs would race on file
// writes and the shared scanProgress state.
function withSerial(
  handler: (req: express.Request, res: express.Response) => Promise<void>,
): (req: express.Request, res: express.Response) => Promise<void> {
  return async (req, res) => {
    if (processing) {
      res.status(409).json({ success: false, error: "Already processing a request" });
      return;
    }
    processing = true;
    try {
      await handler(req, res);
    } finally {
      processing = false;
    }
  };
}

class ValidationError extends Error {}

function validateStringArray(
  key: string,
  value: unknown,
  opts: { maxItems: number; maxLen: number },
): string[] {
  if (!Array.isArray(value)) throw new ValidationError(`${key} must be an array`);
  if (value.length > opts.maxItems) {
    throw new ValidationError(`${key} can have at most ${opts.maxItems} entries`);
  }
  const cleaned: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") throw new ValidationError(`${key} entries must be strings`);
    const trimmed = v.trim();
    if (!trimmed) throw new ValidationError(`${key} entries cannot be empty`);
    if (trimmed.length > opts.maxLen) {
      throw new ValidationError(`${key} entries must be ${opts.maxLen} chars or fewer`);
    }
    cleaned.push(trimmed);
  }
  return cleaned;
}

// Validates an enum array (mealsPerDay, daysOfWeek) and dedupes preserving
// first-seen order. `normalize` lets daysOfWeek lowercase-trim before checking.
function validateEnumArray(
  key: string,
  value: unknown,
  allowed: Set<string>,
  invalidMsg: string,
  normalize: (s: string) => string = (s) => s,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${key} must include at least one entry`);
  }
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string") throw new ValidationError(`${key} entries must be strings`);
    const normalized = normalize(v);
    if (!allowed.has(normalized)) throw new ValidationError(invalidMsg);
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

// Shared write-extraction → generate-meal-plan → write-meal-plan path used by
// both the PDF upload route and the Flipp fetch route. Returns the meal plan
// item count + storeName so the route can shape its JSON response.
async function runScanAndPlan(
  extraction: ExtractionResult,
): Promise<{ itemCount: number; storeName: string | null }> {
  if (extraction.items.length === 0) {
    const err = new Error("No sale items extracted from this circular.");
    (err as Error & { statusCode?: number }).statusCode = 422;
    throw err;
  }
  ensureOutputDir();
  fs.writeFileSync(EXTRACTION_PATH, JSON.stringify(extraction, null, 2));

  scanProgress = { stage: "planning" };
  const prefs = loadPreferences();
  const mealPlan = await generateMealPlan(extraction.items, prefs);

  // Post-hoc join: propagate the loyalty-card flag from sale items to shopping
  // list rows by name match. The meal plan prompt doesn't know about it; doing
  // it here keeps the prompt unchanged.
  const loyaltyByName = new Map<string, boolean>();
  for (const item of extraction.items) {
    if (item.requiresLoyaltyCard) loyaltyByName.set(item.item.toLowerCase(), true);
  }
  if (loyaltyByName.size && Array.isArray(mealPlan.shoppingList)) {
    for (const row of mealPlan.shoppingList) {
      const rowName = row.name.toLowerCase();
      for (const [saleName] of loyaltyByName) {
        if (rowName.includes(saleName) || saleName.includes(rowName)) {
          row.requiresLoyaltyCard = true;
          break;
        }
      }
    }
  }

  const stamped = {
    ...mealPlan,
    planId: crypto.randomUUID(),
    prefsFingerprint: computePrefsFingerprint(prefs),
  };
  fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(stamped, null, 2));
  clearShoppingListState();

  return { itemCount: extraction.items.length, storeName: extraction.storeName };
}

function readFlippCache(flyerId: number): ExtractionResult | null {
  const data = readJsonOrNull<ExtractionResult>(
    path.join(FLIPP_CACHE_DIR, `${flyerId}.json`),
  );
  if (!data) return null;
  if (data.validThrough) {
    const end = new Date(data.validThrough).getTime();
    if (Number.isFinite(end) && Date.now() > end) return null;
  }
  return { items: data.items, storeName: data.storeName, validThrough: data.validThrough };
}

function writeFlippCache(flyerId: number, result: ExtractionResult) {
  fs.mkdirSync(FLIPP_CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(FLIPP_CACHE_DIR, `${flyerId}.json`),
    JSON.stringify({ ...result, _cachedAt: Date.now() }, null, 2),
  );
}

function clearShoppingListState() {
  if (fs.existsSync(SHOPPING_LIST_STATE_PATH)) {
    try {
      fs.unlinkSync(SHOPPING_LIST_STATE_PATH);
    } catch {
      // best-effort
    }
  }
}

function loadPreferences(): UserPreferences {
  const parsed = readJsonOrNull<Partial<UserPreferences>>(PREFERENCES_PATH);
  return parsed ? { ...DEFAULT_PREFERENCES, ...parsed } : DEFAULT_PREFERENCES;
}

function validatePreferences(input: unknown): UserPreferences {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Body must be a JSON object");
  }
  const p = input as Record<string, unknown>;

  const size = p.householdSize;
  if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > 20) {
    throw new ValidationError("householdSize must be an integer between 1 and 20");
  }

  const listOpts = { maxItems: MAX_LIST_ITEMS, maxLen: MAX_LIST_ITEM_LEN };
  const dietary = validateStringArray("dietaryRestrictions", p.dietaryRestrictions, listOpts);
  const cuisine = validateStringArray("cuisinePreferences", p.cuisinePreferences, listOpts);
  const excluded = validateStringArray("excludedIngredients", p.excludedIngredients, listOpts);
  const pantry = validateStringArray("pantryStaples", p.pantryStaples, listOpts);

  const pantryLower = new Set(pantry.map((s) => s.toLowerCase()));
  const conflicts = excluded.filter((s) => pantryLower.has(s.toLowerCase()));
  if (conflicts.length > 0) {
    throw new ValidationError(
      `Cannot have the same ingredient in both excluded ingredients and pantry staples: ${conflicts.join(", ")}`,
    );
  }

  const meals = validateEnumArray(
    "mealsPerDay",
    p.mealsPerDay,
    VALID_MEAL_TYPES,
    "mealsPerDay entries must be 'breakfast', 'lunch', or 'dinner'",
  );
  const days = validateEnumArray(
    "daysOfWeek",
    p.daysOfWeek,
    VALID_DAYS_OF_WEEK,
    "daysOfWeek entries must be lowercase day names (monday-sunday)",
    (s) => s.trim().toLowerCase(),
  );

  return {
    householdSize: size as number,
    dietaryRestrictions: dietary,
    cuisinePreferences: cuisine,
    excludedIngredients: excluded,
    pantryStaples: pantry,
    mealsPerDay: meals,
    daysOfWeek: days,
  };
}

app.use(express.json());

app.get("/api/preferences", (_req, res) => {
  res.json({ preferences: loadPreferences() });
});

app.put("/api/preferences", (req, res) => {
  try {
    const result = validatePreferences(req.body);
    ensureOutputDir();
    fs.writeFileSync(PREFERENCES_PATH, JSON.stringify(result, null, 2));
    res.json({ success: true, preferences: result });
  } catch (err) {
    if (err instanceof ValidationError) {
      res.status(400).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to save preferences",
    });
  }
});

app.get("/api/shopping-list-state", (_req, res) => {
  const parsed = readJsonOrNull<{ planId?: unknown; checkedKeys?: unknown }>(
    SHOPPING_LIST_STATE_PATH,
  );
  if (!parsed) {
    res.json({ planId: null, checkedKeys: [] });
    return;
  }
  const planId = typeof parsed.planId === "string" ? parsed.planId : null;
  const checkedKeys = Array.isArray(parsed.checkedKeys)
    ? parsed.checkedKeys.filter((k: unknown) => typeof k === "string")
    : [];
  res.json({ planId, checkedKeys });
});

app.put("/api/shopping-list-state", (req, res) => {
  const body = req.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object") {
    res.status(400).json({ success: false, error: "Body must be a JSON object" });
    return;
  }
  if (typeof body.planId !== "string" || !body.planId) {
    res.status(400).json({ success: false, error: "planId must be a non-empty string" });
    return;
  }
  if (!Array.isArray(body.checkedKeys)) {
    res.status(400).json({ success: false, error: "checkedKeys must be an array" });
    return;
  }
  const seen = new Set<string>();
  for (const k of body.checkedKeys) {
    if (typeof k !== "string") {
      res.status(400).json({ success: false, error: "checkedKeys entries must be strings" });
      return;
    }
    if (k.length > MAX_KEY_LEN) {
      res.status(400).json({ success: false, error: `checkedKeys entries must be ${MAX_KEY_LEN} chars or fewer` });
      return;
    }
    seen.add(k);
    if (seen.size > MAX_CHECKED_KEYS) {
      res.status(400).json({ success: false, error: `checkedKeys can have at most ${MAX_CHECKED_KEYS} entries` });
      return;
    }
  }
  try {
    ensureOutputDir();
    const out = { planId: body.planId, checkedKeys: [...seen] };
    fs.writeFileSync(SHOPPING_LIST_STATE_PATH, JSON.stringify(out, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to save shopping list state",
    });
  }
});

app.get("/api/circular/progress", (_req, res) => {
  res.json(scanProgress);
});

app.get("/api/circular", (_req, res) => {
  const data = readJsonOrNull<{
    storeName?: unknown;
    validThrough?: unknown;
    items?: unknown;
  }>(EXTRACTION_PATH);
  if (!data) {
    res.json({ exists: false });
    return;
  }
  const storeName =
    typeof data.storeName === "string" && data.storeName.trim()
      ? data.storeName.trim()
      : null;
  const validThrough =
    typeof data.validThrough === "string" && data.validThrough.trim()
      ? data.validThrough.trim()
      : null;
  const itemCount = Array.isArray(data.items) ? data.items.length : 0;
  res.json({ exists: true, storeName, validThrough, itemCount });
});

app.get("/api/meal-plan", (_req, res) => {
  const data = readJsonOrNull<MealPlanResult & Record<string, unknown>>(MEAL_PLAN_PATH);
  if (!data) {
    res.json({ exists: false });
    return;
  }
  if (typeof data.planId !== "string" || !data.planId) {
    data.planId = crypto.randomUUID();
    try {
      fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(data, null, 2));
    } catch {
      // best-effort; serve anyway
    }
  }
  const stale = isPlanFingerprintStale(data, loadPreferences());
  res.json({ exists: true, stale, ...data });
});

app.post("/api/meal-plan/generate", withSerial(async (_req, res) => {
  const extraction = readJsonOrNull<ExtractionResult & unknown[]>(EXTRACTION_PATH);
  if (!extraction) {
    res.status(400).json({
      success: false,
      error: "No circular extracted yet. Upload a circular first.",
    });
    return;
  }
  try {
    const saleItems = extraction.items || extraction;
    const prefs = loadPreferences();
    const result = await generateMealPlan(saleItems, prefs);
    const stamped = {
      ...result,
      planId: crypto.randomUUID(),
      prefsFingerprint: computePrefsFingerprint(prefs),
    };

    ensureOutputDir();
    fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(stamped, null, 2));
    clearShoppingListState();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Generation failed",
    });
  }
}));

app.post("/api/meal-plan/swap", withSerial(async (req, res) => {
  const body = req.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object") {
    res.status(400).json({ success: false, error: "Body must be a JSON object" });
    return;
  }
  const day = body.day;
  const mealType = body.mealType;
  if (typeof day !== "string" || !day.trim()) {
    res.status(400).json({ success: false, error: "day must be a non-empty string" });
    return;
  }
  if (typeof mealType !== "string" || !VALID_MEAL_TYPES.has(mealType)) {
    res.status(400).json({
      success: false,
      error: "mealType must be 'breakfast', 'lunch', or 'dinner'",
    });
    return;
  }

  const plan = readJsonOrNull<MealPlanResult>(MEAL_PLAN_PATH);
  if (!plan) {
    res.status(400).json({
      success: false,
      error: "No meal plan exists. Generate one first.",
    });
    return;
  }
  const extraction = readJsonOrNull<ExtractionResult & unknown[]>(EXTRACTION_PATH);
  if (!extraction) {
    res.status(400).json({
      success: false,
      error: "No circular extracted yet. Upload a circular first.",
    });
    return;
  }

  try {
    const dayIndex = plan.weekPlan.findIndex((d) => d.day === day);
    if (dayIndex === -1) {
      res.status(400).json({ success: false, error: `Day not found in plan: ${day}` });
      return;
    }
    const slotKey = mealType as "breakfast" | "lunch" | "dinner";
    if (!plan.weekPlan[dayIndex][slotKey]) {
      res.status(400).json({
        success: false,
        error: `No ${mealType} in current plan for ${day}`,
      });
      return;
    }

    const preferences = loadPreferences();
    if (!preferences.mealsPerDay.includes(slotKey)) {
      res.status(400).json({
        success: false,
        error: `${mealType} is not enabled in current preferences`,
      });
      return;
    }

    // Defense in depth: the UI disables Swap on a stale plan, but a direct API
    // call or stale tab could still swap against outdated preferences and mix
    // two pref versions into one plan. Reject before the expensive LLM call.
    if (isPlanFingerprintStale(plan, preferences)) {
      res.status(409).json({
        success: false,
        error: "Plan is out of sync with current preferences. Regenerate first.",
      });
      return;
    }

    const saleItems = extraction.items || extraction;

    const result = await generateMealSwap(plan, day, slotKey, saleItems, preferences);

    const mergedShoppingList = mergeShoppingListAfterSwap({
      weekPlan: plan.weekPlan,
      swappedDayIndex: dayIndex,
      swappedSlot: slotKey,
      newMeal: result.meal,
      priorList: plan.shoppingList,
      regeneratedList: result.shoppingList,
    });
    plan.weekPlan[dayIndex][slotKey] = result.meal;
    plan.shoppingList = mergedShoppingList;

    ensureOutputDir();
    fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(plan, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Swap failed",
    });
  }
}));

app.post(
  "/api/circular/upload",
  upload.single("circular"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: "No file uploaded" });
      return;
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({
        success: false,
        error: `Unsupported file type: ${ext}. Allowed: PDF, JPG, PNG, WEBP.`,
      });
      return;
    }

    const file = req.file;
    await withSerial(async (_req, res) => {
      const tmpPath = path.join(
        os.tmpdir(),
        `mealplanshop-${crypto.randomUUID()}${ext}`
      );

      try {
        fs.writeFileSync(tmpPath, file.buffer);

        scanProgress = { stage: "preparing" };
        const extraction = await scanCircular(tmpPath, (event) => {
          if (event.type === "preparing") {
            scanProgress = { stage: "preparing" };
          } else {
            scanProgress = {
              stage: "scanning",
              page: event.page,
              pages: event.pages,
              storeName: event.storeName,
            };
          }
        });

        if (extraction.items.length === 0) {
          res.status(422).json({
            success: false,
            error:
              "No sale items extracted from this circular. Try a clearer image.",
          });
          return;
        }

        const result = await runScanAndPlan(extraction);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({
          success: false,
          error: err instanceof Error ? err.message : "Processing failed",
        });
      } finally {
        scanProgress = { stage: "idle" };
        if (fs.existsSync(tmpPath)) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // best-effort cleanup
          }
        }
      }
    })(req, res);
  }
);

app.get("/api/circular/prefs", (_req, res) => {
  res.json(loadCircularPrefs());
});

app.post("/api/circular/flipp/stores", async (req, res) => {
  const body = req.body as { postalCode?: unknown } | undefined;
  const postalCode = typeof body?.postalCode === "string" ? body.postalCode.trim() : "";
  if (!/^\d{5}$/.test(postalCode)) {
    res.status(400).json({ success: false, error: "postalCode must be a 5-digit ZIP" });
    return;
  }
  try {
    const merchants = await listFlyers(postalCode);
    saveCircularPrefs({ postalCode });
    res.json({ success: true, merchants });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to fetch stores",
    });
  }
});

app.post("/api/circular/flipp/fetch", withSerial(async (req, res) => {
  const body = req.body as
    | {
        flyerId?: unknown;
        merchantId?: unknown;
        merchantName?: unknown;
        validThrough?: unknown;
      }
    | undefined;
  const flyerId = typeof body?.flyerId === "number" ? body.flyerId : NaN;
  const merchantName =
    typeof body?.merchantName === "string" && body.merchantName.trim()
      ? body.merchantName.trim()
      : null;
  const validThrough =
    typeof body?.validThrough === "string" && body.validThrough.trim()
      ? body.validThrough.trim()
      : null;
  const merchantId =
    typeof body?.merchantId === "number" && Number.isFinite(body.merchantId)
      ? body.merchantId
      : null;
  if (!Number.isFinite(flyerId) || !merchantName) {
    res.status(400).json({
      success: false,
      error: "flyerId (number) and merchantName (string) are required",
    });
    return;
  }

  try {
    scanProgress = { stage: "fetching", merchant: merchantName };
    let extraction = readFlippCache(flyerId);
    if (extraction) {
      // Carry through caller-supplied store/validThrough in case the cached
      // metadata is missing (e.g. early cache entries).
      extraction = {
        items: extraction.items,
        storeName: extraction.storeName ?? merchantName,
        validThrough: extraction.validThrough ?? validThrough,
      };
      console.log(`[flipp] cache hit flyer=${flyerId} items=${extraction.items.length}`);
    } else {
      extraction = await fetchFlyer(flyerId, {
        storeName: merchantName,
        validThrough,
      });
      writeFlippCache(flyerId, extraction);
    }

    if (extraction.items.length === 0) {
      res.status(422).json({
        success: false,
        error:
          "This flyer doesn't appear to have grocery items we can plan meals from. Try a different store.",
      });
      return;
    }

    const result = await runScanAndPlan(extraction);
    if (merchantId !== null) saveCircularPrefs({ lastMerchantId: merchantId });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = (err as Error & { statusCode?: number }).statusCode ?? 500;
    res.status(status).json({
      success: false,
      error: err instanceof Error ? err.message : "Fetch failed",
    });
  } finally {
    scanProgress = { stage: "idle" };
  }
}));

app.use(
  (
    err: Error & { code?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        success: false,
        error: `File too large. Max size is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      });
      return;
    }
    res.status(500).json({ success: false, error: err.message });
  }
);

if (process.env.NODE_ENV === "production") {
  const clientDir = path.join(PROJECT_ROOT, "dist/client");
  app.use(express.static(clientDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`MealPlanShop server running on http://localhost:${PORT}`);
});
