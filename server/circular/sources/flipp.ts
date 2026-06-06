import * as crypto from "node:crypto";
import type { SaleItem, ExtractionResult } from "../../../types";
import {
  deduplicateItems,
  validateValidThrough,
} from "../../../scripts/scan-circular";
import { categorizeItems } from "../categorize";
import { parseLocalDate } from "../../../parseLocalDate";

const BASE = "https://flyers-ng.flippback.com/api/flipp";
const ITEM_BATCH = 10;
const FLIPP_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, timeoutMs = FLIPP_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Flipp request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Many merchants surface at any given ZIP (Best Buy, Home Depot, etc).
// Restrict the picker to grocery chains — these are the only ones whose
// flyers feed a meal plan. Names match the `merchant` field exactly.
const GROCERY_MERCHANTS = new Set([
  "ALDI",
  "Costco",
  "Food Lion",
  "Grocery Outlet",
  "Harris Teeter",
  "Kroger",
  "Lidl",
  "Publix",
  "Walmart",
  "Wegman's",
  "Wegmans",
  "Whole Foods Market",
  "Trader Joe's",
  "ShopRite",
  "Giant",
  "Stop & Shop",
  "Safeway",
  "Albertsons",
  "Sprouts Farmers Market",
  "H-E-B",
  "Meijer",
  "Sam's Club",
  "Target",
]);

const LOYALTY_REGEX =
  /\b(MVP|VIC|Plus Card|Plus Member|Kroger Plus|ShopRite Price Plus|Card Price|w\/?\s*card)\b/i;

// Boilerplate disclaimers that aren't pricing info — we shouldn't surface
// these in priceNote or treat them as loyalty markers.
const BOILERPLATE_DISCLAIMER = /not be available|check your store|locations/i;

export interface FlippMerchant {
  flyerId: number;
  merchantId: string | number | null;
  name: string;
  validFrom: string;
  validTo: string;
  daysLeft: number;
  logoUrl: string | null;
}

interface FlippFlyerRaw {
  id: number;
  name?: string;
  merchant?: string;
  merchant_id?: string | number;
  merchant_logo?: string;
  valid_from?: string;
  valid_to?: string;
}

interface FlippListItem {
  id: number;
  flyer_id?: number;
  name?: string;
  brand?: string;
  price?: string | number | null;
  cutout_image_url?: string | null;
}

export interface FlippItemDetail {
  id: number;
  name?: string;
  brand?: string | null;
  price?: string | number | null;
  price_text?: string | null;
  pre_price_text?: string | null;
  disclaimer_text?: string | null;
  description?: string | null;
  sku?: string | null;
  sale_story?: string | null;
  ttm_url?: string | null;
}

export function generateSid(): string {
  // Flipp's API only accepts numeric SIDs, so we can't use hex/UUID.
  // randomInt is unbiased, unlike `randomBytes() % 10`.
  let s = "";
  for (let i = 0; i < 16; i++) s += crypto.randomInt(0, 10).toString();
  return s;
}

// Rank a flyer by how likely it is to be the merchant's grocery circular.
// Higher = better. "Weekly Ad"/"Grocery" wins; "Home", "Apparel", "Outdoor",
// "In Store Ad" (ALDI's non-grocery insert), and "Monthly" lose. Ties broken
// by valid_from so the freshest week wins among equals.
function flyerScore(f: FlippFlyerRaw): number {
  const name = (f.name ?? "").toLowerCase();
  let score = 0;
  if (/\bweekly\b/.test(name)) score += 100;
  if (/\bgrocery\b/.test(name)) score += 100;
  if (/\bweekly flyer\b/.test(name)) score += 20;
  if (/\bweekly ad\b/.test(name)) score += 20;
  if (/\b(home|apparel|outdoor|monthly|in store ad|electronics|seasonal|book)\b/.test(name)) {
    score -= 80;
  }
  // Tiebreaker: encode valid_from as a numeric suffix (epoch days) so ranking
  // is deterministic without comparing two fields separately.
  const t = new Date(f.valid_from ?? "").getTime();
  if (Number.isFinite(t)) score += t / 86_400_000_000; // tiny nudge, never overwhelms category signal
  return score;
}

