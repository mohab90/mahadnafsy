import { useCallback, useEffect, useState } from 'react';
import type { Bundle, Course, OrderItem } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { CRM_CHANGED_EVENT } from '../../lib/crmChanged';

type StaffPaymentRow = {
  id: string; clientId: string; clientName: string; clientEmail?: string; courseId: string | null; bundleId: string | null;
  amount: number; currency: string; paymentType: string; paymentMethod: string | null; at: string;
  staffId: string | null; staffName: string | null;
};

/**
 * The accounts desk's rows for an employee who keeps the accounts (customer service): the 500 newest payments of
 * their clients, shaped as the orders the desk draws — what an administration session gets from the orders list.
 * They were every payment of every client the panel had downloaded.
 */
export function useStaffOrders(enabled: boolean, courses: Course[], bundles: Bundle[]): OrderItem[] {
  const [rows, setRows] = useState<StaffPaymentRow[]>([]);

  const load = useCallback(async () => {
    try {
      const first = await mysqlAdmin.adminGet<{ rows: StaffPaymentRow[] }>('/staff/payments?limit=300&offset=0');
      const second = first.rows.length === 300
        ? await mysqlAdmin.adminGet<{ rows: StaffPaymentRow[] }>('/staff/payments?limit=200&offset=300') : { rows: [] };
      setRows([...first.rows, ...second.rows]);
    } catch { /* the desk keeps what it shows */ }
  }, []);

  useEffect(() => { if (enabled) void load(); }, [enabled, load]);
  useEffect(() => {
    if (!enabled) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = () => { clearTimeout(timer); timer = setTimeout(() => { void load(); }, 300); };
    window.addEventListener(CRM_CHANGED_EVENT, onChanged);
    return () => { clearTimeout(timer); window.removeEventListener(CRM_CHANGED_EVENT, onChanged); };
  }, [enabled, load]);

  const titleOf = (courseId: string | null) => {
    if (!courseId) return '';
    return courses.find(c => c.id === courseId)?.title || bundles.find(b => b.id === courseId)?.title || courseId;
  };
  return rows.map(p => ({
    id: p.id, type: 'course' as const, itemId: p.courseId || '', subscriberId: p.clientId,
    itemTitle: titleOf(p.courseId) || p.paymentType || '',
    amount: Number(p.amount) || 0, currency: (p.currency || 'EGP') as 'EGP' | 'SAR' | 'USD',
    paymentMethod: (p.paymentMethod || 'other') as OrderItem['paymentMethod'],
    customerName: p.clientName, customerEmail: p.clientEmail,
    status: 'paid' as const, createdAt: p.at, transactionId: p.id,
    staffId: p.staffId || undefined, staffName: p.staffName || undefined,
  }));
}
