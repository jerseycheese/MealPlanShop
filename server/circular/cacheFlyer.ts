import type { ExtractionResult } from '../../types';
import type { FetchFlyerResult } from './sources/flipp';

// A degraded categorization let non-food items through as "other". Serve it
// this once, but skip the cache so the next pick re-fetches instead of pinning
// it for days.
export async function fetchAndCacheFlyer(
  fetch: () => Promise<FetchFlyerResult>,
  writeCache: (extraction: ExtractionResult) => void
): Promise<ExtractionResult> {
  const { extraction, degraded } = await fetch();
  if (!degraded) writeCache(extraction);
  return extraction;
}
