import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  hasReminders,
  osascriptFailureDetail,
  remindersErrorMessage,
  REMINDERS_LIST_NAME,
  REMINDERS_SCRIPT,
  sendToReminders,
} from './reminders';

// hasReminders probes the real platform/PATH, so don't assert a specific value —
// just that it returns a boolean and never throws. Never actually invoke
// osascript here: a real send would pop the macOS Automation prompt and be
// machine-dependent in CI.
assert.equal(typeof hasReminders(), 'boolean');

// The TCC "not authorized" failure maps to actionable permission guidance.
const denied = remindersErrorMessage(
  'execution error: Not authorized to send Apple events to Reminders. (-1743)'
);
assert.match(denied, /permission/i);
assert.match(denied, /System Settings/i);

// A missing-osascript / non-macOS failure maps to the macOS-only message.
assert.match(remindersErrorMessage('osascript: command not found'), /macOS/i);

// Anything else is surfaced verbatim (first line) behind a readable prefix.
const generic = remindersErrorMessage('some weird AppleScript failure');
assert.match(generic, /Couldn't send to Apple Reminders/i);
assert.match(generic, /weird AppleScript failure/);

// A timed-out push (no stderr) reads as "try again",
// not the old unhelpful "unknown error" fallback.
const timedOut = remindersErrorMessage('TIMEOUT');
assert.match(timedOut, /too long/i);
assert.doesNotMatch(timedOut, /unknown error/i);

// The sync API reports its own timeout as code ETIMEDOUT (not `killed`), and
// that must reach the timeout message rather than the empty-stderr fallback.
assert.equal(
  osascriptFailureDetail({ code: 'ETIMEDOUT', signal: 'SIGTERM', stderr: '' }),
  'TIMEOUT'
);

// The async API (what sendToReminders uses) reports a fired timeout as
// killed + signal with no code; that must also read as a timeout.
assert.equal(
  osascriptFailureDetail({
    killed: true,
    signal: 'SIGTERM',
    code: null,
    stderr: '',
  }),
  'TIMEOUT'
);

// The push targets the dedicated, app-owned Standard list.
assert.equal(REMINDERS_LIST_NAME, 'MealPlanShop');

// Guard the injection-safe shape (argv, not interpolation) and the replace
// semantics (clear before re-adding).
assert.match(REMINDERS_SCRIPT, /on run argv/);
assert.match(REMINDERS_SCRIPT, /delete \(every reminder/);

console.log('reminders: 12/12 sync passed');

// Put a fake `osascript` first on PATH so the send never reaches the real
// Reminders app. `body` is the shell script it runs.
async function withFakeOsascript(body: string, fn: () => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-osascript-'));
  fs.writeFileSync(path.join(dir, 'osascript'), `#!/bin/sh\n${body}\n`, {
    mode: 0o755,
  });
  const oldPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  try {
    await fn();
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function run() {
  // A slow send must not block the event loop: a timer set after the send
  // starts fires before the send resolves.
  await withFakeOsascript('sleep 0.5', async () => {
    const order: string[] = [];
    const send = sendToReminders('Test', ['milk']).then(() =>
      order.push('send')
    );
    await new Promise((r) => setTimeout(r, 50)).then(() => order.push('timer'));
    await send;
    assert.deepEqual(order, ['timer', 'send']);
  });

  // stderr from a failed script still reaches the readable 422 message.
  await withFakeOsascript(
    'echo "execution error: Not authorized to send Apple events to Reminders. (-1743)" >&2; exit 1',
    async () => {
      await assert.rejects(
        sendToReminders('Test', ['milk']),
        (err: Error & { statusCode?: number }) => {
          assert.equal(err.statusCode, 422);
          assert.match(err.message, /permission/i);
          return true;
        }
      );
    }
  );
}
