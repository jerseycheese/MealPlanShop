import { strict as assert } from 'node:assert';
import { fetchAndCacheFlyer } from './cacheFlyer';
import type { ExtractionResult } from '../../types';

export async function run(): Promise<void> {
  const extraction: ExtractionResult = {
    items: [],
    storeName: 'ALDI',
    validThrough: null,
  };

  for (const degraded of [false, true]) {
    const written: ExtractionResult[] = [];
    const out = await fetchAndCacheFlyer(
      async () => ({ extraction, degraded }),
      (e) => written.push(e)
    );
    assert.equal(out, extraction, 'returns the extraction either way');
    assert.equal(
      written.length,
      degraded ? 0 : 1,
      degraded ? 'degraded result is not cached' : 'clean result is cached'
    );
  }

  console.log('cacheFlyer.test.ts: all assertions passed');
}
