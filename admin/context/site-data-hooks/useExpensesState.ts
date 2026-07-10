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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistExpenseToCollection = (_item: ExpenseItem) => { /* PG-only */ };

  const addExpense = (item: ExpenseItem) => {
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => [item, ...prev]);
    persistExpenseToCollection(item);
    void mysqlAdmin.saveExpense(item as unknown as Record<string,unknown>);
    track('create', 'expense', item.description);
  };

  const updateExpense = (item: ExpenseItem) => {
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => prev.map((e) => (e.id === item.id ? item : e)));
    persistExpenseToCollection(item);
    void mysqlAdmin.updateExpense(item as unknown as Record<string,unknown>);
    track('update', 'expense', item.description);
  };

  const deleteExpense = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    void mysqlAdmin.deleteExpense(id);
    track('delete', 'expense', id);
  };

  return { expenses, setExpenses, addExpense, updateExpense, deleteExpense };
}
