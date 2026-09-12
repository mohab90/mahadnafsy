import { useEffect, useRef } from 'react';

/**
 * Escape closes it.
 *
 * For a surface that is not a dialog and should not be dressed as one: a video
 * lightbox, an image gallery, a fullscreen player. shared/ui/Modal gives a
 * white panel with a header row, which is right for a form and wrong for a
 * photo on a black ground — but Escape is right for all of them, and the three
 * lightboxes in the client app had none. You could open one and only get out
 * again with the mouse.
 *
 * useModalKeyboard is the fuller version: it also moves focus into the panel,
 * which needs a panel to move it into. This is the half that applies without
 * one.
 */
export function useEscapeKey(onEscape: () => void, active = true): void {
  // Held in a ref so a caller passing a fresh arrow function each render does
  // not re-bind the listener every time.
  const latest = useRef(onEscape);
  latest.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.stopPropagation();
      latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}
