import * as assert from "node:assert/strict";
import {
  hasReminders,
  remindersErrorMessage,
  REMINDERS_LIST_NAME,
  REMINDERS_SCRIPT,
} from "./reminders";

// hasReminders probes the real platform/PATH, so don't assert a specific value —
// just that it returns a boolean and never throws. Never actually invoke
// osascript here: a real send would pop the macOS Automation prompt and be
// machine-dependent in CI.
assert.equal(typeof hasReminders(), "boolean");

// The TCC "not authorized" failure maps to actionable permission guidance.
const denied = remindersErrorMessage(
  "execution error: Not authorized to send Apple events to Reminders. (-1743)",
);
assert.match(denied, /permission/i);
assert.match(denied, /System Settings/i);

// A missing-osascript / non-macOS failure maps to the macOS-only message.
assert.match(remindersErrorMessage("osascript: command not found"), /macOS/i);

// Anything else is surfaced verbatim (first line) behind a readable prefix.
const generic = remindersErrorMessage("some weird AppleScript failure");
assert.match(generic, /Couldn't send to Apple Reminders/i);
assert.match(generic, /weird AppleScript failure/);

// The push targets the dedicated, app-owned Standard list.
assert.equal(REMINDERS_LIST_NAME, "MealPlanShop");

// Guard the injection-safe shape (argv, not interpolation) and the replace
// semantics (clear before re-adding).
assert.match(REMINDERS_SCRIPT, /on run argv/);
assert.match(REMINDERS_SCRIPT, /delete \(every reminder/);

console.log("reminders: 9/9 passed");