// Whole calendar days from today until a date-only "valid_to" (e.g.
// "2026-06-18"), counted in local time. 0 means it ends today (or already
// passed). Parsing valid_to as local — not UTC — midnight keeps the count
// stable through the day and correct west of UTC, where `new Date("2026-06-18")`
// lands the evening before. Both ends sit at local midnight, so the only
// sub-day wobble is a DST hour, which round() absorbs.
export function daysUntil(dateOnly: string, now: Date = new Date()): number {
  const end = parseLocalDate(dateOnly);
  if (!end) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = end.getTime() - today.getTime();
  return Math.max(0, Math.round(diff / (24 * 60 * 60 * 1000)));
}

export async function listFlyers(postalCode: string): Promise<FlippMerchant[]> {
  const sid = generateSid();
  const url = `${BASE}/data?locale=en&postal_code=${encodeURIComponent(postalCode)}&sid=${sid}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Flipp listFlyers ${res.status}`);
  const data = (await res.json()) as { flyers?: unknown };
  const flyers = Array.isArray(data.flyers)
    ? (data.flyers as FlippFlyerRaw[])
    : [];

  // Group by merchant — Flipp returns multiple flyers per merchant (e.g.
  // ALDI ships an "In Store Ad" full of kitchen mats AND a "Weekly Ad" full
  // of groceries). Score each flyer's name so the grocery flyer wins,
  // falling back to latest valid_from when names are equally vague.
  const byMerchant = new Map<string, FlippFlyerRaw>();
  for (const f of flyers) {
    const name = (f.merchant ?? "").trim();
    if (!name) continue;
    if (!GROCERY_MERCHANTS.has(name)) continue;
    const existing = byMerchant.get(name);
    if (!existing || flyerScore(f) > flyerScore(existing)) {
      byMerchant.set(name, f);
    }
  }

  const merchants: FlippMerchant[] = [];
  for (const f of byMerchant.values()) {
    if (!f.valid_to) continue;
    merchants.push({
      flyerId: f.id,
      merchantId: f.merchant_id ?? null,
      name: (f.merchant ?? "").trim(),
      validFrom: f.valid_from ?? "",
      validTo: f.valid_to,
      daysLeft: daysUntil(f.valid_to),
      logoUrl: f.merchant_logo ?? null,
    });
  }
  merchants.sort((a, b) => a.daysLeft - b.daysLeft);
  return merchants;
}

async function fetchItemList(flyerId: number, sid: string): Promise<FlippListItem[]> {
  const url = `${BASE}/flyers/${flyerId}/flyer_items?locale=en&sid=${sid}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Flipp fetchItemList ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? (data as FlippListItem[]) : [];
}

async function fetchItemDetail(itemId: number, sid: string): Promise<FlippItemDetail | null> {
  const url = `${BASE}/flyer_items/${itemId}?locale=en&sid=${sid}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data && typeof data === "object" ? (data as FlippItemDetail) : null;
}

async function fetchDetailsBatched(
  ids: number[],
  sid: string,
): Promise<Map<number, FlippItemDetail>> {
  const out = new Map<number, FlippItemDetail>();
  for (let i = 0; i < ids.length; i += ITEM_BATCH) {
    const chunk = ids.slice(i, i + ITEM_BATCH);
    // allSettled so one timed-out/failed detail fetch doesn't abort the whole
    // flyer — we just drop that item and keep the rest.
    const results = await Promise.allSettled(
      chunk.map((id) => fetchItemDetail(id, sid)),
    );
    for (let j = 0; j < chunk.length; j++) {
      const r = results[j];
      const detail = r.status === "fulfilled" ? r.value : null;
      if (detail) out.set(chunk[j], detail);
    }
  }
  return out;
}

// ---- Parsing ----

export function detectLoyalty(
  prePriceText: string | null | undefined,
  disclaimerText: string | null | undefined,
): boolean {
  const pre = prePriceText ?? "";
  const dis = disclaimerText ?? "";
  // Skip boilerplate disclaimers that mention "card" only incidentally.
  const disForCheck = BOILERPLATE_DISCLAIMER.test(dis) ? "" : dis;
  return LOYALTY_REGEX.test(pre) || LOYALTY_REGEX.test(disForCheck);
}

