import express from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";

const app = express();
const PORT = parseInt(process.env.PORT || "3001", 10);
const PROJECT_ROOT = path.join(__dirname, "..");
const MEAL_PLAN_PATH = path.join(PROJECT_ROOT, "output/meal-plan.json");

let generating = false;

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

app.post("/api/meal-plan/generate", (_req, res) => {
  if (generating) {
    res.status(409).json({ error: "Generation already in progress" });
    return;
  }

  generating = true;
  const child = spawn("npm", ["run", "plan"], {
    cwd: PROJECT_ROOT,
    shell: true,
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("close", (code) => {
    generating = false;
    if (code === 0) {
      res.json({ success: true, output: stdout });
    } else {
      res.status(500).json({ success: false, error: stderr || stdout });
    }
  });

  child.on("error", (err) => {
    generating = false;
    res.status(500).json({ success: false, error: err.message });
  });
});

// Serve static files in production
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
