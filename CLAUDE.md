# CLAUDE.md — MealPlanShop

Personal meal planner: scan a grocery circular (uploaded PDF/image, or auto-fetched from Flipp by ZIP), extract the sale items with Gemini vision, then generate a 7-day meal plan around what's on sale. TypeScript end to end — Express API, React/Vite UI, and CLI scripts that run the same pipeline headless. Personal-use app: code doesn't need to be production-safe, but the data rules below are firm.

## Run it

```bash
npm install        # first time only
npm run dev        # starts BOTH processes via concurrently:
                   #   API: tsx watch server/index.ts  -> http://localhost:3101
                   #   UI:  vite                       -> http://localhost:5173 (proxies /api -> 3101)
```

Verify before working: `lsof -iTCP:3101 -sTCP:LISTEN` shows the API process and `curl -s localhost:3101/api/preferences` returns JSON. Then open http://localhost:5173.

- Check for an already-running server first (`lsof -iTCP:3101 -iTCP:5173`). Don't start a second instance.
- Known trap: if the API fails to boot (port conflict, bad env), Vite still starts and every `/api` request hangs. Fix the API process; don't debug the UI.
- `.claude/launch.json` is the canonical launch (`API_PORT=3101 npm run dev`). If `API_PORT` changes, the Vite proxy follows it, but launch.json and this file are the two places to keep in sync.

CLI pipeline (no UI needed):

```bash
npm run scan       # samples/ circular -> Gemini vision -> output/extraction.json
npm run plan       # extraction + preferences -> output/meal-plan.json
npm run pipeline   # both, end to end
```

## Test and lint

```bash
npm test           # tsx scripts/run-tests.ts — custom runner, NOT jest/vitest
```

- The runner imports a hardcoded list of suites in `scripts/run-tests.ts`. A new test file does nothing until it's added to that list.
- Sync suites assert at import time; async suites export `run()`. The runner collects all failures and exits 1 if any failed.
- Passing looks like: every suite reported, exit 0. Run it before every commit — CI (`.github/workflows/ci.yml`) runs the same thing.

## Env and data

- `GEMINI_API_KEY` — required for scan/plan/swap. Two sources, in priority order:
  1. Stored key in `~/.config/mealplanshop/secrets.json` (set via the in-app Settings modal) — wins.
  2. `.env` in the repo root (see `.env.example`).
  A 400 saying "No Gemini API key set. Add one in Settings, or set GEMINI_API_KEY." means neither is present. Resolution logic lives in `server/secrets.ts`.
- App data lives OUTSIDE the repo in `~/.config/mealplanshop/` (`preferences.json`, `secrets.json`); override the location with `MEALPLANSHOP_DATA_DIR`. Shared across all worktrees on purpose.
- `output/extraction.json` and `output/meal-plan.json` are per-checkout and gitignored. `npm run plan` reuses the last extraction — if items look stale, `npm run scan` first.

## Layout

```
prompts/        Gemini prompts: circular-extraction, meal-plan-generation, meal-swap
scripts/        CLI entry points (scan/plan/pipeline), run-tests.ts, prompt builders
server/         Express app (index.ts), circular/ (Flipp client + categorize),
                lib/jsonStore.ts (atomic JSON I/O), secrets.ts, validatePreferences.ts,
                mergeShoppingList.ts, moveMeal.ts, dataDir.ts
src/app/        React UI: App.tsx, Preferences, StorePicker, UploadCircular,
                ShoppingList, WeekView/MealCard, ApiKeyEntry, styles.css
samples/        Drop PDFs/images here for scan testing (gitignored)
output/         Generated JSON (gitignored)
```

## Hard rules

- CRITICAL: never commit anything from `~/.config/mealplanshop/` or a real key in `.env`. The API key is deliberately excluded from preference export/import backups — keep it that way.
- The Flipp fetch uses an unofficial endpoint. Personal use only; don't add features that hammer it, and expect it to break without notice.
- Date handling: use the shared `parseLocalDate` utility for circular dates. `new Date("YYYY-MM-DD")` parses as UTC and lands a day early west of UTC — that bug has been fixed once already.
- PDF scanning shells out to `pdftoppm` (poppler). Tests mock it; real scans need `brew install poppler`.
- Back up preferences before overwriting them (the server already does this — don't bypass it).

## Worktrees and ports

Worktrees live in `.claude/worktrees/`. There is NO per-worktree port scheme here — every checkout wants 3101/5173. Run dev in one checkout at a time, or override per worktree: `API_PORT=3102 PORT=5174 npm run dev`. Also note boot-hill-gm uses Vite's default 5173.

## Common tasks

1. Tune extraction or planning quality: edit the prompt in `prompts/`, then `npm run scan` / `npm run plan` against `samples/`, and diff the JSON in `output/`.
2. Add an API endpoint: route in `server/index.ts`, client call via `src/app/endpoints.ts` + `fetchJson.ts`.
3. Add a preference field: `server/validatePreferences.ts` + `src/app/Preferences.tsx`; check `server/prefs-fingerprint.ts` so change detection still works. Verify: save in the UI, confirm `~/.config/mealplanshop/preferences.json` updated.
4. Add a test: write the file, register it in `scripts/run-tests.ts`, confirm the `npm test` suite count went up.

## Known failure modes

- `/api/*` hangs in dev → the API process died or never bound; `lsof -iTCP:3101`, restart `npm run dev`.
- "No Gemini API key set..." 400 → see Env above; the stored key beats the env var, so a cleared UI key with no `.env` fallback means no key at all.
- Circular dates off by one day → something bypassed `parseLocalDate`.
- Scan produces nothing from a PDF → poppler missing (`pdftoppm` not on PATH).
- Meals don't reflect new preferences → plans don't auto-rebuild; regenerate with `npm run plan`.

## Pointers

- README.md — setup, usage, output formats, limitations.
- prompts/ — the three Gemini prompts (most of the product behavior lives here).
- .claude/launch.json — canonical dev launch config.
