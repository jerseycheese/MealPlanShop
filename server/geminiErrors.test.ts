import * as assert from "node:assert/strict";
import { toReadableGeminiError } from "./geminiErrors";

// Fakes shaped like the real @google/genai ApiError: a numeric `status` and a
// `message` that is the JSON-stringified Google error body. No SDK import, no
// network.
const apiError = (status: number, body: object): Error & { status: number } => {
  const err = new Error(JSON.stringify({ error: body })) as Error & {
    status: number;
  };
  err.status = status;
  return err;
};

const MODEL = "gemini-3.5-flash";

// Bad key (400 whose body names the key) → readable, points at Settings,
// tagged 400 so the middleware returns a clean error.
const badKey = toReadableGeminiError(
  apiError(400, {
    code: 400,
    message: "API key not valid. Please pass a valid API key.",
    status: "INVALID_ARGUMENT",
  }),
  MODEL,
) as Error & { statusCode?: number };
assert.match(badKey.message, /key/i);
assert.match(badKey.message, /Settings/);
assert.equal(badKey.statusCode, 400);

// Bad key (401 UNAUTHENTICATED) → same readable bad-key message.
const unauth = toReadableGeminiError(
  apiError(401, { code: 401, message: "Unauthenticated", status: "UNAUTHENTICATED" }),
  MODEL,
) as Error & { statusCode?: number };
assert.match(unauth.message, /key/i);
assert.equal(unauth.statusCode, 400);

// Permission denied (403) → readable access message, tagged 400.
const denied = toReadableGeminiError(
  apiError(403, { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" }),
  MODEL,
) as Error & { statusCode?: number };
assert.match(denied.message, /Settings/);
assert.equal(denied.statusCode, 400);

// Model not found (404) → readable message NAMES the model and points at the
// env override, tagged 400.
const notFound = toReadableGeminiError(
  apiError(404, {
    code: 404,
    message: "models/bogus-model is not found for API version v1beta.",
    status: "NOT_FOUND",
  }),
  "bogus-model",
) as Error & { statusCode?: number };
assert.match(notFound.message, /bogus-model/);
assert.match(notFound.message, /GEMINI_MODEL/);
assert.equal(notFound.statusCode, 400);

// Match on the body alone when there's no numeric status (the SDK throws a plain
// Error outside the 4xx/5xx range, message still carries the JSON body).
const noStatus = toReadableGeminiError(
  new Error(
    '{"error":{"message":"models/weird-model is not found for API version v1beta.","status":"NOT_FOUND"}}',
  ),
  "weird-model",
) as Error & { statusCode?: number };
assert.match(noStatus.message, /weird-model/);
assert.equal(noStatus.statusCode, 400);

// Rate limit (429) → passed through UNTOUCHED, never mislabeled as a key error.
const original429 = apiError(429, {
  code: 429,
  message: "Quota exceeded",
  status: "RESOURCE_EXHAUSTED",
});
const passed429 = toReadableGeminiError(original429, MODEL);
assert.equal(passed429, original429);
assert.equal((passed429 as { statusCode?: number }).statusCode, undefined);

// Timeout / network (no status, no key-or-model substrings) → passed through.
const timeout = new Error("request timed out after 90000ms");
const passedTimeout = toReadableGeminiError(timeout, MODEL);
assert.equal(passedTimeout, timeout);
assert.equal((passedTimeout as { statusCode?: number }).statusCode, undefined);

console.log("geminiErrors: 16/16 passed");
