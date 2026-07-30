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

  const addDiscount = async (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = [item, ...discounts];
    await mysqlAdmin.saveDiscounts(next as unknown[]);
    setDiscounts(next);
    track('create', 'discount', item.label || `${item.discountPercent}%`);
  };

  const updateDiscount = async (item: DiscountRule) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.map((d) => (d.id === item.id ? item : d));
    await mysqlAdmin.saveDiscounts(next as unknown[]);
    setDiscounts(next);
    track('update', 'discount', item.label || `${item.discountPercent}%`);
  };

  const deleteDiscount = async (id: string) => {
    lastLocalConfigWriteRef.current = Date.now();
    const next = discounts.filter((d) => d.id !== id);
    await mysqlAdmin.saveDiscounts(next as unknown[]);
    setDiscounts(next);
    track('delete', 'discount', id);
  };

  return { discounts, setDiscounts, addDiscount, updateDiscount, deleteDiscount };
}
