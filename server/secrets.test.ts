import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  resolveGeminiKey,
  requireGeminiKey,
  saveGeminiKey,
  clearGeminiKey,
  secretsPath,
  maskKey,
} from "./secrets";
import { preferencesPath } from "./dataDir";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "secrets-test-"));
const env = { MEALPLANSHOP_DATA_DIR: dir } as NodeJS.ProcessEnv;
const withEnvKey = (k: string): NodeJS.ProcessEnv =>
  ({ MEALPLANSHOP_DATA_DIR: dir, GEMINI_API_KEY: k }) as NodeJS.ProcessEnv;

try {
  // Nothing stored and no env var → unset.
  assert.equal(resolveGeminiKey(env), null);

  // The env var is the fallback (the existing .env dev flow).
  assert.equal(resolveGeminiKey(withEnvKey("env-key-123")), "env-key-123");

  // A whitespace-only env var counts as unset.
  assert.equal(resolveGeminiKey(withEnvKey("   ")), null);

  // A stored key wins over the env var.
  saveGeminiKey("stored-key-abc", env);
  assert.equal(resolveGeminiKey(withEnvKey("env-key-123")), "stored-key-abc");

  // Secrets live in their own file, separate from preferences.json — so the key
  // never rides the preferences export.
  assert.equal(secretsPath(env), path.join(dir, "secrets.json"));
  assert.notEqual(secretsPath(env), preferencesPath(env));
  assert.equal(fs.existsSync(path.join(dir, "secrets.json")), true);
  assert.equal(fs.existsSync(path.join(dir, "preferences.json")), false);

  // Clearing drops the stored key: env fallback applies again, then unset.
  clearGeminiKey(env);
  assert.equal(resolveGeminiKey(withEnvKey("env-key-123")), "env-key-123");
  assert.equal(resolveGeminiKey(env), null);

  // requireGeminiKey returns the resolved key, or throws a readable 400.
  assert.equal(requireGeminiKey(withEnvKey("env-key-123")), "env-key-123");
  assert.throws(
    () => requireGeminiKey(env),
    (err: Error & { statusCode?: number }) =>
      /Settings/.test(err.message) && err.statusCode === 400,
  );

  // maskKey never echoes the raw key.
  const masked = maskKey("abcd1234efgh5678");
  assert.equal(masked, "abcd...5678");
  assert.equal(masked.includes("1234efgh"), false);
  assert.equal(maskKey("short"), "****");

  console.log("secrets: 15/15 passed");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
