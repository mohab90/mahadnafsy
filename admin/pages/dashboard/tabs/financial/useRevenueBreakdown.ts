import { useEffect, useState } from 'react';
import { mysqlAdmin, type RevenueBreakdown } from '../../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../../lib/crmChanged';

/**
 * The accounts overview's revenue by type, course, month and box (6 Nov 2026), from the database: the paid payments' own EGP (api/routes/finance-payments-register.js).
 * It was added up here from the newest 500 orders and every loaded payment history, and the box split downloaded up to 50,000 payments. Asked again for another month or
 * branch, and after a payment is written.
 */
export function useRevenueBreakdown(month: string, branch: string | undefined, enabled: boolean): RevenueBreakdown | null {
  const [breakdown, setBreakdown] = useState<RevenueBreakdown | null>(null);
  useEffect(() => { setBreakdown(null); }, [branch]);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      mysqlAdmin.getRevenueBreakdown(month, branch)
        .then(answer => { if (!cancelled) setBreakdown(answer); })
        .catch(() => { /* the figures keep their last values */ });
    };
    load();
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 600); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { cancelled = true; clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [month, branch, enabled]);
  return breakdown;
}
