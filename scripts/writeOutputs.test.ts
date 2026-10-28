import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeExtraction } from './scan-circular';
import { writeMealPlan, DEFAULT_PREFERENCES } from './generate-meal-plan';
import { computePrefsFingerprint } from '../server/prefs-fingerprint';

// The pipeline CLI must leave behind the same two files the server reads, so
// both writers land a readable file at the path they're given.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mps-write-'));
try {
  const extraction = {
    storeName: 'Test Mart',
    validThrough: null,
    items: [],
  };
  const extractionPath = writeExtraction(
    extraction,
    path.join(dir, 'nested', 'extraction.json')
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(extractionPath, 'utf-8')),
    extraction
  );

  // The CLI plan must carry the same sale-item decoration the server adds
  // (loyalty flag and per-lb unit), or the UI loses both on a CLI run.
  const { result, outputPath } = writeMealPlan(
    {
      weekPlan: [],
      shoppingList: [
        {
          name: 'chicken breast',
          quantity: '2 lb',
          onSale: true,
          salePrice: 1.99,
          category: 'meat',
        },
      ],
    },
    [
      {
        item: 'chicken breast',
        price: 1.99,
        unit: 'lb',
        category: 'meat',
        requiresLoyaltyCard: true,
      },
    ],
    DEFAULT_PREFERENCES,
    path.join(dir, 'meal-plan.json')
  );
  const onDisk = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  assert.deepEqual(onDisk, result);
  assert.ok(onDisk.planId, 'plan gets a planId');
  assert.equal(
    onDisk.prefsFingerprint,
    computePrefsFingerprint(DEFAULT_PREFERENCES)
  );
  assert.equal(onDisk.shoppingList[0].requiresLoyaltyCard, true);
  assert.equal(onDisk.shoppingList[0].unit, 'lb');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
