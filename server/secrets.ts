import * as fs from "node:fs";
import * as path from "node:path";
import { resolveDataDir } from "./dataDir";
import { readJsonOrNull, writeJsonAtomic } from "./lib/jsonStore";

// The Gemini API key lives in the data dir next to preferences, but in its own
// secrets.json so it never rides the preferences export/import path (#91) into a
// downloaded backup. Plaintext, same local trust model as .env — the status
// endpoint only ever returns a masked value, never the raw key.
//
// Extracted as a sibling module (like dataDir / validatePreferences) so the call
// sites — server routes and CLI scripts both — resolve the key the same way
// without booting index.ts.
export interface Secrets {
  geminiApiKey?: string;
}

const NO_KEY_MESSAGE =
  "No Gemini API key set. Add one in Settings, or set GEMINI_API_KEY.";

export function secretsPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveDataDir(env), "secrets.json");
}

export function readSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const parsed = readJsonOrNull<Secrets>(secretsPath(env));
  return parsed && typeof parsed === "object" ? parsed : {};
}

// The single place key resolution happens: the stored key wins, then the
// GEMINI_API_KEY env var (the existing .env dev flow). Empty/whitespace counts
// as unset. Read fresh each call so a key pasted in the UI takes effect without
// a restart.
export function resolveGeminiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const stored = readSecrets(env).geminiApiKey?.trim();
  if (stored) return stored;
  const fromEnv = env.GEMINI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return null;
}

// Resolve or throw a readable error tagged for HTTP 400. Used at the Gemini call
// sites so a missing key surfaces as a clean "add a key in Settings" message
// through the server error middleware instead of an opaque failure deep inside
// the SDK — and never a process.exit.
export function requireGeminiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = resolveGeminiKey(env);
  if (!key) {
    const err = new Error(NO_KEY_MESSAGE) as Error & { statusCode?: number };
    err.statusCode = 400;
    throw err;
  }
  return key;
}

// Persist the key to the data dir. Plain atomic write, no .bak: a key is
// re-pasteable from aistudio.google.com/apikey, so it isn't the hand-curated,
// non-regenerable data that earns a backup — and a backup would leave the raw
// key on disk after a user clears it.
export function saveGeminiKey(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  fs.mkdirSync(resolveDataDir(env), { recursive: true });
  writeJsonAtomic(secretsPath(env), {
    ...readSecrets(env),
    geminiApiKey: key.trim(),
  });
}

export function clearGeminiKey(env: NodeJS.ProcessEnv = process.env): void {
  const next = readSecrets(env);
  delete next.geminiApiKey;
  fs.mkdirSync(resolveDataDir(env), { recursive: true });
  writeJsonAtomic(secretsPath(env), next);
}

// Masked form for display. The server must never hand back the raw key; this
// shows just enough to recognize which key is set.
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "****";
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}
