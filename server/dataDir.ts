import * as os from "node:os";
import * as path from "node:path";

// Where the app keeps state that must outlive any single git checkout —
// preferences above all. Prefs used to live in the gitignored, per-checkout
// `output/`, so every worktree (and the main tree) silently got its own copy or
// fell back to defaults (issue #91). This resolves to a stable per-user dir
// instead. Override with MEALPLANSHOP_DATA_DIR to point it anywhere — that's
// also how the tests pin it to a temp dir.
//
// Extracted as a sibling module (like validatePreferences / prefs-fingerprint)
// so it can be unit-tested without booting index.ts, which hard-exits without
// GEMINI_API_KEY and calls app.listen() at module load.
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MEALPLANSHOP_DATA_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), ".config", "mealplanshop");
}

// Absolute path to the shared preferences file inside the resolved data dir.
export function preferencesPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDataDir(env), "preferences.json");
}
