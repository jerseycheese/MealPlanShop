import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanCircular } from './scan-circular';

// Stand-in for pdftoppm: writes one empty .jpg per page next to the prefix,
// using pdftoppm's own naming (page-1.jpg for a short PDF, page-01.jpg for 10+).
function fakePdftoppm(pages: number, dirs: string[]) {
  return async (_pdfPath: string, prefix: string) => {
    dirs.push(path.dirname(prefix));
    const width = pages >= 10 ? 2 : 1;
    for (let i = 1; i <= pages; i++) {
      fs.writeFileSync(`${prefix}-${String(i).padStart(width, '0')}.jpg`, '');
    }
  };
}

const empty = { items: [], storeName: null, validThrough: null };

export async function run(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  const pdfPath = path.join(workDir, 'circular.pdf');
  fs.writeFileSync(pdfPath, '');

  try {
    // A 12-page scan that dies on page 2 must leave no page images behind.
    const dirs: string[] = [];
    let calls = 0;
    await assert.rejects(
      scanCircular(pdfPath, undefined, {
        pdftoppm: fakePdftoppm(12, dirs),
        scanImage: async () => {
          calls += 1;
          if (calls === 2) throw new Error('Gemini timeout');
          return empty;
        },
      }),
      /Gemini timeout/
    );
    assert.equal(fs.existsSync(dirs[0]), false, 'page folder left behind');

    // The next scan only sees its own page.
    const seen: string[] = [];
    await scanCircular(pdfPath, undefined, {
      pdftoppm: fakePdftoppm(1, dirs),
      scanImage: async (imagePath) => {
        seen.push(path.basename(imagePath));
        return empty;
      },
    });
    assert.deepEqual(seen, ['page-1.jpg']);
    assert.equal(fs.existsSync(dirs[1]), false, 'page folder left behind');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
