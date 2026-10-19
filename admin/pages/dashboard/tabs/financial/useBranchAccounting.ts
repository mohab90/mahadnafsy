import { useCallback, useEffect, useState } from 'react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../../../lib/crmChanged';
import type { SubscriberItem } from '../../../../types';

/**
 * What «حسابات الدقي» needs of the branch's clients, from the server (api/routes/admin/dokkiclients.js and
 * GET /api/admin/payments/review): how many payments wait for review — the badge on «مراجعة المدفوعات» — and the
 * clients who hold an instalment plan, for «الأقساط». The screen held the branch's whole client list, with payments,
 * to find a handful of them. Asked again after any write (lib/crmChanged.ts). `branch` undefined asks nothing.
 */
export function useBranchAccounting(branch: string | undefined) {
  const [pendingReview, setPendingReview] = useState(0);
  const [clientsWithPlans, setClientsWithPlans] = useState<SubscriberItem[]>([]);
  const load = useCallback(() => {
    if (!branch) return;
    const wanted = encodeURIComponent(branch);
    mysqlAdmin.adminGet<{ total?: number }>(`/admin/payments/review?status=pending&limit=1&branch=${wanted}`)
      .then(answer => setPendingReview(Number(answer.total) || 0))
      .catch(() => { /* the badge keeps its last value */ });
    mysqlAdmin.adminGet<SubscriberItem[]>(`/admin/dokki/installment-clients?branch=${wanted}`)
      .then(rows => setClientsWithPlans(rows.map(row => ({ ...row, enrolledCourseIds: Array.isArray(row.enrolledCourseIds) ? row.enrolledCourseIds : [] }))))
      .catch(() => { /* the list keeps what it had */ });
  }, [branch]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!branch) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(load, 400); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [branch, load]);
  return { pendingReview, clientsWithPlans };
}
