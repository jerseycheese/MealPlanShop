import * as assert from "node:assert/strict";
import { hasPoppler, popplerRequiredError } from "./poppler";

// popplerRequiredError is pure and deterministic.
const err = popplerRequiredError() as Error & { statusCode?: number };
assert.ok(err instanceof Error);
assert.equal(err.statusCode, 422);
assert.match(err.message, /poppler/i);
assert.match(err.message, /pdftoppm/i);

// hasPoppler is environment-dependent (probes the real PATH), so don't assert a
// specific result — just that it returns a boolean and never throws.
assert.equal(typeof hasPoppler(), "boolean");

console.log("poppler: 5/5 passed");
