import { useEffect, useRef } from 'react';

/**
 * Poll while somebody is looking at the page.
 *
 * A `setInterval` that calls the API keeps calling it when the tab is in the
 * background, minimised, or on a phone in a pocket. Nothing on screen changes,
 * because there is no screen; the request is answered and thrown away. Counted
 * over one day on production, the pollers doing this were the four busiest
 * endpoints on the server after the health check.
 *
 * This runs the callback once on mount, then on the interval, and skips any
 * tick where the document is hidden. When the tab comes back to the front it
 * fires immediately, so nothing on screen is staler than it would have been —
 * the poll that was skipped is the one nobody was there to see.
 *
 * The callback is held in a ref, so an inline arrow function does not restart
 * the interval on every render. Change `intervalMs` or `enabled` to restart it.
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const fire = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      latest.current();
    };
    fire();
    const id = setInterval(fire, intervalMs);
    document.addEventListener('visibilitychange', fire);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', fire);
    };
  }, [intervalMs, enabled]);
}
