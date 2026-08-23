import { useEffect, useRef, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { CrmInsights } from '../../../../types';

/**
 * Fetches GET /admin/leads/crm-insights for the CRM workspace panels.
 *
 * Returns `null` until the first response lands, which is the signal the three
 * consuming hooks use to fall back to filtering the leads array. That fallback
 * is what keeps the panels correct on a slow or failed request — it is not a
 * second implementation of the numbers, it is the original one.
 *
 * `idleDays` is a control the user moves, so the request is re-issued when it
 * changes. The in-flight guard stops a fast slider from stacking requests and
 * letting an older response overwrite a newer one.
 */
export function useCrmInsights(idleDays: number, enabled = true) {
  const [insights, setInsights] = useState<CrmInsights | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const seq = ++requestSeq.current;
    let cancelled = false;

    void (async () => {
      try {
        const result = await mysqlAdmin.getCrmInsights(idleDays);
        // Ignore anything that is no longer the newest request: the slider can
        // outrun the network, and a stale reply would show the wrong threshold.
        if (cancelled || seq !== requestSeq.current) return;
        setInsights(result);
      } catch {
        // Deliberately silent, and deliberately not clearing what is already
        // shown: the panels fall back to the leads array on null, so a failed
        // refresh should leave the last good aggregate in place rather than
        // blanking the screen.
        if (cancelled || seq !== requestSeq.current) return;
        setInsights(current => current);
      }
    })();

    return () => { cancelled = true; };
  }, [idleDays, enabled]);

  return insights;
}
