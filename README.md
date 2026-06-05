# MealPlanShop

An AI-powered meal planner that scans grocery store weekly sale circulars and generates a weekly meal plan around what's on sale. Point it at a store's weekly ad (PDF or photo), and it extracts every sale item, then builds a 7-day meal plan that prioritizes those deals — complete with cooking instructions and calorie estimates.

## How it works

The pipeline has two stages, each powered by Google's Gemini vision model:

1. **Circular scanning** — Takes a store's weekly ad (PDF or image), extracts every sale item with price, unit, and category. Multi-page PDFs get split into individual page images and scanned separately, then results are merged and deduplicated.

2. **Meal plan generation** — Takes the extracted sale items plus household preferences (size, dietary restrictions, cuisine preferences) and generates a 7-day breakfast/lunch/dinner plan that prioritizes on-sale ingredients. Each meal includes step-by-step cooking instructions and a per-serving calorie estimate. Also produces a consolidated shopping list grouped by store section.

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

### Web UI

```bash
npm run dev
```

Opens a local dev server — API on `http://localhost:3101`, UI on `http://localhost:5173`. From there you can pick your store to auto-fetch this week's ad, upload a circular manually, view the current meal plan, and hit Regenerate to rebuild from the last scan.

If port 3101 conflicts with another local service, override with `API_PORT`:

```bash
API_PORT=3201 npm run dev
```

### Where to get your store's circular

**Auto-fetch (preferred):** hit **Change store** in the UI, enter your ZIP, and pick your store. The app pulls the current weekly ad straight from Flipp's JSON API and builds the plan in one step — no manual download. Your ZIP is remembered across sessions in `output/circular-prefs.json`. (This is a personal-use posture — see the Flipp note below.)

**Manual upload (fallback):** for stores Flipp doesn't surface, or when you want a cleaner source, download the ad yourself and use **Upload circular**. For Food Lion:

- **Print view** (cleanest extraction): https://foodlion.com/savings/weekly-ad/print-view. Select your store first, then save the page as PDF.
- **Flipp viewer**: https://ad.foodlion.com/flyers/foodlion-weekly. Select your store; harder to extract since it's image tiles, but works as a fallback.

> Auto-fetch reads weekly ads from Flipp's unofficial JSON API. Their ToS prohibits scraping, so keep this personal-use only — don't productize without reworking the source.

The `.env.example` `STORE_NAME` / `STORE_ADDRESS` / `STORE_ZIP` / `STORE_CODE` keys are not read by the app — auto-fetch uses the ZIP you enter in the picker. They're kept only as a handy place to jot your store details.

### Full pipeline (scan + plan in one step)

```bash
npm run pipeline -- samples/flyer-1.pdf
```

Scans the circular, then generates the meal plan. Output goes to `output/extraction.json` and `output/meal-plan.json`.

### Step 1: Scan a circular

```bash
# PDF (multi-page support)
npm run scan -- samples/flyer-1.pdf

# Single image
npm run scan -- samples/flyer-page-01.jpg
```

Output: `output/extraction.json` — a structured list of sale items with prices, units, categories, and optional `priceNote` annotations for BOGO/multi-buy/coupon deals.

### Step 2: Generate a meal plan

```bash
npm run plan
```

Reads from `output/extraction.json` and writes to `output/meal-plan.json`.

For household preferences (size, dietary restrictions, cuisine preferences, which meals to plan), use the **Preferences** button in the web UI header. They apply to the next Regenerate or Upload. Defaults: household 2, low carb + low sodium, Italian/Mexican/Asian/American.

Saved values live in `~/.config/mealplanshop/preferences.json` — outside the gitignored, per-checkout `output/`, so every git worktree and the main tree share one set instead of each forking its own copy. Override the location with `MEALPLANSHOP_DATA_DIR` (e.g. point it at a synced folder). The Preferences modal also has **Export** / **Import** buttons to download your prefs as JSON and restore them later — a portable backup that seeds a fresh machine.

## Output format

