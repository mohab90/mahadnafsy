import { useEffect, useState } from 'react';
import type { DiscountRule } from '../../types';
import { mysqlCatalog } from '../../lib/mysqlapi';

/** Public pricing rules; admin mutations belong exclusively to the admin app. */
export function useDiscounts(initialDiscounts: DiscountRule[]) {
  const [discounts, setDiscounts] = useState<DiscountRule[]>(initialDiscounts);

  useEffect(() => {
    let cancelled = false;
    void mysqlCatalog.listDiscounts().then((rows) => {
      if (!cancelled) setDiscounts(rows as unknown as DiscountRule[]);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return { discounts };
}
