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
    // The server names the row, its branch and who entered it: keeping the
    // screen's own id made editing or deleting a just-added expense «not found».
    const saved = await mysqlAdmin.saveExpense(item as unknown as Record<string,unknown>) as unknown as Partial<ExpenseItem> & { id?: string };
    lastCRMWriteRef.current = Date.now();
    const row: ExpenseItem = {
      ...item,
      id: saved?.id || item.id,
      ...(saved?.category ? { category: saved.category } : {}),
      ...(saved?.branchType ? { branchType: saved.branchType } : {}),
      staffName: saved?.staffName ?? item.staffName ?? null,
    };
    setExpenses((prev) => [row, ...prev]);
    track('create', 'expense', item.description);
  };

  const updateExpense = async (item: ExpenseItem) => {
    await mysqlAdmin.updateExpense(item as unknown as Record<string,unknown>);
    lastCRMWriteRef.current = Date.now();
    setExpenses((prev) => prev.map((e) => (e.id === item.id ? { ...e, ...item, staffName: e.staffName, createdAt: e.createdAt } : e)));
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