### extraction.json

```json
{
  "items": [
    {
      "item": "Boneless Ribeye Steak",
      "price": 9.99,
      "unit": "per lb",
      "category": "meat"
    }
  ]
}
```

### meal-plan.json

```json
{
  "weekPlan": [
    {
      "day": "Monday",
      "breakfast": {
        "name": "Strawberry and Cream Cheese Sourdough Toast",
        "estimatedCalories": 320,
        "activeTime": 5,
        "totalTime": 10,
        "ingredients": [
          { "name": "Izzio Sliced Sourdough Bread", "quantity": "2 slices", "onSale": true },
          { "name": "Philadelphia Cream Cheese", "quantity": "2 tbsp", "onSale": true },
          { "name": "Strawberries", "quantity": "1/2 cup sliced", "onSale": true }
        ],
        "instructions": [
          "Toast two slices of sourdough bread until golden brown.",
          "Spread a thick layer of cream cheese on each slice.",
          "Top with freshly sliced strawberries.",
          "Drizzle with a small amount of honey or syrup if desired."
        ]
      },
      "lunch": { "..." },
      "dinner": { "..." }
    }
  ],
  "shoppingList": [
    {
      "name": "Boneless Ribeye Steak",
      "quantity": "1.5 lbs",
      "category": "meat",
      "onSale": true,
      "salePrice": 9.99
    }
  ]
}
```

## Project structure

```
prompts/
  circular-extraction.md    # Prompt for Gemini circular scanning
  meal-plan-generation.md   # Prompt for Gemini meal plan generation
  meal-swap.md              # Prompt for single-meal swaps
scripts/
  scan-circular.ts          # Circular scanner (PDF/image -> sale items)
  generate-meal-plan.ts     # Meal planner (sale items -> weekly plan + recipes)
  full-pipeline.ts          # End-to-end pipeline
  run-tests.ts              # Test runner
server/
  index.ts                  # Express server for the UI + API endpoints
  circular/sources/flipp.ts # Flipp circular fetching
src/app/                    # React web UI (Vite)
samples/                    # Drop your own circulars here (PDFs/images gitignored)
output/                     # Generated output (gitignored)
```

## Tech stack

- **Runtime:** Node.js + TypeScript, run via `tsx`
- **AI:** Google Gemini (`gemini-3-flash-preview`) via `@google/genai` SDK
- **PDF processing:** `pdftoppm` (poppler) for PDF-to-image conversion
- **Web server:** Express (serves the UI + API endpoints)
- **Config:** `dotenv` for environment variables

## Limitations

- **Single-user, local tool.** State is stored as shared files with no user
  accounts: the meal plan and shopping-list state live in the gitignored,
  per-checkout `output/` (`meal-plan.json`, `shopping-list-state.json`), while
  preferences live in `~/.config/mealplanshop/preferences.json` (override with
  `MEALPLANSHOP_DATA_DIR`) so they're shared across worktrees rather than forked
  per checkout. There's one meal plan and one set of preferences for the whole
  server, and mutating requests are processed one at a time. Running this for
  more than one concurrent user means they overwrite each other — it's built to
  run on your own machine.
- **Store auto-fetch uses an unofficial API.** The "find stores by ZIP" feature
  talks to an undocumented Flipp endpoint that can change or break without
  notice. It's a best-effort convenience; uploading a PDF/image is the reliable
  path.

## Current status

Phases 1–3 are complete, plus circular auto-fetch. The pipeline has been tested against real Food Lion and ALDI weekly ads — both manually uploaded and auto-fetched by ZIP via Flipp's JSON API (store picker in the UI). It extracts sale items, categorizes them, and generates a meal plan with per-meal cooking instructions and calorie estimates — all via Gemini, no recipe API needed. A standalone web UI lets you fetch, view, and regenerate the plan without touching the CLI.

**Next:** Polish the UI based on real usage, then decide the JackOS Dashboard integration path ([#16](https://github.com/jerseycheese/MealPlanShop/issues/16)).
