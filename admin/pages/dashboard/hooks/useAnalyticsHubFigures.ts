import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../lib/crmChanged';
import type { Money } from '../analyticsHubFigures';

/**
 * The month's paid money, counted by the server (GET /api/admin/analytics-hub/month-revenue, api/lib/analyticsScreens.js). `null` until the first answer;
 * a failed or later request keeps the last values. After a write (a payment) it is asked for again, once for a burst.
 */
export function useMonthRevenue(month: string): { month: string; amounts: Money[] } | null {
  const [data, setData] = useState<{ month: string; amounts: Money[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      mysqlAdmin.adminGet<{ month: string; amounts: Money[] }>(`/admin/analytics-hub/month-revenue?month=${month}`)
        .then(answer => { if (!cancelled) setData(answer); }).catch(() => { /* the figures keep their last values */ });
    };
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 600); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [month]);
  return data;
}
