import { useCallback, useEffect, useState } from 'react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../lib/crmChanged';
import { useVisibleInterval } from '../../../shared/useVisibleInterval';

export interface DueInstallment {
  clientId: string; name: string; phone: string; courseTitle: string; amount: number; currency: string; dueDate: string;
}

export interface OnlineManagerSummary {
  installments: { overdue: number; upcoming: number; overdueRows: DueInstallment[]; upcomingRows: DueInstallment[] };
  newClients: { count: number; rows: Array<{ id: string; name: string; email: string; phone: string; createdAt: string }> };
  newPayments: { count: number; rows: Array<{ name: string; amount: number; currency: string; paymentType: string; at: string }> };
}

/**
 * The online manager's two header badges and the panels behind them, from the server
 * (GET /api/staff/online-manager-summary): the instalments due and coming, and the last seven days' new
 * clients and payments. They were counted out of every client the manager's panel had downloaded.
 */
export function useOnlineManagerSummary(enabled: boolean) {
  const [summary, setSummary] = useState<OnlineManagerSummary | null>(null);
  const load = useCallback(() => {
    mysqlAdmin.adminGet<OnlineManagerSummary>('/staff/online-manager-summary')
      .then(setSummary)
      .catch(() => { /* the badges keep their last figures */ });
  }, []);

  useEffect(() => { if (enabled) load(); }, [enabled, load]);
  useVisibleInterval(load, 2 * 60 * 1000, enabled);
  // After a write anywhere (lib/crmChanged.ts), once for a burst of them.
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [enabled, load]);

  return summary;
}
