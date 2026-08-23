import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { SubscriberStats } from '../../../types';

/**
 * The subscriber count, from the database rather than from `subscribers.length`.
 *
 * Two campaign screens showed "المشتركون (1,353)" in an audience picker and that
 * single number was the whole reason they pulled the subscriber table — and,
 * because the loader fetched both halves together, the leads table with it.
 *
 * Returns `null` until the first response lands, which is the signal callers use
 * to fall back to counting whatever array they already hold. The fallback is
 * still correct on a partial array in the sense that it shows what is loaded; it
 * is simply less accurate, which is the right way round for a number that is
 * only ever a label.
 *
 * Scoped server-side by the same rule as the subscriber list, so a rep's count
 * matches the list they can actually see.
 */
export function useSubscriberStats(): SubscriberStats | null {
  const [stats, setStats] = useState<SubscriberStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await mysqlAdmin.getSubscriberStats();
        if (!cancelled) setStats(result);
      } catch {
        // Silent: the caller falls back to the array it already has, which is
        // what it used before this hook existed.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return stats;
}
