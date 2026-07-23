import { useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ExpenseItem } from '../../types';
import { mysqlAdmin } from '../../lib/mysqlapi';

type Track = (action: string, entity: string, label: string) => void;
type PersistOrRevert = (apiCall: Promise<unknown>, revert: () => void, detail: { field: string; name?: string }) => void;

export function useExpensesState(
  initialExpenses: ExpenseItem[],
  lastCRMWriteRef: MutableRefObject<number>,
  persistOrRevert: PersistOrRevert,
  track: Track,
) {
  const [expenses, setExpenses] = useState<ExpenseItem[]>(initialExpenses);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const persistExpenseToCollection = (_item: ExpenseItem) => { /* PG-only */ };

  const addExpense = (item: ExpenseItem) => {
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => [item, ...prev]);
    persistExpenseToCollection(item);
    persistOrRevert(
      mysqlAdmin.saveExpense(item as unknown as Record<string,unknown>),
      () => setExpenses((prev) => prev.filter((row) => row.id !== item.id)),
      { field: 'expense', name: item.description }
    );
    track('create', 'expense', item.description);
  };

  const updateExpense = (item: ExpenseItem) => {
    lastCRMWriteRef.current = Date.now();
    const prevExpense = expenses.find((e) => e.id === item.id);
    setExpenses((prev) => prev.map((e) => (e.id === item.id ? item : e)));
    persistExpenseToCollection(item);
    persistOrRevert(
      mysqlAdmin.updateExpense(item as unknown as Record<string,unknown>),
      () => { if (prevExpense) setExpenses((prev) => prev.map((e) => (e.id === item.id ? prevExpense : e))); },
      { field: 'expense', name: item.description }
    );
    track('update', 'expense', item.description);
  };

  const deleteExpense = (id: string) => {
    lastCRMWriteRef.current = Date.now();
    const removed = expenses.find((e) => e.id === id);
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    persistOrRevert(
      mysqlAdmin.deleteExpense(id),
      () => { if (removed) setExpenses((prev) => [removed, ...prev]); },
      { field: 'expense', name: removed?.description }
    );
    track('delete', 'expense', id);
  };

  return { expenses, setExpenses, addExpense, updateExpense, deleteExpense };
}
