// Turn an error thrown by the @google/genai SDK into a short, readable message
// the UI can show, instead of the opaque JSON blob the SDK stuffs into
// err.message. Used at the scan/plan/swap call sites so a bad key or a model the
// key can't reach surfaces as something a stranger can act on, not a deep
// failure inside generateContent.
//
// The SDK throws an ApiError with a numeric `status` (the HTTP code) and a
// `message` that is JSON.stringify({ error: { code, message, status } }) — so
// the HTTP code and Google's enum ("API_KEY_INVALID", "PERMISSION_DENIED",
// "NOT_FOUND") are both reliably present. We duck-type on `status` + `message`
// rather than importing the SDK's class: the bundle ships more than one error
// type and instanceof across bundlers is brittle.
//
// Only auth / permission / not-found are remapped. Timeouts, rate limits (429),
// and 5xx fall through untouched so a transient failure is never mislabeled as a
// bad key — they keep their original message and the default 500.

type TaggedError = Error & { statusCode?: number };

// Tag a mapped error for HTTP 400 the same way requireGeminiKey does, so the
// server error middleware forwards the readable message straight to the UI.
function readable(message: string): TaggedError {
  const err = new Error(message) as TaggedError;
  err.statusCode = 400;
  return err;
}

export function toReadableGeminiError(err: unknown, modelId: string): Error {
  const status =
    typeof (err as { status?: unknown })?.status === "number"
      ? (err as { status: number }).status
      : undefined;
  const message =
    typeof (err as { message?: unknown })?.message === "string"
      ? (err as { message: string }).message
      : "";

  // Bad key: a 401, or a 400 whose body names the key. The 400 needs the body
  // guard — a plain malformed-request 400 isn't a key problem.
  const looksLikeBadKey =
    status === 401 ||
    /API[_ ]?KEY[_ ]?INVALID|UNAUTHENTICATED/i.test(message) ||
    (status === 400 && /api key not valid|invalid api key/i.test(message));
  if (looksLikeBadKey) {
    return readable(
      "Gemini rejected the API key. Check it in Settings, or update GEMINI_API_KEY.",
    );
  }

  // Permission denied: the key is valid but lacks access — wrong model tier, or
  // the API isn't enabled for it.
  if (status === 403 || /PERMISSION_DENIED/i.test(message)) {
    return readable(
      "Gemini denied access for this API key. It might not reach this model, or the API isn't enabled for the key. Check it in Settings.",
    );
  }

  // Model not found / unsupported: name the model and point at the override,
  // since that's the actionable fix.
  if (
    status === 404 ||
    /NOT_FOUND|is not found for API version|is not supported for generateContent/i.test(
      message,
    )
  ) {
    return readable(
      `Gemini model "${modelId}" wasn't found. Set GEMINI_MODEL to a supported model (e.g. gemini-3.5-flash) and try again.`,
    );
  }

  // Anything else (timeout, 429, 5xx, network) passes through untouched so it
  // keeps its original message and status handling.
  return err instanceof Error ? err : new Error(String(err));
}
