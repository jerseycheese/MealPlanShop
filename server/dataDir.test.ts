import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveDataDir, preferencesPath, loadPreferences } from './dataDir';
import type { UserPreferences } from '../types';

// An explicit override wins — this is how a worktree, a fresh machine, or a test
// pins the data dir somewhere specific.
assert.equal(
  resolveDataDir({ MEALPLANSHOP_DATA_DIR: '/tmp/mps-data' }),
  '/tmp/mps-data'
);

// Surrounding whitespace is trimmed off the override.
assert.equal(
  resolveDataDir({ MEALPLANSHOP_DATA_DIR: '  /tmp/mps-data  ' }),
  '/tmp/mps-data'
);

// With no override (or a blank one), it falls back to a stable per-user dir
// outside any checkout — never the gitignored output/ that caused issue #91.
const fallback = path.join(os.homedir(), '.config', 'mealplanshop');
assert.equal(resolveDataDir({}), fallback);
assert.equal(resolveDataDir({ MEALPLANSHOP_DATA_DIR: '   ' }), fallback);

// preferences.json sits inside the resolved data dir.
assert.equal(
  preferencesPath({ MEALPLANSHOP_DATA_DIR: '/tmp/mps-data' }),
  path.join('/tmp/mps-data', 'preferences.json')
);

// loadPreferences: the server and the CLI scripts (issue #141) both resolve
// preferences through this one function, so the CLI stops silently planning
// from defaults when a preferences.json exists.
const defaults: UserPreferences = {
  householdSize: 2,
  dietaryRestrictions: ['low carb', 'low sodium'],
  cuisinePreferences: ['Italian', 'Mexican', 'Asian', 'American'],
  excludedIngredients: [],
  pantryStaples: ['salt'],
  useUpIngredients: [],
  mealsByDay: {},
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dataDir-test-'));
const env = { MEALPLANSHOP_DATA_DIR: dir } as NodeJS.ProcessEnv;
try {
  // No preferences.json yet → defaults, untouched.
  assert.deepEqual(loadPreferences(defaults, env), defaults);

  // A stored file wins over defaults, field by field.
  const stored = {
    householdSize: 5,
    dietaryRestrictions: ['vegetarian'],
    cuisinePreferences: ['Thai', 'Indian'],
    excludedIngredients: ['mushrooms'],
  };
  fs.writeFileSync(preferencesPath(env), JSON.stringify(stored));
  const loaded = loadPreferences(defaults, env);
  assert.equal(loaded.householdSize, 5);
  assert.deepEqual(loaded.dietaryRestrictions, ['vegetarian']);
  assert.deepEqual(loaded.cuisinePreferences, ['Thai', 'Indian']);
  assert.deepEqual(loaded.excludedIngredients, ['mushrooms']);
  // Fields the stored file doesn't set still fall back to defaults.
  assert.deepEqual(loaded.pantryStaples, defaults.pantryStaples);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('dataDir: 11/11 passed');
