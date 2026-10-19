import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../lib/crmChanged';
import type { ExpenseAnalysisData, Money, RetentionData, RevenueSourcesData } from '../analyticsHubFigures';

/**
 * The figures of the four analysis screens, counted by the server (GET /api/admin/analytics-hub/*, api/lib/analyticsScreens.js).
 * They held the context's orders, expenses and clients and added them up here. `null` until the first answer; a failed
 * or later request keeps the last values. After a write (a payment, an expense) they are asked for again, once for a burst.
 */
function useFigures<T>(path: string): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      mysqlAdmin.adminGet<T>(path).then(answer => { if (!cancelled) setData(answer); }).catch(() => { /* the figures keep their last values */ });
    };
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 600); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [path]);
  return data;
}

/** `from`: the first day the period counts from (YYYY-MM-DD). */
export const useRevenueSources = (from: string) => useFigures<RevenueSourcesData>(`/admin/analytics-hub/revenue-sources?from=${from}`);
export const useExpenseAnalysis = (from: string) => useFigures<ExpenseAnalysisData>(`/admin/analytics-hub/expense-analysis?from=${from}`);
export const useRetention = () => useFigures<RetentionData>('/admin/analytics-hub/retention');
/** `month`: YYYY-MM. */
export const useMonthRevenue = (month: string) => useFigures<{ month: string; amounts: Money[] }>(`/admin/analytics-hub/month-revenue?month=${month}`);
