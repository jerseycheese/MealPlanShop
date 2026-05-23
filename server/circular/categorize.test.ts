import { strict as assert } from "node:assert";
import { categorizeInBatches } from "./categorize";

// Exported so the harness can await it — top-level await isn't available under
// the cjs output format, and these assertions are async.
export async function run(): Promise<void> {
  // Order is preserved when results are stitched back together across batches.
  {
    const names = ["a", "b", "c", "d", "e"];
    // Echo the name as its category so we can verify positions survive batching.
    const out = await categorizeInBatches(names, 2, async (batch) => batch.map((n) => n));
    assert.deepEqual(out, names, "batched results keep input order");
  }

  // A batch whose result length doesn't match falls back to "other" for that
  // batch only; other batches are unaffected.
  {
    const names = ["a", "b", "c", "d"];
    const out = await categorizeInBatches(names, 2, async (batch) =>
      // First batch returns too few entries; second batch is fine.
      batch[0] === "a" ? ["produce"] : batch.map(() => "meat"),
    );
    assert.deepEqual(out, ["other", "other", "meat", "meat"], "short batch -> other, rest intact");
  }

  // A batch that throws falls back to "other" for that batch only.
  {
    const names = ["a", "b", "c", "d"];
    const out = await categorizeInBatches(names, 2, async (batch) => {
      if (batch[0] === "c") throw new Error("boom");
      return batch.map(() => "dairy");
    });
    assert.deepEqual(out, ["dairy", "dairy", "other", "other"], "throwing batch -> other, rest intact");
  }

  // Non-string entries within an otherwise valid batch coerce to "other".
  {
    const out = await categorizeInBatches(["a", "b"], 2, async () => ["produce", 7]);
    assert.deepEqual(out, ["produce", "other"], "non-string category -> other");
  }

  // Empty input short-circuits to an empty array without calling the classifier.
  {
    const out = await categorizeInBatches([], 30, async () => {
      throw new Error("classifier should not be called for empty input");
    });
    assert.deepEqual(out, [], "empty input -> empty output");
  }

  console.log("categorize.test.ts: all assertions passed");
}
