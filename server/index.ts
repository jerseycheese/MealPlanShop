import express from "express";
import multer from "multer";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { scanCircular } from "../scripts/scan-circular";
import {
  generateMealPlan,
  DEFAULT_PREFERENCES,
} from "../scripts/generate-meal-plan";
import type { UserPreferences } from "../types";

type ScanProgress =
  | { stage: "idle" }
  | { stage: "preparing" }
  | { stage: "scanning"; page: number; pages: number; storeName: string | null }
  | { stage: "planning" };

const app = express();
const PORT = parseInt(process.env.API_PORT ?? process.env.PORT ?? "3101", 10);
const PROJECT_ROOT = path.join(__dirname, "..");
const OUTPUT_DIR = path.join(PROJECT_ROOT, "output");
const MEAL_PLAN_PATH = path.join(OUTPUT_DIR, "meal-plan.json");
const EXTRACTION_PATH = path.join(OUTPUT_DIR, "extraction.json");
const PREFERENCES_PATH = path.join(OUTPUT_DIR, "preferences.json");
const SHOPPING_LIST_STATE_PATH = path.join(OUTPUT_DIR, "shopping-list-state.json");
const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner"]);
const MAX_LIST_ITEMS = 12;
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
  if (!fs.existsSync(PREFERENCES_PATH)) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(fs.readFileSync(PREFERENCES_PATH, "utf-8"));
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function validatePreferences(input: unknown): UserPreferences | string {
  if (!input || typeof input !== "object") return "Body must be a JSON object";
  const p = input as Record<string, unknown>;

  const size = p.householdSize;
  if (!Number.isInteger(size) || (size as number) < 1 || (size as number) > 20) {
    return "householdSize must be an integer between 1 and 20";
  }

  const checkList = (key: string, value: unknown): string[] | string => {
    if (!Array.isArray(value)) return `${key} must be an array`;
    if (value.length > MAX_LIST_ITEMS) return `${key} can have at most ${MAX_LIST_ITEMS} entries`;
    const cleaned: string[] = [];
    for (const v of value) {
      if (typeof v !== "string") return `${key} entries must be strings`;
      const trimmed = v.trim();
      if (!trimmed) return `${key} entries cannot be empty`;
      if (trimmed.length > MAX_LIST_ITEM_LEN) {
        return `${key} entries must be ${MAX_LIST_ITEM_LEN} chars or fewer`;
      }
      cleaned.push(trimmed);
    }
    return cleaned;
  };

  const dietary = checkList("dietaryRestrictions", p.dietaryRestrictions);
  if (typeof dietary === "string") return dietary;
  const cuisine = checkList("cuisinePreferences", p.cuisinePreferences);
  if (typeof cuisine === "string") return cuisine;

  if (!Array.isArray(p.mealsPerDay) || p.mealsPerDay.length === 0) {
    return "mealsPerDay must include at least one meal";
  }
  const meals: string[] = [];
  for (const m of p.mealsPerDay) {
    if (typeof m !== "string" || !VALID_MEAL_TYPES.has(m)) {
      return "mealsPerDay entries must be 'breakfast', 'lunch', or 'dinner'";
    }
    if (!meals.includes(m)) meals.push(m);
  }

  return {
    householdSize: size as number,
    dietaryRestrictions: dietary,
    cuisinePreferences: cuisine,
    mealsPerDay: meals,
  };
}

app.use(express.json());

app.get("/api/preferences", (_req, res) => {
  res.json({ preferences: loadPreferences() });
});

app.put("/api/preferences", (req, res) => {
  const result = validatePreferences(req.body);
  if (typeof result === "string") {
    res.status(400).json({ success: false, error: result });
    return;
  }
  try {
    ensureOutputDir();
    fs.writeFileSync(PREFERENCES_PATH, JSON.stringify(result, null, 2));
    res.json({ success: true, preferences: result });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to save preferences",
    });
  }
});

app.get("/api/shopping-list-state", (_req, res) => {
  if (!fs.existsSync(SHOPPING_LIST_STATE_PATH)) {
    res.json({ planId: null, checkedKeys: [] });
    return;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(SHOPPING_LIST_STATE_PATH, "utf-8"));
    const planId = typeof parsed.planId === "string" ? parsed.planId : null;
    const checkedKeys = Array.isArray(parsed.checkedKeys)
      ? parsed.checkedKeys.filter((k: unknown) => typeof k === "string")
      : [];
    res.json({ planId, checkedKeys });
  } catch {
    res.json({ planId: null, checkedKeys: [] });
  }
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

app.get("/api/meal-plan", (_req, res) => {
  if (!fs.existsSync(MEAL_PLAN_PATH)) {
    res.json({ exists: false });
    return;
  }

  try {
    const data = JSON.parse(fs.readFileSync(MEAL_PLAN_PATH, "utf-8"));
    if (typeof data.planId !== "string" || !data.planId) {
      data.planId = crypto.randomUUID();
      try {
        fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(data, null, 2));
      } catch {
        // best-effort; serve anyway
      }
    }
    res.json({ exists: true, ...data });
  } catch {
    res.status(500).json({ error: "Failed to read meal plan" });
  }
});

app.post("/api/meal-plan/generate", async (_req, res) => {
  if (processing) {
    res.status(409).json({ success: false, error: "Already processing a request" });
    return;
  }

  if (!fs.existsSync(EXTRACTION_PATH)) {
    res.status(400).json({
      success: false,
      error: "No circular extracted yet. Upload a circular first.",
    });
    return;
  }

  processing = true;
  try {
    const extraction = JSON.parse(fs.readFileSync(EXTRACTION_PATH, "utf-8"));
    const saleItems = extraction.items || extraction;
    const result = await generateMealPlan(saleItems, loadPreferences());
    const stamped = { planId: crypto.randomUUID(), ...result };

    ensureOutputDir();
    fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(stamped, null, 2));
    clearShoppingListState();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Generation failed",
    });
  } finally {
    processing = false;
  }
});

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

    if (processing) {
      res.status(409).json({ success: false, error: "Already processing a request" });
      return;
    }

    processing = true;
    const tmpPath = path.join(
      os.tmpdir(),
      `mealplanshop-${crypto.randomUUID()}${ext}`
    );

    try {
      fs.writeFileSync(tmpPath, req.file.buffer);

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

      ensureOutputDir();
      fs.writeFileSync(EXTRACTION_PATH, JSON.stringify(extraction, null, 2));

      scanProgress = { stage: "planning" };
      const mealPlan = await generateMealPlan(
        extraction.items,
        loadPreferences()
      );
      const stamped = { planId: crypto.randomUUID(), ...mealPlan };
      fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(stamped, null, 2));
      clearShoppingListState();

      res.json({
        success: true,
        itemCount: extraction.items.length,
        storeName: extraction.storeName,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : "Processing failed",
      });
    } finally {
      processing = false;
      scanProgress = { stage: "idle" };
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // best-effort cleanup
        }
      }
    }
  }
);

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
