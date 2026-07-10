import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { DiscountRule } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;

export function useDiscountsState(
  initialDiscounts: DiscountRule[],
  lastLocalConfigWriteRef: MutableRefObject<number>,
  track: Track,
) {
  const [discounts, setDiscounts] = useState<DiscountRule[]>(initialDiscounts);

  const persistDiscountsToConfig = (items: DiscountRule[]) => void mysqlAdmin.saveDiscounts(items as unknown[]).catch(() => {});

  const addDiscount = (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...discounts];
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('create', 'discount', item.label || `${item.discountPercent}%`);
  };

  const updateDiscount = (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.map((d) => (d.id === item.id ? item : d));
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('update', 'discount', item.label || `${item.discountPercent}%`);
  };

  const deleteDiscount = (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.filter((d) => d.id !== id);
    setDiscounts(next);
    persistDiscountsToConfig(next);
    track('delete', 'discount', id);
  };

  return { discounts, setDiscounts, addDiscount, updateDiscount, deleteDiscount };
}
