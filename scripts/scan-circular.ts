import 'dotenv/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SaleItem, ExtractionResult } from '../types';
import { generateStructured } from '../server/generateStructured';
import { hasPoppler, popplerRequiredError } from '../server/poppler';

export const CATEGORY_ENUM = [
  'produce',
  'meat',
  'seafood',
  'dairy',
  'bakery',
  'frozen',
  'pantry',
  'beverages',
  'snacks',
  'deli',
  'other',
] as const;

export type ScanProgressEvent =
  | { type: 'preparing' }
  | { type: 'page'; page: number; pages: number; storeName: string | null };

const extractionSchema = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          item: { type: 'string' as const },
          price: { type: 'number' as const },
          unit: { type: 'string' as const },
          category: {
            type: 'string' as const,
            enum: [...CATEGORY_ENUM],
          },
          priceNote: { type: 'string' as const },
        },
        required: ['item', 'price', 'unit', 'category'],
      },
    },
    storeName: { type: ['string', 'null'] as const },
    validThrough: { type: ['string', 'null'] as const },
  },
  required: ['items', 'storeName', 'validThrough'],
};

async function scanImage(
  imagePath: string,
  prompt: string
): Promise<ExtractionResult> {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[ext] || 'image/jpeg';

  const parsed = (await generateStructured({
    prompt,
    images: [{ mimeType, data: base64Image }],
    schema: extractionSchema,
    timeoutMs: 90_000,
  })) as Partial<ExtractionResult>;
  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
    storeName: typeof parsed.storeName === 'string' ? parsed.storeName : null,
    validThrough:
      typeof parsed.validThrough === 'string' ? parsed.validThrough : null,
  };
}

const execFileAsync = promisify(execFile);

// Async so the API keeps answering (progress poll included) while pdftoppm runs.
// The poppler guard lives here (not the route) so the CLI gets the same
// readable message instead of an opaque ENOENT.
async function runPdftoppm(pdfPath: string, prefix: string): Promise<void> {
  if (!hasPoppler()) throw popplerRequiredError();
  await execFileAsync('pdftoppm', ['-r', '150', '-jpeg', pdfPath, prefix]);
}

// Each conversion gets its own folder. pdftoppm never clears the target and
// its file names depend on page count, so a shared folder let a failed scan's
// pages leak into the next one.
async function convertPdfToImages(
  pdfPath: string,
  tmpDir: string,
  pdftoppm: typeof runPdftoppm
): Promise<string[]> {
  await pdftoppm(pdfPath, path.join(tmpDir, 'page'));

  const files = fs
    .readdirSync(tmpDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => path.join(tmpDir, f));

  console.log(`Converted PDF to ${files.length} page images`);
  return files;
}

// -- validThrough sanity check --

// If the string contains a 4-digit year and we can parse a date out of it,
// drop it when the date is more than ~2 weeks in the past. Gemini sometimes
// misreads the year (e.g. returns 2024 for a current flyer); better to show
// no date than a wrong one. Strings without a year are left alone — the UI
// degrades gracefully.
export function validateValidThrough(
  validThrough: string | null
): string | null {
  if (!validThrough) return null;
  if (!/\b20\d{2}\b/.test(validThrough)) return validThrough;

  let date: Date | null = null;
  const direct = new Date(validThrough);
  if (!isNaN(direct.getTime())) {
    date = direct;
  } else {
    const m = validThrough.match(
      /([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})/
    );
    if (m) {
      const p = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
      if (!isNaN(p.getTime())) date = p;
    }
  }

  if (!date) return validThrough;

  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  if (date < cutoff) {
    console.warn(
      `Warning: validThrough "${validThrough}" parsed as ${date
        .toISOString()
        .slice(0, 10)}, more than 2 weeks in the past - dropping`
    );
    return null;
  }
  return validThrough;
}

export function deduplicateItems(items: SaleItem[]): SaleItem[] {
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

export async function scanCircular(
  filePath: string,
  onProgress?: (event: ScanProgressEvent) => void,
  deps: { pdftoppm: typeof runPdftoppm; scanImage: typeof scanImage } = {
    pdftoppm: runPdftoppm,
    scanImage,
  }
): Promise<ExtractionResult> {
  const prompt = fs.readFileSync(
    path.join(__dirname, '../prompts/circular-extraction.md'),
    'utf-8'
  );

  const ext = path.extname(filePath).toLowerCase();
  const isPdf = ext === '.pdf';

  if (!isPdf) {
    console.log(`Scanning circular image: ${filePath}`);
    const size = fs.statSync(filePath).size;
    console.log(`Image size: ${(size / 1024).toFixed(0)} KB`);
    onProgress?.({ type: 'page', page: 1, pages: 1, storeName: null });
    const result = await deps.scanImage(filePath, prompt);
    result.validThrough = validateValidThrough(result.validThrough);
    onProgress?.({
      type: 'page',
      page: 1,
      pages: 1,
      storeName: result.storeName,
    });
    return result;
  }

  // PDF: convert to images, scan each page, merge results.
  console.log(`Scanning PDF circular: ${filePath}`);
  onProgress?.({ type: 'preparing' });

  const allItems: SaleItem[] = [];
  let storeName: string | null = null;
  let validThrough: string | null = null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealplanshop-pdf-'));
  try {
    const pageImages = await convertPdfToImages(
      filePath,
      tmpDir,
      deps.pdftoppm
    );

    for (let i = 0; i < pageImages.length; i++) {
      const pageNum = i + 1;
      process.stdout.write(`  Page ${pageNum}/${pageImages.length}... `);

      const result = await deps.scanImage(pageImages[i], prompt);
      console.log(`${result.items.length} items`);

      allItems.push(...result.items);

      // Capture store info from whichever page has it
      if (result.storeName && !storeName) storeName = result.storeName;
      if (result.validThrough && !validThrough)
        validThrough = result.validThrough;

      onProgress?.({
        type: 'page',
        page: pageNum,
        pages: pageImages.length,
        storeName,
      });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  validThrough = validateValidThrough(validThrough);

  const deduplicated = deduplicateItems(allItems);
  console.log(
    `\nTotal: ${allItems.length} raw -> ${deduplicated.length} after dedup`
  );
  if (storeName) console.log(`Store: ${storeName}`);
  if (validThrough) console.log(`Valid through: ${validThrough}`);

  return { items: deduplicated, storeName, validThrough };
}

// Write the extraction where the server and `npm run plan` read it. Shared by
// the scan and pipeline CLIs so neither can drift to a file nothing reads.
export function writeExtraction(
  result: ExtractionResult,
  outputPath = path.join(__dirname, '../output/extraction.json')
): string {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  return outputPath;
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npm run scan -- <path-to-circular>');
    console.error('Supports: .jpg, .jpeg, .png, .webp, .pdf');
    console.error('Example: npm run scan -- samples/flyer.pdf');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const result = await scanCircular(filePath);

  const outputPath = writeExtraction(result);
  console.log(`\nOutput written to: ${outputPath}`);

  console.log('\n--- Sale Items ---');
  for (const item of result.items) {
    const priceStr = `$${item.price.toFixed(2)}`;
    const note = item.priceNote ? ` (${item.priceNote})` : '';
    console.log(
      `  [${item.category.padEnd(10)}] ${item.item.padEnd(40)} ${priceStr.padStart(8)} ${item.unit}${note}`
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
