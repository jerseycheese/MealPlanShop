import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type DialogKeyAction<T> =
  | { type: 'close' }
  | { type: 'focus'; target: T }
  | null;

// Escape closes; Tab and Shift+Tab wrap at the ends of the dialog, or pull
// focus back in when it has ended up outside.
export function dialogKeyAction<T>(
  key: string,
  shiftKey: boolean,
  focusables: readonly T[],
  active: T | null
): DialogKeyAction<T> {
  if (key === 'Escape') return { type: 'close' };
  if (key !== 'Tab' || focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const index = active === null ? -1 : focusables.indexOf(active);
  if (index === -1) return { type: 'focus', target: shiftKey ? last : first };
  if (shiftKey && index === 0) return { type: 'focus', target: last };
  if (!shiftKey && index === focusables.length - 1)
    return { type: 'focus', target: first };
  return null;
}

function focusablesIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0
  );
}

// Modal behavior for an aria-modal dialog: takes focus on open, keeps Tab
// inside, closes on Escape, and hands focus back to the opener on close.
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  open = true
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!dialog.contains(document.activeElement)) {
      (focusablesIn(dialog)[0] ?? dialog).focus();
    }

    const onKey = (e: KeyboardEvent) => {
      const action = dialogKeyAction(
        e.key,
        e.shiftKey,
        focusablesIn(dialog),
        document.activeElement as HTMLElement | null
      );
      if (!action) return;
      e.preventDefault();
      if (action.type === 'close') onCloseRef.current();
      else action.target.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, [ref, open]);
}
