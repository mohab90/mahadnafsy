import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ExpenseItem } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;
export function useExpensesState(
  initialExpenses: ExpenseItem[],
  lastCRMWriteRef: MutableRefObject<number>,
  track: Track,
) {
  const [expenses, setExpenses] = useState<ExpenseItem[]>(initialExpenses);

  const addExpense = async (item: ExpenseItem) => {
    await mysqlAdmin.saveExpense(item as unknown as Record<string,unknown>);
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => [item, ...prev]);
    track('create', 'expense', item.description);
  };

  const updateExpense = async (item: ExpenseItem) => {
    await mysqlAdmin.updateExpense(item as unknown as Record<string,unknown>);
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => prev.map((e) => (e.id === item.id ? item : e)));
    track('update', 'expense', item.description);
  };

  const deleteExpense = async (id: string) => {
    await mysqlAdmin.deleteExpense(id);
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    track('delete', 'expense', id);
  };

  return { expenses, setExpenses, addExpense, updateExpense, deleteExpense };
}
