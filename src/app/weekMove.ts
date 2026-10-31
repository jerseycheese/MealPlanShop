import type { MealType } from '../../types';

type Slot = { day: string; mealType: MealType };

// Runs one week-grid move and says what the user should hear afterwards.
// `reload` refetches the plan; it runs before the success status is returned so
// a plan refetch that clears the status can't wipe this one.
export async function submitMove(
  from: Slot,
  to: Slot,
  post: (body: {
    from: Slot;
    to: Slot;
  }) => Promise<{ ok: boolean; error?: string }>,
  reload: () => Promise<void>
): Promise<{ error: string | null; status: string | null }> {
  try {
    const { ok, error } = await post({ from, to });
    if (!ok) return { error: error || 'Move failed', status: null };
    await reload();
    return { error: null, status: `Moved the ${from.mealType} to ${to.day}.` };
  } catch {
    return { error: 'Failed to move meal', status: null };
  }
}

// The week grid's live-region text: in-flight move, then a picked-up meal, then
// the result of the last move.
export function weekStatusMessage(
  movingPair: unknown,
  pickedUp: Slot | null,
  moveStatus: string | null
): string | null {
  if (movingPair) return 'Moving meal...';
  if (pickedUp)
    return `Picked up the ${pickedUp.mealType} on ${pickedUp.day}. Choose where to move it, or press Escape to cancel.`;
  return moveStatus;
}
