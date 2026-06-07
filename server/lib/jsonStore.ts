import * as fs from "node:fs";

// Shared file-backed JSON helpers. Both index.ts and circular/prefs.ts used to
// carry their own identical copies of these — same tmp-file+rename write, same
// ENOENT-tolerant read — which is exactly the kind of duplication that drifts.

// Read + parse JSON, returning null instead of throwing when the file is missing
// or unparseable. Missing is the common case (nothing generated yet); a parse
// failure is logged but still degrades to null so a corrupt blob can't crash a
// read path.
export function readJsonOrNull<T = unknown>(filePath: string): T | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    console.warn(`[readJsonOrNull] failed to read ${filePath}:`, err);
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[readJsonOrNull] failed to parse ${filePath}:`, err);
    return null;
  }
}

// Write JSON via a sibling .tmp file + rename so a crash mid-write can't leave a
// half-written plan/extraction/preferences blob on disk. Caller is responsible
// for ensuring the parent directory exists.
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// Like writeJsonAtomic, but first snapshots the existing file to a sibling .bak.
// Use for hand-curated, non-regenerable data (preferences, and secrets once the
// key UI lands) so a bad write or import always leaves a last-known-good copy to
// restore from. The backup is best-effort: a missing source is the first-ever
// write (nothing to back up), and any other copy failure is logged but must not
// block the actual write.
export function writeJsonAtomicWithBackup(filePath: string, data: unknown): void {
  try {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[writeJsonAtomicWithBackup] backup of ${filePath} failed:`, err);
    }
  }
  writeJsonAtomic(filePath, data);
}
