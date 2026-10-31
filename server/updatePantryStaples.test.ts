import * as assert from 'node:assert/strict';
import { DEFAULT_PREFERENCES } from '../scripts/generate-meal-plan';
import { updatePantryStaples } from './updatePantryStaples';
import { ValidationError, validatePreferences } from './validatePreferences';

let passed = 0;
let total = 0;
const failures: string[] = [];
function test(name: string, fn: () => void): void {
  total++;
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name);
    console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
  }
}

const prefs = validatePreferences({ ...DEFAULT_PREFERENCES, pantryStaples: [] });
const longName = 'low-sodium chicken broth, 32 oz carton (2)';

// A flyer name too long to be a staple used to 400 the whole restock.
test('a restock skips names too long to be a staple and saves the rest', () => {
  const { saved, skipped } = updatePantryStaples(prefs, {
    add: [longName, 'rice'],
  });
  assert.deepEqual(saved?.pantryStaples, ['rice']);
  assert.deepEqual(skipped, [longName]);
});

test('a restock past the staples cap is refused with a clear message', () => {
  const full = validatePreferences({
    ...prefs,
    pantryStaples: Array.from({ length: 50 }, (_, i) => `staple ${i}`),
  });
  assert.throws(
    () => updatePantryStaples(full, { add: ['rice'] }),
    (err: unknown) =>
      err instanceof ValidationError && /Pantry staples are full/.test(err.message)
  );
});

console.log(`updatePantryStaples: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `updatePantryStaples: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
