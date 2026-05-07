import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { GoogleGenAI } from "@google/genai";

// -- Types --

interface SaleItem {
  item: string;
  price: number;
  unit: string;
  category: string;
  priceNote?: string;
}

interface ExtractionResult {
  items: SaleItem[];
  storeName: string | null;
  validThrough: string | null;
}

export type ScanProgressEvent =
  | { type: "preparing" }
  | { type: "page"; page: number; pages: number; storeName: string | null };

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
          priceNote: { type: "string" as const },
        },
        required: ["item", "price", "unit", "category"],
      },
    },
    storeName: { type: ["string", "null"] as const },
    validThrough: { type: ["string", "null"] as const },
  },
  required: ["items", "storeName", "validThrough"],
};

// -- Single image scanning --

async function scanImage(
  ai: GoogleGenAI,
  imagePath: string,
  prompt: string
): Promise<ExtractionResult> {
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

  return JSON.parse(response.text ?? '{"items":[],"storeName":null,"validThrough":null}');
}

// -- PDF conversion --

function convertPdfToImages(pdfPath: string): string[] {
  const tmpDir = path.join(path.dirname(pdfPath), ".pdf-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });

  const prefix = path.join(tmpDir, "page");
  execSync(`pdftoppm -r 150 -jpeg "${pdfPath}" "${prefix}"`, {
    stdio: "pipe",
  });

  const files = fs
    .readdirSync(tmpDir)
    .filter((f) => f.endsWith(".jpg"))
    .sort()
    .map((f) => path.join(tmpDir, f));

  console.log(`Converted PDF to ${files.length} page images`);
  return files;
}

function cleanupTmpImages(pdfPath: string) {
  const tmpDir = path.join(path.dirname(pdfPath), ".pdf-tmp");
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true });
  }
}

// -- Filtering --

const EXCLUDE_KEYWORDS = [
  "gerber",
  "happy tot",
  "happy baby",
  "plum organics",
  "beech-nut",
  "beech nut",
  "earth's best",
  "sprout organic",
  "baby food",
  "toddler",
  "infant cereal",
  "baby cereal",
  "stage 1",
  "stage 2",
  "stage 3",
  "stage 4",
];

function filterNonMealItems(items: SaleItem[]): SaleItem[] {
  return items.filter((item) => {
    const name = item.item.toLowerCase();
    return !EXCLUDE_KEYWORDS.some((kw) => name.includes(kw));
  });
}

// -- Deduplication --

function deduplicateItems(items: SaleItem[]): SaleItem[] {
  const seen = new Map<string, SaleItem>();
  for (const item of items) {
    // Key on lowercase item name + price to catch duplicates across pages
    const key = `${item.item.toLowerCase()}|${item.price}`;
    if (!seen.has(key)) {
      seen.set(key, item);
    }
  }
  return Array.from(seen.values());
}

// -- Main export --

export async function scanCircular(
  filePath: string,
  onProgress?: (event: ScanProgressEvent) => void
): Promise<ExtractionResult> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = fs.readFileSync(
    path.join(__dirname, "../prompts/circular-extraction.md"),
    "utf-8"
  );

  const ext = path.extname(filePath).toLowerCase();
  const isPdf = ext === ".pdf";

  if (!isPdf) {
    // Single image
    console.log(`Scanning circular image: ${filePath}`);
    const size = fs.statSync(filePath).size;
    console.log(`Image size: ${(size / 1024).toFixed(0)} KB`);
    onProgress?.({ type: "page", page: 1, pages: 1, storeName: null });
    const result = await scanImage(ai, filePath, prompt);
    onProgress?.({
      type: "page",
      page: 1,
      pages: 1,
      storeName: result.storeName,
    });
    return { ...result, items: filterNonMealItems(result.items) };
  }

  // PDF: convert to images, scan each page, merge results
  console.log(`Scanning PDF circular: ${filePath}`);
  onProgress?.({ type: "preparing" });
  const pageImages = convertPdfToImages(filePath);

  let allItems: SaleItem[] = [];
  let storeName: string | null = null;
  let validThrough: string | null = null;

  for (let i = 0; i < pageImages.length; i++) {
    const pageNum = i + 1;
    process.stdout.write(`  Page ${pageNum}/${pageImages.length}... `);

    const result = await scanImage(ai, pageImages[i], prompt);
    console.log(`${result.items.length} items`);

    allItems.push(...result.items);

    // Capture store info from whichever page has it
    if (result.storeName && !storeName) storeName = result.storeName;
    if (result.validThrough && !validThrough)
      validThrough = result.validThrough;

    onProgress?.({
      type: "page",
      page: pageNum,
      pages: pageImages.length,
      storeName,
    });
  }

  cleanupTmpImages(filePath);

  const filtered = filterNonMealItems(allItems);
  const deduplicated = deduplicateItems(filtered);
  console.log(
    `\nTotal: ${allItems.length} raw -> ${filtered.length} after filter -> ${deduplicated.length} after dedup`
  );
  if (storeName) console.log(`Store: ${storeName}`);
  if (validThrough) console.log(`Valid through: ${validThrough}`);

  return { items: deduplicated, storeName, validThrough };
}

// -- CLI entry point --

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error("Usage: npm run scan -- <path-to-circular>");
    console.error("Supports: .jpg, .jpeg, .png, .webp, .pdf");
    console.error("Example: npm run scan -- samples/flyer.pdf");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("Missing GEMINI_API_KEY in .env file");
    console.error("Get one at: https://aistudio.google.com/apikey");
    process.exit(1);
  }

  const result = await scanCircular(filePath);

  // Write output
  const outputPath = path.join(__dirname, "../output/extraction.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(`\nOutput written to: ${outputPath}`);

  // Print summary table
  console.log("\n--- Sale Items ---");
  for (const item of result.items) {
    const priceStr = `$${item.price.toFixed(2)}`;
    const note = item.priceNote ? ` (${item.priceNote})` : "";
    console.log(
      `  [${item.category.padEnd(10)}] ${item.item.padEnd(40)} ${priceStr.padStart(8)} ${item.unit}${note}`
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
