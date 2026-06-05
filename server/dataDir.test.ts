import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { resolveDataDir, preferencesPath } from "./dataDir";

// An explicit override wins — this is how a worktree, a fresh machine, or a test
// pins the data dir somewhere specific.
assert.equal(
  resolveDataDir({ MEALPLANSHOP_DATA_DIR: "/tmp/mps-data" }),
  "/tmp/mps-data",
);

// Surrounding whitespace is trimmed off the override.
assert.equal(
  resolveDataDir({ MEALPLANSHOP_DATA_DIR: "  /tmp/mps-data  " }),
  "/tmp/mps-data",
);

// With no override (or a blank one), it falls back to a stable per-user dir
// outside any checkout — never the gitignored output/ that caused issue #91.
const fallback = path.join(os.homedir(), ".config", "mealplanshop");
assert.equal(resolveDataDir({}), fallback);
assert.equal(resolveDataDir({ MEALPLANSHOP_DATA_DIR: "   " }), fallback);

// preferences.json sits inside the resolved data dir.
assert.equal(
  preferencesPath({ MEALPLANSHOP_DATA_DIR: "/tmp/mps-data" }),
  path.join("/tmp/mps-data", "preferences.json"),
);

console.log("dataDir: 5/5 passed");
