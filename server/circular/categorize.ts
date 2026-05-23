import { GoogleGenAI } from "@google/genai";
import { CATEGORY_ENUM } from "../../scripts/scan-circular";
import { GEMINI_MODEL } from "../../scripts/env";

// "skip" tells the caller to drop the item entirely (non-food/non-drink).
// Anything else must be one of the existing CATEGORY_ENUM values; unknown
// values fall back to "other" on the caller side.
const CATEGORIZE_ENUM = [...CATEGORY_ENUM, "skip"] as const;

// One Gemini call per ~30 items. A single call over a whole large flyer
// (100+ items) reliably hit the 30s timeout and fell back to all-"other",
// so we split into batches that each finish well under the deadline.
const CATEGORIZE_BATCH = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

// Orchestrates batched categorization. Each batch is classified independently
// so a slow, failed, or malformed batch falls back to "other" on its own
// without poisoning the rest. The classifier is injected so this stays pure
// and testable without hitting the network.
export async function categorizeInBatches(
  names: string[],
  batchSize: number,
  classifyBatch: (batch: string[]) => Promise<unknown>,
): Promise<string[]> {
  if (names.length === 0) return [];
  const batches = chunk(names, batchSize);
  const results = await Promise.all(
    batches.map(async (batch) => {
      try {
        const cats = await classifyBatch(batch);
        if (!Array.isArray(cats) || cats.length !== batch.length) {
          console.warn(
            `[flipp/categorize] batch length mismatch: got ${Array.isArray(cats) ? cats.length : "non-array"}, expected ${batch.length}; defaulting to "other"`,
          );
          return batch.map(() => "other");
        }
        return cats.map((c) => (typeof c === "string" ? c : "other"));
      } catch (err) {
        console.warn(
          `[flipp/categorize] batch failed, defaulting to "other":`,
          err instanceof Error ? err.message : err,
        );
        return batch.map(() => "other");
      }
    }),
  );
  return results.flat();
}

async function classifyBatchViaGemini(names: string[]): Promise<unknown> {
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
  return parsed?.categories;
}

export async function categorizeItems(names: string[]): Promise<string[]> {
  return categorizeInBatches(names, CATEGORIZE_BATCH, classifyBatchViaGemini);
}
