import { strict as assert } from 'node:assert';
import {
  detectLoyalty,
  parseItem,
  effectivePrice,
  parseUnit,
  daysUntil,
  hasExpired,
  toMerchants,
  isFlippCacheStale,
  type FlippItemDetail,
} from './sources/flipp';

// detectLoyalty — table of loyalty markers seen across the 10 grocers
for (const [pre, dis, expected, label] of [
  ['MVP', null, true, 'Food Lion MVP prefix'],
  ['MVP 2/', 'LIMIT 4', true, 'MVP multi-buy'],
  [null, 'W/O VIC Card $4.99 EA', true, 'Harris Teeter VIC in disclaimer'],
  [null, 'With Plus Card', true, 'Plus card disclaimer'],
  [null, 'Kroger Plus members save'],
  [
    null,
    'Beer and Wine may not be available in all locations. Check your store.',
    false,
    "boilerplate disclaimer mentioning 'locations' but not loyalty",
  ],
  ['', 'Regular shelf price', false, 'no loyalty marker'],
] as const) {
  const actual = detectLoyalty(pre as string | null, dis as string | null);
  const want = (expected as boolean | undefined) ?? true;
  assert.equal(actual, want, `detectLoyalty: ${label ?? `${pre} | ${dis}`}`);
}

// effectivePrice — handles single, multi-buy ("MVP 2/"), and null
assert.equal(effectivePrice('3.99', null), 3.99, 'single price');
assert.equal(effectivePrice('3.99', 'MVP'), 3.99, 'MVP single price unchanged');
assert.equal(effectivePrice('5', 'MVP 2/'), 2.5, '2 for $5 -> $2.50/unit');
assert.equal(effectivePrice('9', '3/'), 3, '3 for $9 -> $3.00/unit');
assert.equal(effectivePrice(null, null), null, 'null price -> null');
assert.equal(effectivePrice('0', null), null, 'zero price -> null');
assert.equal(effectivePrice('', 'MVP'), null, 'empty price -> null');

// parseUnit — common Flipp price_text shapes
assert.equal(parseUnit('LB', null), 'per lb');
assert.equal(parseUnit('PER LB', null), 'per lb');
assert.equal(parseUnit('EA', null), 'each');
assert.equal(parseUnit(null, '12 Oz.\nSelect Varieties'), '12 Oz.');
assert.equal(parseUnit(null, null), 'each');

// parseItem — full Food Lion sample (price comes from listItem, not detail)
const detail: FlippItemDetail = {
  id: 1012392247,
  name: 'Food Lion Fully Cooked Bacon',
  brand: 'Food Lion',
  price: null,
  price_text: 'EA',
  pre_price_text: 'MVP',
  disclaimer_text: 'W/O MVP Card Regular Retail',
  description: '2.1 Oz. Pkg.\nSelect Varieties',
  sku: '00035826061480',
  sale_story: 'HOT SALE!!!!',
  ttm_url: null,
};
const item = parseItem(
  { id: 1, name: 'Food Lion Fully Cooked Bacon', price: '3.99' },
  detail
);
assert.ok(item, 'parseItem should return an item');
assert.equal(item!.item, 'Food Lion Fully Cooked Bacon');
assert.equal(item!.price, 3.99);
assert.equal(item!.unit, 'each');
assert.equal(item!.requiresLoyaltyCard, true);
assert.match(
  item!.priceNote ?? '',
  /W\/O MVP/,
  'priceNote carries non-loyalty disclaimer'
);
assert.equal(
  item!.category,
  'other',
  'parseItem leaves category for the categorize step'
);

// parseItem — multi-buy with non-MVP store and a real list price
const multiDetail: FlippItemDetail = {
  id: 2,
  name: 'Chex Mix or Bugles',
  price: null,
  price_text: null,
  pre_price_text: 'MVP 2/',
  disclaimer_text: 'W/O MVP Card Regular Retail',
  description: '8.75 Oz.',
  sale_story: 'HOT SALE!!!!',
};
const multi = parseItem(
  { id: 2, name: 'Chex Mix or Bugles', price: '5' },
  multiDetail
);
assert.ok(multi);
assert.equal(multi!.price, 2.5, 'multi-buy divides list price by qty');
assert.match(
  multi!.priceNote ?? '',
  /2 for \$5/,
  'priceNote describes the multi-buy'
);

// parseItem — drops items with no parseable price
const noPrice = parseItem(
  { id: 3, name: 'Digital Coupons', price: null },
  { id: 3, name: 'Digital Coupons' }
);
assert.equal(noPrice, null, 'items with null price are dropped');

// daysUntil — calendar days to a date-only valid_to, counted in local time.
// A fixed local "now" (mid-morning June 5) keeps these deterministic, and a
// late-evening "now" on the same day proves the count no longer drifts with the
// time of day the way the old UTC-instant version did.
const morning = new Date(2026, 5, 5, 10, 0); // Jun 5 2026, 10:00 local
const lateNight = new Date(2026, 5, 5, 23, 30); // same day, 23:30 local
assert.equal(daysUntil('2026-06-18', morning), 13, '13 days out');
assert.equal(daysUntil('2026-06-18', lateNight), 13, 'stable through the day');
assert.equal(daysUntil('2026-06-05', morning), 0, 'ends today');
assert.equal(daysUntil('2026-06-06', morning), 1, 'ends tomorrow');
assert.equal(daysUntil('2026-06-07', morning), 2, 'expiring soon (<=2)');
assert.equal(
  daysUntil('2026-06-01', morning),
  0,
  'already expired clamps to 0'
);
assert.equal(daysUntil('', morning), 0, 'unparseable clamps to 0');

// hasExpired — a date-only validThrough is good through the END of that local
// day. `new Date("2026-06-05")` is UTC midnight, which dropped the cache the
// evening before west of UTC (and at the start of the day in UTC itself).
assert.equal(
  hasExpired('2026-06-05', lateNight),
  false,
  'valid late on its last day'
);
assert.equal(
  hasExpired('2026-06-04', morning),
  true,
  'expired after its last day'
);
assert.equal(hasExpired('', morning), false, 'unparseable never expires');

// toMerchants — an expired flyer is dropped, not sorted to the top as "Ends today"
const picker = toMerchants(
  [
    { id: 1, merchant: 'Harris Teeter', valid_to: '2026-05-15' },
    { id: 2, merchant: 'ALDI', valid_to: '2026-06-11' },
    { id: 3, merchant: 'Food Lion', valid_to: '2026-06-07' },
  ],
  morning
);
assert.deepEqual(
  picker.map((m) => [m.name, m.daysLeft]),
  [
    ['Food Lion', 2],
    ['ALDI', 6],
  ],
  'expired flyer dropped, rest soonest-ending first'
);

// isFlippCacheStale — _cachedAt bounds an entry whose validThrough is null
const dayMs = 24 * 60 * 60 * 1000;
assert.equal(
  isFlippCacheStale({ validThrough: '2026-06-04' }, morning),
  true,
  'past validThrough'
);
assert.equal(
  isFlippCacheStale(
    { validThrough: null, _cachedAt: morning.getTime() - 2 * dayMs },
    morning
  ),
  false,
  'recent null-date entry kept'
);
assert.equal(
  isFlippCacheStale(
    { validThrough: null, _cachedAt: morning.getTime() - 9 * dayMs },
    morning
  ),
  true,
  'old null-date entry expires'
);

console.log('flipp.test.ts: all assertions passed');
