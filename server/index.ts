import "dotenv/config";
import express from "express";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
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
import { moveMealInWeekPlan } from "./moveMeal";
import { validatePreferences, ValidationError } from "./validatePreferences";
import type {
  MealPlanResult,
  UserPreferences,
  ExtractionResult,
  ScanProgress,
  DayOfWeek,
  MealType,
} from "../types";
import { MEAL_TYPES, DAYS_OF_WEEK } from "../types";
import { listFlyers, fetchFlyer } from "./circular/sources/flipp";
import { loadCircularPrefs, saveCircularPrefs } from "./circular/prefs";
import { containsWholeWord } from "../scripts/excludedCategories";
import { readJsonOrNull, writeJsonAtomic } from "./lib/jsonStore";

// Fail fast at startup if required secrets are missing — otherwise the server
// happily boots and only dies on the first scan/plan request.
if (!process.env.GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in environment (.env file)");
  process.exit(1);
}

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
const MAX_CHECKED_KEYS = 500;
const MAX_KEY_LEN = 200;

const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

// Magic-byte sniffing for the upload endpoint. Extension alone is attacker-
// controlled (req.file.originalname). We check the actual file content before
// handing the bytes to pdftoppm or the vision model.
function detectFileExt(buf: Buffer): string | null {
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return ".pdf";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return ".png";
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return ".webp";
  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

let processing = false;
let scanProgress: ScanProgress = { stage: "idle" };

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Throw this from a route to send a specific HTTP status; the error middleware
// at the bottom serializes it. Replaces the per-route `res.status(n).json({
// success:false, error })` + `return` guards that were copy-pasted everywhere.
class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

// Wrap an async route handler so a thrown error (HttpError or otherwise) is
// forwarded to the error middleware instead of every handler carrying its own
// try/catch. Composes in front of withSerial.
function asyncRoute(
  handler: (req: express.Request, res: express.Response) => Promise<void> | void,
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
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
  writeJsonAtomic(EXTRACTION_PATH, extraction);

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
        if (
          containsWholeWord(rowName, saleName) ||
          containsWholeWord(saleName, rowName)
        ) {
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
  writeJsonAtomic(MEAL_PLAN_PATH, stamped);
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
  writeJsonAtomic(
    path.join(FLIPP_CACHE_DIR, `${flyerId}.json`),
    { ...result, _cachedAt: Date.now() },
  );
}

function clearShoppingListState() {
  if (fs.existsSync(SHOPPING_LIST_STATE_PATH)) {
    try {
      fs.unlinkSync(SHOPPING_LIST_STATE_PATH);
    } catch (err) {
      console.warn("[clearShoppingListState] unlink failed:", err);
    }
  }
}

function loadPreferences(): UserPreferences {
  const parsed = readJsonOrNull<Partial<UserPreferences>>(PREFERENCES_PATH);
  return parsed ? { ...DEFAULT_PREFERENCES, ...parsed } : DEFAULT_PREFERENCES;
}

app.use(helmet());
app.use(express.json());

// Conservative defaults; the API is local-only today but these prevent runaway
// loops from a buggy client and slow down brute-force attempts if exposed.
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 120 }));
app.use("/api/circular/upload", rateLimit({ windowMs: 60_000, limit: 10 }));
app.use("/api/circular/flipp/fetch", rateLimit({ windowMs: 60_000, limit: 20 }));

app.get("/api/preferences", (_req, res) => {
  res.json({ preferences: loadPreferences() });
});

app.put("/api/preferences", asyncRoute((req, res) => {
  // validatePreferences throws ValidationError → 400 via the error middleware.
  const result = validatePreferences(req.body);
  ensureOutputDir();
  writeJsonAtomic(PREFERENCES_PATH, result);
  res.json({ success: true, preferences: result });
}));

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

app.put("/api/shopping-list-state", asyncRoute((req, res) => {
  const body = req.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Body must be a JSON object");
  }
  if (typeof body.planId !== "string" || !body.planId) {
    throw new HttpError(400, "planId must be a non-empty string");
  }
  if (!Array.isArray(body.checkedKeys)) {
    throw new HttpError(400, "checkedKeys must be an array");
  }
  const seen = new Set<string>();
  for (const k of body.checkedKeys) {
    if (typeof k !== "string") {
      throw new HttpError(400, "checkedKeys entries must be strings");
    }
    if (k.length > MAX_KEY_LEN) {
      throw new HttpError(400, `checkedKeys entries must be ${MAX_KEY_LEN} chars or fewer`);
    }
    seen.add(k);
    if (seen.size > MAX_CHECKED_KEYS) {
      throw new HttpError(400, `checkedKeys can have at most ${MAX_CHECKED_KEYS} entries`);
    }
  }
  ensureOutputDir();
  writeJsonAtomic(SHOPPING_LIST_STATE_PATH, { planId: body.planId, checkedKeys: [...seen] });
  res.json({ success: true });
}));

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
  const planId = typeof data.planId === "string" && data.planId ? data.planId : null;
  const stale = isPlanFingerprintStale(data, loadPreferences());
  res.json({
    exists: true,
    stale,
    planId,
    weekPlan: data.weekPlan,
    shoppingList: data.shoppingList,
  });
});

