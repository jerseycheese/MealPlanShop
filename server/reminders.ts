import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// One-tap "Send to Apple Reminders": push the shopping list onto the phone by
// shelling out to macOS osascript. macOS-only by nature. Mirrors the
// server/poppler.ts shape — a small module that probes for an external
// dependency and surfaces a readable 422 (honored by the error middleware)
// instead of an opaque failure.

// Dedicated, app-owned list. Hardcoded for the MVP. A freshly-created list
// defaults to Standard type, which keeps our flat aisle order intact — a Grocery
// list's Auto-Categorize would re-sort items into its own sections and undo the
// ordering. The list type isn't scriptable, so creating our own is the only way
// to guarantee Standard.
export const REMINDERS_LIST_NAME = 'MealPlanShop';

// Shown both when the capability probe fails and when osascript itself is
// missing, so the macOS-only message has a single source.
export const REMINDERS_UNSUPPORTED_MESSAGE =
  'Sending to Apple Reminders only works on macOS.';

// The list name and item titles are passed as argv to `on run argv` — never
// interpolated into the script text. So a name with quotes, parens, or
// apostrophes is just data and can't break out of (or inject into) the
// AppleScript. Replace semantics: clear the list, then re-add, so it always
// mirrors the current plan rather than accumulating stale items week over week.
export const REMINDERS_SCRIPT = `on run argv
    set listName to item 1 of argv
    set itemTitles to rest of argv
    tell application "Reminders"
        if not (exists list listName) then
            make new list with properties {name:listName}
        end if
        set theList to list listName
        delete (every reminder of theList)
        repeat with t in itemTitles
            make new reminder at end of theList with properties {name:(t as string)}
        end repeat
    end tell
end run`;

let cached: boolean | undefined;

// Probe once whether this machine can drive Reminders at all: macOS + osascript
// on PATH. The probe runs a no-op script that never touches Reminders, so it
// can't trigger the one-time macOS Automation (TCC) prompt itself. Any failure
// means "not available" — this must never throw.
export function hasReminders(): boolean {
  if (cached === undefined) {
    if (process.platform !== 'darwin') {
      cached = false;
    } else {
      try {
        execFileSync('osascript', ['-e', 'return 1'], { stdio: 'ignore' });
        cached = true;
      } catch {
        cached = false;
      }
    }
  }
  return cached;
}

// Pure: map an osascript failure detail to a readable, actionable message. The
// first real send triggers the macOS Automation prompt; if it's denied,
// osascript exits non-zero with "Not authorized to send Apple events" (-1743).
// That grant is a one-time manual approval — there's no API to pre-authorize it.
export function remindersErrorMessage(detail: string): string {
  const text = (detail || '').trim();
  if (/not authorized|-1743/i.test(text)) {
    return (
      'MealPlanShop needs permission to control Reminders. Open System Settings ' +
      '-> Privacy & Security -> Automation, enable Reminders for your terminal ' +
      'or Node, then try again. (This is a one-time approval.)'
    );
  }
  if (/macos|enoent|not found/i.test(text)) {
    return REMINDERS_UNSUPPORTED_MESSAGE;
  }
  if (text === 'TIMEOUT') {
    return (
      'Sending to Reminders took too long and was stopped partway through. ' +
      'Reminders creates items one at a time, so long lists can take a while — try again.'
    );
  }
  const firstLine = text.split('\n')[0] || 'unknown error';
  return `Couldn't send to Apple Reminders: ${firstLine}`;
}

// Reminders.app creates items one AppleScript call at a time — no batch API —
// so wall-clock time scales with list length (observed ~0.8s/item on a 52-line
// push). A flat timeout works until the list grows past it, then every send
// fails with an unhelpful "unknown error" (the timeout kills the process, so
// there's no stderr to explain why). Scale with titles.length
// instead of guessing a single constant, capped so a runaway call still ends.
function reminderTimeoutMs(itemCount: number): number {
  return Math.min(300_000, 10_000 + itemCount * 1_500);
}

// Map an osascript failure to the detail remindersErrorMessage reads.
// ENOENT = osascript isn't on PATH (non-macOS). A fired timeout kills the
// process and leaves no stderr: the async API marks it `killed` with a signal,
// the sync API (still used by the hasReminders probe) sets code ETIMEDOUT.
// Otherwise the script ran and failed, and the reason is in stderr (commonly
// the TCC "not authorized").
export function osascriptFailureDetail(err: unknown): string {
  const e = err as {
    stderr?: Buffer | string;
    code?: string | number | null;
    killed?: boolean;
    signal?: string | null;
  };
  if (e.code === 'ETIMEDOUT' || (e.killed && e.signal)) return 'TIMEOUT';
  if (e.code === 'ENOENT') return REMINDERS_UNSUPPORTED_MESSAGE;
  return String(e.stderr ?? '');
}

// Push the titles into the named Reminders list (replace semantics). Throws a
// plain Error tagged statusCode 422 — honored by the server error middleware —
// with a readable message on any osascript failure. Async on purpose: a long
// list takes tens of seconds, and a sync call would freeze every other request.
export async function sendToReminders(
  listName: string,
  titles: string[]
): Promise<void> {
  try {
    await execFileAsync(
      'osascript',
      ['-e', REMINDERS_SCRIPT, listName, ...titles],
      { timeout: reminderTimeoutMs(titles.length) }
    );
  } catch (err) {
    const detail = osascriptFailureDetail(err);
    const wrapped = new Error(remindersErrorMessage(detail)) as Error & {
      statusCode?: number;
    };
    wrapped.statusCode = 422;
    throw wrapped;
  }
}
