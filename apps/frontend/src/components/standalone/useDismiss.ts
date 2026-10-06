'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Closes a header popover on a tap outside it or on Escape, while it is open.
 *
 * Pointer events rather than mouse ones, so a tap on a phone dismisses it the
 * same as a click does.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, setOpen: (v: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, setOpen]);
}
