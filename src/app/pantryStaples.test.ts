import * as assert from 'node:assert/strict';
import { applyStapleChanges, planUsesStaples } from './pantryStaples';
import type { DayPlan, Meal } from '../../types';

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

const staples = ['olive oil', 'salt', 'butter'];

// Typing an item you're out of drops the staple it matches.
test('dropMatching removes the matched staple', () => {
  assert.deepEqual(
    applyStapleChanges(staples, { dropMatching: ['Olive Oil'] }),
    ['salt', 'butter']
  );
  // A longer name that ends in the staple counts as the staple.
  assert.deepEqual(
    applyStapleChanges(staples, { dropMatching: ['extra virgin olive oil'] }),
    ['salt', 'butter']
  );
});

test('dropMatching leaves staples a name only modifies, or does not match', () => {
  assert.deepEqual(
    applyStapleChanges(staples, {
      dropMatching: ['butter lettuce', 'paper towels'],
    }),
    staples
  );
});

// add is deduped against what the staples already cover.
test('add appends new staples, skipping covered and blank names', () => {
  assert.deepEqual(
    applyStapleChanges(staples, {
      add: ['soy sauce', 'Salt', 'extra virgin olive oil', ' '],
    }),
    [...staples, 'soy sauce']
  );
});

function mealWith(...names: string[]): Meal {
  return {
    name: 'm',
    ingredients: names.map((name) => ({ name, quantity: '1', onSale: false })),
    activeTime: 1,
    totalTime: 1,
    instructions: [],
    estimatedCalories: 1,
    estimatedCost: 1,
  };
}

test('planUsesStaples checks every meal ingredient', () => {
  const plan: DayPlan[] = [
    { day: 'Monday', dinner: mealWith('chicken', 'olive oil') },
  ];
  assert.equal(planUsesStaples(plan, ['olive oil']), true);
  assert.equal(planUsesStaples(plan, ['salt']), false);
});

console.log(`pantryStaples: ${passed}/${total} passed`);
if (failures.length > 0) {
  throw new Error(
    `pantryStaples: ${failures.length} test(s) failed: ${failures.join(', ')}`
  );
}
