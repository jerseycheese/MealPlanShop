import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { GoogleGenAI } from "@google/genai";

// -- Types --

interface SaleItem {
  item: string;
  price: number;
  unit: string;
  category: string;
}

interface ExtractionResult {
  items: SaleItem[];
  storeName: string | null;
  validThrough: string | null;
}

// -- Schema for structured output --

const extractionSchema = {
  type: "object" as const,
  properties: {
    items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          item: { type: "string" as const },
          price: { type: "number" as const },
          unit: { type: "string" as const },
          category: {
            type: "string" as const,
            enum: [
              "produce",
              "meat",
              "seafood",
              "dairy",
              "bakery",
              "frozen",
              "pantry",
              "beverages",
              "snacks",
              "deli",
              "other",
            ],
          },
        },
        required: ["item", "price", "unit", "category"],
      },
    },
    storeName: { type: ["string", "null"] as const },
    validThrough: { type: ["string", "null"] as const },
  },
  required: ["items", "storeName", "validThrough"],
};

// -- Main --

export async function scanCircular(
  imagePath: string
): Promise<ExtractionResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = fs.readFileSync(
    path.join(__dirname, "../prompts/circular-extraction.md"),
    "utf-8"
  );

  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString("base64");

  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mimeType = mimeTypes[ext] || "image/jpeg";

  console.log(`Scanning circular: ${imagePath}`);
  console.log(`Image size: ${(imageBuffer.length / 1024).toFixed(0)} KB`);

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
      { text: prompt },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: extractionSchema,
    },
  });

  const result: ExtractionResult = JSON.parse(response.text ?? "{}");

  console.log(`Extracted ${result.items.length} sale items`);
  if (result.storeName) console.log(`Store: ${result.storeName}`);
  if (result.validThrough) console.log(`Valid through: ${result.validThrough}`);

  return result;
}

// -- CLI entry point --

async function main() {
  const imagePath = process.argv[2];

  if (!imagePath) {
    console.error("Usage: npm run scan -- <path-to-circular-image>");
    console.error("Example: npm run scan -- samples/weekly-circular.jpg");
    process.exit(1);
  }

  if (!fs.existsSync(imagePath)) {
    console.error(`File not found: ${imagePath}`);
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env file");
    console.error("Get one at: https://aistudio.google.com/apikey");
    process.exit(1);
  }

  const result = await scanCircular(imagePath);

  // Write output
  const outputPath = path.join(__dirname, "../output/extraction.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nOutput written to: ${outputPath}`);

  // Print summary table
  console.log("\n--- Sale Items ---");
  for (const item of result.items) {
    const priceStr = `$${item.price.toFixed(2)}`;
    console.log(
      `  [${item.category.padEnd(10)}] ${item.item.padEnd(40)} ${priceStr.padStart(8)} ${item.unit}`
    );
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