export function parseUnit(
  priceText: string | null | undefined,
  description: string | null | undefined,
): string {
  const t = (priceText ?? "").toUpperCase();
  if (/\bLB\b/.test(t) || /\bPER LB\b/.test(t)) return "per lb";
  if (/\bOZ\b/.test(t)) return "per oz";
  if (/\bEA\b/.test(t) || /\bEACH\b/.test(t)) {
    // Capture multi-buy modifier when present, e.g. "EA WHEN YOU BUY ANY 12".
    const m = t.match(/EA\s+(WHEN.*|W\/.*|WHEN YOU.*)/);
    return m ? `each (${m[1].toLowerCase()})` : "each";
  }
  // Fall back to a pack-size hint from description ("12 Oz." style).
  const desc = (description ?? "").split("\n")[0]?.trim();
  return desc || "each";
}

// pre_price_text "MVP 2/" means "2 for {list.price}"; "MVP 3/" means "3 for {price}".
// Returns the multi-buy quantity if present, else null.
function multiBuyQty(prePriceText: string | null | undefined): number | null {
  const m = (prePriceText ?? "").match(/(\d+)\s*\/\s*$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 1 ? n : null;
}

export function effectivePrice(
  listPrice: string | number | null | undefined,
  prePriceText: string | null | undefined,
): number | null {
  if (listPrice === null || listPrice === undefined || listPrice === "") return null;
  const raw = typeof listPrice === "string" ? parseFloat(listPrice) : listPrice;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const qty = multiBuyQty(prePriceText);
  if (qty) return Math.round((raw / qty) * 100) / 100;
  return raw;
}

export function buildPriceNote(
  detail: FlippItemDetail,
  listPrice?: string | number | null,
): string | undefined {
  const parts: string[] = [];
  const sale = (detail.sale_story ?? "").trim();
  if (sale && !/^HOT SALE!*$/i.test(sale)) parts.push(sale);

  const qty = multiBuyQty(detail.pre_price_text);
  // detail.price is almost always null from Flipp; the real price lives on
  // the list payload, so the caller passes it through here.
  const total = detail.price ?? listPrice;
  if (qty && total !== null && total !== undefined && total !== "") {
    parts.push(`${qty} for $${total}`);
  }

  const dis = (detail.disclaimer_text ?? "").trim();
  if (dis && !BOILERPLATE_DISCLAIMER.test(dis)) {
    // Disclaimers often include the non-loyalty price and limits — both useful.
    const cleaned = dis.replace(/\s*\n+\s*/g, " · ");
    parts.push(cleaned);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

export function parseItem(
  listItem: FlippListItem,
  detail: FlippItemDetail | undefined,
): SaleItem | null {
  const name = (listItem.name ?? "").trim();
  if (!name) return null;
  const d = detail ?? ({} as FlippItemDetail);
  const price = effectivePrice(listItem.price, d.pre_price_text);
  if (price === null) return null;
  return {
    item: name,
    price,
    unit: parseUnit(d.price_text, d.description),
    category: "other", // filled in by the categorize step
    priceNote: buildPriceNote(d, listItem.price),
    requiresLoyaltyCard: detectLoyalty(d.pre_price_text, d.disclaimer_text),
  };
}

export interface FetchFlyerOptions {
  storeName?: string | null;
  validThrough?: string | null;
}

export async function fetchFlyer(
  flyerId: number,
  opts: FetchFlyerOptions = {},
): Promise<ExtractionResult> {
  const sid = generateSid();
  const list = await fetchItemList(flyerId, sid);

  // Pre-filter list to items that have any chance of being a real product:
  // a name AND a real price. (Cuts out "Shop & Earn", "Digital Coupons" rows.)
  const eligible = list.filter((i) => i.name && i.price && i.price !== "0" && i.price !== "0.00");
  const ids = eligible.map((i) => i.id);
  const details = await fetchDetailsBatched(ids, sid);

  let items: SaleItem[] = [];
  for (const li of eligible) {
    const parsed = parseItem(li, details.get(li.id));
    if (parsed) items.push(parsed);
  }

  items = deduplicateItems(items);

  // Categorize as a single batched Gemini call. Returns same-length array
  // including a "skip" sentinel for non-food items so we can drop them.
  if (items.length) {
    const categories = await categorizeItems(items.map((i) => i.item));
    const kept: SaleItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const cat = categories[i] ?? "other";
      if (cat === "skip") continue;
      kept.push({ ...items[i], category: cat });
    }
    items = kept;
  }

  return {
    items,
    storeName: opts.storeName ?? null,
    validThrough: validateValidThrough(opts.validThrough ?? null),
  };
}