app.post("/api/meal-plan/generate", asyncRoute(withSerial(async (_req, res) => {
  const extraction = readJsonOrNull<ExtractionResult & unknown[]>(EXTRACTION_PATH);
  if (!extraction) {
    throw new HttpError(400, "No circular extracted yet. Upload a circular first.");
  }
  const saleItems = extraction.items || extraction;
  const prefs = loadPreferences();
  const result = await generateMealPlan(saleItems, prefs);
  const stamped = {
    ...result,
    planId: crypto.randomUUID(),
    prefsFingerprint: computePrefsFingerprint(prefs),
  };

  ensureOutputDir();
  writeJsonAtomic(MEAL_PLAN_PATH, stamped);
  clearShoppingListState();
  res.json({ success: true });
})));

app.post("/api/meal-plan/swap", asyncRoute(withSerial(async (req, res) => {
  const body = req.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Body must be a JSON object");
  }
  const day = body.day;
  const mealType = body.mealType;
  if (typeof day !== "string" || !VALID_DAYS_OF_WEEK.has(day.toLowerCase())) {
    throw new HttpError(400, "day must be a valid day of the week");
  }
  if (typeof mealType !== "string" || !VALID_MEAL_TYPES.has(mealType)) {
    throw new HttpError(400, "mealType must be 'breakfast', 'lunch', or 'dinner'");
  }

  const plan = readJsonOrNull<MealPlanResult>(MEAL_PLAN_PATH);
  if (!plan) {
    throw new HttpError(400, "No meal plan exists. Generate one first.");
  }
  const extraction = readJsonOrNull<ExtractionResult & unknown[]>(EXTRACTION_PATH);
  if (!extraction) {
    throw new HttpError(400, "No circular extracted yet. Upload a circular first.");
  }

  const dayIndex = plan.weekPlan.findIndex((d) => d.day === day);
  if (dayIndex === -1) {
    throw new HttpError(400, `Day not found in plan: ${day}`);
  }
  const slotKey = mealType as "breakfast" | "lunch" | "dinner";
  if (!plan.weekPlan[dayIndex][slotKey]) {
    throw new HttpError(400, `No ${mealType} in current plan for ${day}`);
  }

  const preferences = loadPreferences();
  const mealsForDay = preferences.mealsByDay[day.toLowerCase() as DayOfWeek] ?? [];
  if (!mealsForDay.includes(slotKey)) {
    throw new HttpError(400, `${mealType} is not enabled for ${day} in current preferences`);
  }

  // Defense in depth: the UI disables Swap on a stale plan, but a direct API
  // call or stale tab could still swap against outdated preferences and mix
  // two pref versions into one plan. Reject before the expensive LLM call.
  if (isPlanFingerprintStale(plan, preferences)) {
    throw new HttpError(
      409,
      "Plan is out of sync with current preferences. Regenerate first.",
    );
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
  writeJsonAtomic(MEAL_PLAN_PATH, plan);
  res.json({ success: true });
})));

app.post("/api/meal-plan/move", asyncRoute(withSerial(async (req, res) => {
  const body = req.body as Record<string, unknown> | null | undefined;
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Body must be a JSON object");
  }
  const from = body.from as Record<string, unknown> | null | undefined;
  const to = body.to as Record<string, unknown> | null | undefined;
  if (!from || typeof from !== "object" || !to || typeof to !== "object") {
    throw new HttpError(400, "from and to must be objects with day and mealType");
  }

  const fromDay = from.day;
  const toDay = to.day;
  const fromType = from.mealType;
  const toType = to.mealType;
  if (typeof fromDay !== "string" || !VALID_DAYS_OF_WEEK.has(fromDay.toLowerCase())) {
    throw new HttpError(400, "from.day must be a valid day of the week");
  }
  if (typeof toDay !== "string" || !VALID_DAYS_OF_WEEK.has(toDay.toLowerCase())) {
    throw new HttpError(400, "to.day must be a valid day of the week");
  }
  if (typeof fromType !== "string" || !VALID_MEAL_TYPES.has(fromType)) {
    throw new HttpError(400, "from.mealType must be 'breakfast', 'lunch', or 'dinner'");
  }
  if (typeof toType !== "string" || !VALID_MEAL_TYPES.has(toType)) {
    throw new HttpError(400, "to.mealType must be 'breakfast', 'lunch', or 'dinner'");
  }
  // Same-meal-type-only (locked decision): a dinner can only move to another
  // day's dinner. Enforced here too, not just in the UI.
  if (fromType !== toType) {
    throw new HttpError(400, "Meals can only move to the same meal type on another day");
  }

  const plan = readJsonOrNull<MealPlanResult>(MEAL_PLAN_PATH);
  if (!plan) {
    throw new HttpError(400, "No meal plan exists. Generate one first.");
  }

  // Defense in depth: don't rearrange a plan that's already out of sync with the
  // saved preferences — it's about to be regenerated anyway. Same guard as swap.
  if (isPlanFingerprintStale(plan, loadPreferences())) {
    throw new HttpError(
      409,
      "Plan is out of sync with current preferences. Regenerate first.",
    );
  }

  const result = moveMealInWeekPlan(plan.weekPlan, {
    from: { day: fromDay, mealType: fromType as MealType },
    to: { day: toDay, mealType: toType as MealType },
  });

  if (!result.ok) {
    // A no-op move is harmless — report success without rewriting the file.
    if (result.code === "SAME_SLOT") {
      res.json({ success: true, swapped: false });
      return;
    }
    const message =
      result.code === "CROSS_TYPE"
        ? "Meals can only move to the same meal type on another day"
        : result.code === "FROM_DAY_MISSING"
          ? `Day not found in plan: ${fromDay}`
          : result.code === "TO_DAY_MISSING"
            ? `Day not found in plan: ${toDay}`
            : `No ${fromType} to move from ${fromDay}`;
    throw new HttpError(400, message);
  }

  // A pure relocation: reorder weekPlan slots only. The shopping list is the
  // day-agnostic union of all meal ingredients and a move neither adds nor
  // removes a meal, so it stays byte-identical. planId/prefsFingerprint unchanged.
  plan.weekPlan = result.weekPlan;

  ensureOutputDir();
  writeJsonAtomic(MEAL_PLAN_PATH, plan);
  res.json({ success: true, swapped: result.swapped });
})));

