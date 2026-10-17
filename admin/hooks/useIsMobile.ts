import { useSyncExternalStore } from 'react';

/**
 * Is the screen a phone's? One answer from the browser's own media query, kept up to date as the window is
 * resized or turned, so a screen can choose a different layout (the pipeline of cards instead of a table)
 * rather than squeezing the wide one into 375 px.
 *
 * 767 px is Tailwind's `md` boundary minus one, so «mobile» here is exactly where the `md:` classes are off.
 */
const QUERY = '(max-width: 767px)';

const subscribe = (notify: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};

export const isMobileNow = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobileNow, () => false);
}
