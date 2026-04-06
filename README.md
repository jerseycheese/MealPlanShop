# MealPlanShop

An AI-powered meal planner that scans grocery store weekly sale circulars and generates a weekly meal plan around what's on sale. Point it at a store's weekly ad (PDF or photo), and it extracts every sale item, then builds a 7-day meal plan that prioritizes those deals.

## How it works

The pipeline has two stages, each powered by Google's Gemini vision model:

1. **Circular scanning** -- Takes a store's weekly ad (PDF or image), extracts every sale item with price, unit, and category. Multi-page PDFs get split into individual page images and scanned separately, then results are merged and deduplicated.

2. **Meal plan generation** -- Takes the extracted sale items plus household preferences (size, dietary restrictions, cuisine preferences) and generates a 7-day breakfast/lunch/dinner plan that prioritizes on-sale ingredients. Also produces a consolidated shopping list grouped by store section.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` (or create `.env`) and add a Gemini API key:

```
GEMINI_API_KEY=your_key_here
```

Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

PDF scanning requires `pdftoppm` (part of poppler):

```bash
# macOS
brew install poppler

# Ubuntu/Debian
sudo apt-get install poppler-utils
```

## Usage

### Scan a circular

```bash
# PDF (multi-page support)
npm run scan -- samples/flyer.pdf

# Single image
npm run scan -- samples/flyer-page-01.jpg
```

Output goes to `output/extraction.json` -- a structured list of sale items with prices, units, categories, and optional `priceNote` annotations for BOGO/multi-buy/coupon deals.

### Generate a meal plan

```bash
npm run plan
```

Reads from `output/extraction.json` and writes the meal plan to `output/meal-plan.json`.

### Full pipeline

```bash
npm run pipeline -- samples/flyer.pdf
```

Runs both stages end-to-end: scan the circular, then generate the meal plan.

## Project structure

```
prompts/
  circular-extraction.md    # Prompt for Gemini circular scanning
  meal-plan-generation.md   # Prompt for Gemini meal plan generation
scripts/
  scan-circular.ts          # Circular scanner (PDF/image -> sale items)
  generate-meal-plan.ts     # Meal planner (sale items -> weekly plan)
  full-pipeline.ts          # End-to-end pipeline
samples/                    # Sample circulars for testing
output/                     # Generated output (gitignored)
```

## Tech stack

- **Runtime:** Node.js + TypeScript, run via `tsx`
- **AI:** Google Gemini (`gemini-3-flash-preview`) via `@google/genai` SDK
- **PDF processing:** `pdftoppm` (poppler) for PDF-to-image conversion
- **Config:** `dotenv` for environment variables

## Current status

Phase 1 (AI core validation) is complete. The pipeline has been tested against a real Food Lion 16-page weekly circular and successfully extracts sale items and generates meal plans. The extraction prompt handles non-food filtering, price interpretation (BOGO, multi-buy, digital coupons), and near-duplicate detection.
