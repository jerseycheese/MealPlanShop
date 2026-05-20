import { GoogleGenAI } from "@google/genai";
import { CATEGORY_ENUM } from "../../scripts/scan-circular";
import { GEMINI_MODEL } from "../../scripts/env";

// "skip" tells the caller to drop the item entirely (non-food/non-drink).
// Anything else must be one of the existing CATEGORY_ENUM values; unknown
// values fall back to "other" on the caller side.
const CATEGORIZE_ENUM = [...CATEGORY_ENUM, "skip"] as const;

const SCHEMA = {
  type: "object" as const,
  properties: {
    categories: {
      type: "array" as const,
      items: { type: "string" as const, enum: [...CATEGORIZE_ENUM] },
    },
  },
  required: ["categories"],
};

function buildPrompt(names: string[]): string {
  const allowed = CATEGORIZE_ENUM.join(", ");
  const numbered = names.map((n, i) => `${i + 1}. ${n}`).join("\n");
  return `Classify each grocery item into one of these categories: ${allowed}.

Use "skip" for anything that is NOT human food or drink — cleaning supplies, paper goods, health/beauty, baby food, pet food, flowers, household, electronics, clothing.

Return a JSON object { "categories": [...] } with one entry per item, in the same order. Length must equal ${names.length}.

Items:
${numbered}`;
}

export async function categorizeItems(names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const allOther = () => names.map(() => "other");
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ text: buildPrompt(names) }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
        httpOptions: { timeout: 30_000 },
      },
    });
    const parsed = JSON.parse(response.text ?? '{"categories":[]}');
    const cats: unknown = parsed?.categories;
    if (!Array.isArray(cats) || cats.length !== names.length) {
      console.warn(
        `[flipp/categorize] length mismatch: got ${Array.isArray(cats) ? cats.length : "non-array"}, expected ${names.length}; defaulting to "other"`,
      );
      return allOther();
    }
    return cats.map((c) => (typeof c === "string" ? c : "other"));
  } catch (err) {
    console.warn(
      `[flipp/categorize] failed, defaulting to "other":`,
      err instanceof Error ? err.message : err,
    );
    return allOther();
  }
}
