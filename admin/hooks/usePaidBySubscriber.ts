import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../lib/mysqlapi';
import { useAccess } from './useAccess';

/**
 * What each client has paid, net, in EGP — from GET /admin/subscribers/stats
 * ?paidBySubscriber=1, scoped like the client list.
 *
 * The retention and subscriptions screens summed `subscriber.totalPaid`, a
 * field the subscriber list never carries, so every revenue figure on them
 * read 0 ج. `null` while loading.
 *
 * Not asked for by an account without view_subscribers (the accountant opens «الاشتراكات المتكررة» on view_financial): it answered 403 (5 Nov 2026); such an account
 * gets `{}`, like a failed answer.
 */
export function usePaidBySubscriber(): Record<string, number> | null {
  const [paid, setPaid] = useState<Record<string, number> | null>(null);
  const mayRead = useAccess().can('view_subscribers');
  useEffect(() => {
    if (!mayRead) { setPaid({}); return undefined; }
    let alive = true;
    mysqlAdmin.adminGet<{ paidBySubscriber?: Record<string, number> }>('/admin/subscribers/stats?paidBySubscriber=1')
      .then(result => { if (alive) setPaid(result.paidBySubscriber || {}); }, () => { if (alive) setPaid({}); });
    return () => { alive = false; };
  }, [mayRead]);
  return paid;
}
