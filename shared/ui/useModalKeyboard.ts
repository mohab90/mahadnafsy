import { useEffect, useRef } from 'react';

/**
 * Escape closes the dialog, and focus starts inside it.
 *
 * Sixty components in the admin render a `fixed inset-0` overlay and four of
 * them handled Escape — three being the shared dialogs. Everywhere else a
 * keyboard user opening a modal was left with focus still on <body> behind it:
 * to reach the first field they had to tab through the whole page underneath,
 * and to leave they had to find the mouse. Confirmed with a real key press on
 * إضافة ليد before this existed.
 *
 * Focus is moved to the first enabled control rather than the panel itself so
 * that the next Tab continues from inside the dialog. `preventScroll` keeps the
 * page behind from jumping when a long form takes focus.
 *
 * Deliberately not a focus trap. Trapping needs every modal to declare its own
 * boundary and mishandles the browser's own UI; the two problems staff actually
 * hit are getting in and getting out, and those are what this fixes.
 */
// The panel is a div. This was generic over the element because HireModal made
// its <form> the panel; that dialog uses shared/ui/Modal now, which always
// wraps its children in a div, and no caller was left needing the parameter.
export function useModalKeyboard(onClose: () => void, active = true) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Kept in a ref so a caller passing a fresh arrow function on every render
  // does not re-bind the listener each time.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.stopPropagation();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);

    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      // A form field first, and only then any focusable. querySelector returns
      // document order rather than selector order, so a single combined
      // selector lands on the header's close button — inside the dialog, but
      // not where someone came to type.
      const field = panel.querySelector<HTMLElement>(
        'input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
      );
      const fallback = panel.querySelector<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      (field || fallback)?.focus({ preventScroll: true });
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKey);
      window.clearTimeout(timer);
    };
  }, [active]);

  return panelRef;
}
