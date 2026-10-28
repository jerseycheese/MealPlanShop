import * as os from 'node:os';
import * as path from 'node:path';
import type { UserPreferences } from '../types';
import { readJsonOrNull } from './lib/jsonStore';

// Where the app keeps state that must outlive any single git checkout —
// preferences above all. Prefs used to live in the gitignored, per-checkout
// `output/`, so every worktree (and the main tree) silently got its own copy or
// fell back to defaults. This resolves to a stable per-user dir
// instead. Override with MEALPLANSHOP_DATA_DIR to point it anywhere — that's
// also how the tests pin it to a temp dir.
//
// A sibling module (like validatePreferences / prefs-fingerprint)
// so it can be unit-tested without booting index.ts, which calls app.listen()
// at module load.
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MEALPLANSHOP_DATA_DIR?.trim();
  if (override) return override;
  return path.join(os.homedir(), '.config', 'mealplanshop');
}

// Absolute path to the shared preferences file inside the resolved data dir.
export function preferencesPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDataDir(env), 'preferences.json');
}

// Resolve the user's saved preferences, falling back to `defaults` for a
// missing file or for fields a stored (possibly older) preferences.json
// doesn't have. Shared by the server routes and the CLI scripts
// so both plan from the same preferences instead of the CLI silently using
// `defaults` alone.
export function loadPreferences(
  defaults: UserPreferences,
  env: NodeJS.ProcessEnv = process.env
): UserPreferences {
  const parsed = readJsonOrNull<Partial<UserPreferences>>(preferencesPath(env));
  return parsed ? { ...defaults, ...parsed } : defaults;
}
