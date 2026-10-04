import { useEffect, useState } from 'react';
import { mysqlAdmin } from '../lib/mysqlapi';

/**
 * What each client has paid, net, in EGP — from GET /admin/subscribers/stats
 * ?paidBySubscriber=1, scoped like the client list.
 *
 * The retention and subscriptions screens summed `subscriber.totalPaid`, a
 * field the subscriber list never carries, so every revenue figure on them
 * read 0 ج. `null` while loading.
 */
export function usePaidBySubscriber(): Record<string, number> | null {
  const [paid, setPaid] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    mysqlAdmin.adminGet<{ paidBySubscriber?: Record<string, number> }>('/admin/subscribers/stats?paidBySubscriber=1')
      .then(result => { if (alive) setPaid(result.paidBySubscriber || {}); }, () => { if (alive) setPaid({}); });
    return () => { alive = false; };
  }, []);
  return paid;
}
