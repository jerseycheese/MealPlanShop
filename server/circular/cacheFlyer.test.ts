import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getFlyerExtraction, type FetchFlyer } from './cacheFlyer';
import type { ExtractionResult } from '../../types';

const DAY_MS = 24 * 60 * 60 * 1000;

// Writes go through the real cache writer and reads through the real reader,
// against a temp dir. Only the Flipp fetch is faked.
export async function run(): Promise<void> {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flipp-cache-'));
  try {
    const flyer = (validThrough: string | null, degraded = false) => {
      let calls = 0;
      const fetchFlyer: FetchFlyer = async () => {
        calls += 1;
        const extraction: ExtractionResult = {
          items: [],
          storeName: 'ALDI',
          validThrough,
        };
        return { extraction, degraded };
      };
      return { fetchFlyer, calls: () => calls };
    };

    // Fresh entry: second pick is served from cache.
    const fresh = flyer('2999-12-31');
    await getFlyerExtraction(cacheDir, fresh.fetchFlyer, 1, 'ALDI', null);
    await getFlyerExtraction(cacheDir, fresh.fetchFlyer, 1, 'ALDI', null);
    assert.equal(fresh.calls(), 1, 'fresh entry is a cache hit');

    // Expired validThrough misses.
    const expired = flyer('2020-01-01');
    await getFlyerExtraction(cacheDir, expired.fetchFlyer, 2, 'ALDI', null);
    await getFlyerExtraction(cacheDir, expired.fetchFlyer, 2, 'ALDI', null);
    assert.equal(expired.calls(), 2, 'expired validThrough is a cache miss');

    // Null validThrough older than 8 days misses (writer stamps _cachedAt).
    const dateless = flyer(null);
    await getFlyerExtraction(cacheDir, dateless.fetchFlyer, 3, 'ALDI', null);
    await getFlyerExtraction(cacheDir, dateless.fetchFlyer, 3, 'ALDI', null);
    assert.equal(dateless.calls(), 1, 'young dateless entry is a cache hit');
    const later = new Date(Date.now() + 9 * DAY_MS);
    await getFlyerExtraction(
      cacheDir,
      dateless.fetchFlyer,
      3,
      'ALDI',
      null,
      later
    );
    assert.equal(dateless.calls(), 2, 'dateless entry ages out after 8 days');

    // Degraded fetch writes nothing.
    const degraded = flyer('2999-12-31', true);
    await getFlyerExtraction(cacheDir, degraded.fetchFlyer, 4, 'ALDI', null);
    assert.equal(
      fs.existsSync(path.join(cacheDir, '4.json')),
      false,
      'degraded result is not cached'
    );
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  console.log('cacheFlyer.test.ts: all assertions passed');
}
