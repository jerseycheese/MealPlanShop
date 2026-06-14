import { execFileSync } from "node:child_process";

// PDF circular scanning shells out to pdftoppm (poppler). It's only reached for
// PDF uploads — image upload, Flipp fetch, and the no-circular path never touch
// it. This module lets the rest of the app degrade gracefully when poppler
// isn't installed: the UI hides PDF upload, and a PDF that slips through fails
// with a readable 422 instead of an opaque ENOENT from execFileSync.
//
// Mirrors the server/geminiErrors.ts shape — a small, pure-ish module imported
// by both the server and the shared scan-circular.ts CLI script.

let cached: boolean | undefined;

// Probe once per process whether pdftoppm is on PATH. Cached because the answer
// can't change within a run. Any failure (ENOENT, non-zero exit) means "no
// usable poppler" — this must never throw.
export function hasPoppler(): boolean {
  if (cached === undefined) {
    try {
      execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
      cached = true;
    } catch {
      cached = false;
    }
  }
  return cached;
}

// Pure: a readable error tagged 422, surfaced by the server error middleware
// (which honors statusCode) and printed by the CLI. Tagged-plain-Error rather
// than HttpError because scan-circular.ts is shared by the CLI and must not
// depend on server-only code.
export function popplerRequiredError(): Error {
  const err = new Error(
    "PDF scanning needs poppler (pdftoppm), which isn't installed here. " +
      "Upload a JPG or PNG image instead, or install poppler.",
  ) as Error & { statusCode?: number };
  err.statusCode = 422;
  return err;
}
