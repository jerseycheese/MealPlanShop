import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanImage } from './scan-circular';

// A multi-item extraction from the model comes back as the page's sale items.
export async function run(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-image-test-'));
  const imagePath = path.join(dir, 'page-1.jpg');
  fs.writeFileSync(imagePath, '');
  const items = [
    { item: 'Chicken Breast', price: 1.99, unit: 'lb', category: 'meat' },
    {
      item: 'Strawberries',
      price: 2.5,
      unit: 'each',
      category: 'produce',
      priceNote: '2 for $5',
    },
  ];
  try {
    const result = await scanImage(imagePath, 'prompt', async () => ({
      items,
      storeName: 'ShopRite',
      validThrough: 'November 5, 2026',
    }));
    assert.deepEqual(result, {
      items,
      storeName: 'ShopRite',
      validThrough: 'November 5, 2026',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