app.post(
  "/api/circular/upload",
  upload.single("circular"),
  asyncRoute(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, "No file uploaded");
    }

    // Trust the bytes, not the filename. Detect from magic bytes and reject if
    // the content doesn't match a supported format.
    const detected = detectFileExt(req.file.buffer);
    if (!detected || !ALLOWED_EXTENSIONS.has(detected)) {
      throw new HttpError(400, "Unsupported file type. Allowed: PDF, JPG, PNG, WEBP.");
    }
    const ext = detected;

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
          throw new HttpError(
            422,
            "No sale items extracted from this circular. Try a clearer image.",
          );
        }

        const result = await runScanAndPlan(extraction);
        res.json({ success: true, ...result });
      } finally {
        scanProgress = { stage: "idle" };
        if (fs.existsSync(tmpPath)) {
          try {
            fs.unlinkSync(tmpPath);
          } catch (err) {
            console.warn(`[upload] failed to clean up tmp file ${tmpPath}:`, err);
          }
        }
      }
    })(req, res);
  })
);

app.get("/api/circular/prefs", (_req, res) => {
  res.json(loadCircularPrefs());
});

app.post("/api/circular/flipp/stores", asyncRoute(async (req, res) => {
  const body = req.body as { postalCode?: unknown } | undefined;
  const postalCode = typeof body?.postalCode === "string" ? body.postalCode.trim() : "";
  if (!/^\d{5}$/.test(postalCode)) {
    throw new HttpError(400, "postalCode must be a 5-digit ZIP");
  }
  let merchants;
  try {
    merchants = await listFlyers(postalCode);
  } catch (err) {
    // An upstream Flipp failure is a bad gateway, not our 500.
    throw new HttpError(502, err instanceof Error ? err.message : "Failed to fetch stores");
  }
  saveCircularPrefs({ postalCode });
  res.json({ success: true, merchants });
}));

app.post("/api/circular/flipp/fetch", asyncRoute(withSerial(async (req, res) => {
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
    throw new HttpError(400, "flyerId (number) and merchantName (string) are required");
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
    } else {
      extraction = await fetchFlyer(flyerId, {
        storeName: merchantName,
        validThrough,
      });
      writeFlippCache(flyerId, extraction);
    }

    if (extraction.items.length === 0) {
      throw new HttpError(
        422,
        "This flyer doesn't appear to have grocery items we can plan meals from. Try a different store.",
      );
    }

    const result = await runScanAndPlan(extraction);
    if (merchantId !== null) saveCircularPrefs({ lastMerchantId: merchantId });
    res.json({ success: true, ...result });
  } finally {
    scanProgress = { stage: "idle" };
  }
})));

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
    // Resolve a status: explicit statusCode wins (HttpError + errors tagged by
    // runScanAndPlan/fetchFlyer), ValidationError maps to 400, everything else
    // is an unexpected 500.
    const status =
      (err as { statusCode?: number }).statusCode ??
      (err instanceof ValidationError ? 400 : 500);
    if (status >= 500) console.error("[unhandled]", err);
    res.status(status).json({
      success: false,
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
);

if (process.env.NODE_ENV === "production") {
  const clientDir = path.join(PROJECT_ROOT, "dist/client");
  app.use(express.static(clientDir));
  // Express 5 (path-to-regexp v8) rejects a bare "*" route, so serve the SPA
  // fallback from a final middleware instead. Limit it to GET/HEAD so unmatched
  // API methods still fall through to a 404 rather than returning HTML.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`MealPlanShop server listening on port ${PORT}`);
});
