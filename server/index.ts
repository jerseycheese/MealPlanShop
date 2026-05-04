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
    const result = await generateMealPlan(saleItems, DEFAULT_PREFERENCES);

    ensureOutputDir();
    fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(result, null, 2));
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
        DEFAULT_PREFERENCES
      );
      fs.writeFileSync(MEAL_PLAN_PATH, JSON.stringify(mealPlan, null, 2));

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
