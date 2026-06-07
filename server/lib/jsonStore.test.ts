import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  readJsonOrNull,
  writeJsonAtomic,
  writeJsonAtomicWithBackup,
} from "./jsonStore";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jsonstore-test-"));
const file = path.join(dir, "preferences.json");

try {
  // First write: no prior file, so no .bak is created — and the write still lands.
  writeJsonAtomicWithBackup(file, { v: 1 });
  assert.deepEqual(readJsonOrNull(file), { v: 1 });
  assert.equal(fs.existsSync(`${file}.bak`), false, "no backup on first write");

  // Second write: the prior contents are snapshotted to .bak before overwriting.
  writeJsonAtomicWithBackup(file, { v: 2 });
  assert.deepEqual(readJsonOrNull(file), { v: 2 });
  assert.deepEqual(readJsonOrNull(`${file}.bak`), { v: 1 }, "backup holds prior contents");

  // Third write: .bak rolls forward to the most recent prior contents.
  writeJsonAtomicWithBackup(file, { v: 3 });
  assert.deepEqual(readJsonOrNull(`${file}.bak`), { v: 2 }, "backup rolls forward");

  // Plain writeJsonAtomic still round-trips and never makes a backup.
  const plain = path.join(dir, "plain.json");
  writeJsonAtomic(plain, { ok: true });
  assert.deepEqual(readJsonOrNull(plain), { ok: true });
  assert.equal(fs.existsSync(`${plain}.bak`), false, "plain write makes no backup");

  console.log("jsonStore: 6/6 passed");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
