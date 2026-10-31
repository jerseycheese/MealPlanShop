import * as assert from 'node:assert/strict';
import { submitMove, weekStatusMessage } from './weekMove';

const from = { day: 'Tuesday', mealType: 'dinner' as const };
const to = { day: 'Wednesday', mealType: 'dinner' as const };

export async function run() {
  let reloaded = false;
  const moved = await submitMove(
    from,
    to,
    async () => ({ ok: true }),
    async () => {
      reloaded = true;
    }
  );
  assert.ok(reloaded, 'a successful move reloads the plan');
  assert.deepEqual(moved, {
    error: null,
    status: 'Moved the dinner to Wednesday.',
  });
  assert.equal(
    weekStatusMessage(null, null, moved.status),
    'Moved the dinner to Wednesday.',
    'the live region announces a finished move'
  );

  const refused = await submitMove(
    from,
    to,
    async () => ({ ok: false, error: 'Nope' }),
    async () => {}
  );
  assert.deepEqual(refused, { error: 'Nope', status: null });

  assert.equal(weekStatusMessage({}, null, moved.status), 'Moving meal...');
}
