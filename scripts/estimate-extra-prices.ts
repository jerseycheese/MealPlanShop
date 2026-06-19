import { GoogleGenAI } from "@google/genai";
import type { ExtraItem } from "../types";
import { CATEGORY_ENUM } from "./scan-circular";
import { GEMINI_MODEL } from "./env";
import { requireGeminiKey } from "../server/secrets";
import { toReadableGeminiError } from "../server/geminiErrors";

// Allowed aisle for an extra item — the same vocabulary the meal-plan shopping
// list uses, so extras slot into existing sections. Non-food (paper towels, dish
// soap) lands in "other" rather than being dropped: the user asked for it.
function normalizeCategory(raw: unknown): string {
  return typeof raw === "string" && (CATEGORY_ENUM as readonly string[]).includes(raw)
    ? raw
    : "other";
}

// Pull a non-negative dollar amount out of whatever the model returns — a plain
// number, or a string like "$3.49" / "about 4 dollars". Rounds to cents. Returns
// null when there's nothing parseable, so an odd response just leaves the item
// uncosted rather than poisoning the total with NaN.
export function parsePrice(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw === "string") {
    const match = raw.replace(/,/g, "").match(/\d+(\.\d+)?/);
    if (match) {
      const n = parseFloat(match[0]);
      if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
    }
  }
  return null;
}

const priceSchema = {
  type: "object",
  properties: {
    prices: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number" },
          category: { type: "string", enum: [...CATEGORY_ENUM] },
        },
        required: ["name", "price", "category"],
      },
    },
  },
  required: ["prices"],
};

// Estimate a rough single-unit US grocery price AND aisle category for each name,
// in one call. Best-effort: the caller treats a thrown error (no key, API
// failure) as "leave them uncosted" (price null, category "other").
export async function estimateExtraItemPrices(
  names: string[],
): Promise<ExtraItem[]> {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return [];

  try {
    const ai = new GoogleGenAI({ apiKey: requireGeminiKey() });
    const prompt =
      "For each item below, give the typical current US grocery store price in US " +
      "dollars (a realistic single-unit retail price — one carton, one bottle, one " +
      "package) and the store aisle it belongs to, chosen from: " +
      `${CATEGORY_ENUM.join(", ")}. Use "other" for non-food household goods ` +
      "(paper towels, dish soap, etc.). Items:\n" +
      clean.map((n) => `- ${n}`).join("\n");
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        systemInstruction:
          "You estimate typical US grocery prices and aisle categories. Respond only with the requested JSON.",
        responseMimeType: "application/json",
        responseJsonSchema: priceSchema,
        httpOptions: { timeout: 30_000 },
      },
    });
    const parsed = JSON.parse(response.text ?? "{}");
    const arr = Array.isArray(parsed?.prices) ? parsed.prices : [];
    const byName = new Map<string, { price: number | null; category: string }>();
    for (const p of arr) {
      if (p && typeof p.name === "string") {
        byName.set(p.name.trim().toLowerCase(), {
          price: parsePrice(p.price),
          category: normalizeCategory(p.category),
        });
      }
    }
    return clean.map((name) => {
      const hit = byName.get(name.toLowerCase());
      return { name, price: hit?.price ?? null, category: hit?.category ?? "other" };
    });
  } catch (err) {
    throw toReadableGeminiError(err, GEMINI_MODEL);
  }
}
