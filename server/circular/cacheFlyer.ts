import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ExtractionResult } from '../../types';
import { readJsonOrNull, writeJsonAtomic } from '../lib/jsonStore';
import {
  isFlippCacheStale,
  type FetchFlyerOptions,
  type FetchFlyerResult,
} from './sources/flipp';

export type FetchFlyer = (
  flyerId: number,
  opts: FetchFlyerOptions
) => Promise<FetchFlyerResult>;

// Cache-first: Flipp is an unofficial endpoint, so each flyer is fetched at most
// once until its cache entry goes stale.
export async function getFlyerExtraction(
  cacheDir: string,
  fetchFlyer: FetchFlyer,
  flyerId: number,
  merchantName: string,
  validThrough: string | null,
  now: Date = new Date()
): Promise<ExtractionResult> {
  const cached = readFlippCache(cacheDir, flyerId, now);
  if (cached) {
    // Carry through caller-supplied store/validThrough in case the cached
    // metadata is missing (e.g. early cache entries).
    return {
      items: cached.items,
      storeName: cached.storeName ?? merchantName,
      validThrough: cached.validThrough ?? validThrough,
    };
  }
  const { extraction, degraded } = await fetchFlyer(flyerId, {
    storeName: merchantName,
    validThrough,
  });
  // A degraded categorization let non-food items through as "other". Serve it
  // this once, but skip the cache so the next pick re-fetches instead of
  // pinning it for days.
  if (!degraded) writeFlippCache(cacheDir, flyerId, extraction);
  return extraction;
}

function readFlippCache(
  cacheDir: string,
  flyerId: number,
  now: Date
): ExtractionResult | null {
  const data = readJsonOrNull<ExtractionResult & { _cachedAt?: unknown }>(
    path.join(cacheDir, `${flyerId}.json`)
  );
  if (!data || isFlippCacheStale(data, now)) return null;
  return {
    items: data.items,
    storeName: data.storeName,
    validThrough: data.validThrough,
  };
}

function writeFlippCache(
  cacheDir: string,
  flyerId: number,
  result: ExtractionResult
) {
  fs.mkdirSync(cacheDir, { recursive: true });
  writeJsonAtomic(path.join(cacheDir, `${flyerId}.json`), {
    ...result,
    _cachedAt: Date.now(),
  });
}
