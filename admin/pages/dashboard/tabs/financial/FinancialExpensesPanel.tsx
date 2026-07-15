import React from 'react';
import { Plus, Wallet } from 'lucide-react';
import type { ExpenseItem } from '../../../../types';
import { ExpenseForm } from './ExpenseForm';
import { ExpenseTable } from './ExpenseTable';

type ExpenseDraft = Omit<ExpenseItem, 'id' | 'createdAt'>;

interface Props {
  expenseDraft: ExpenseDraft;
  setExpenseDraft: React.Dispatch<React.SetStateAction<ExpenseDraft>>;
  expenseCategories: string[];
  editingExpenseId: string;
  setEditingExpenseId: React.Dispatch<React.SetStateAction<string>>;
  isExpenseFormOpen: boolean;
  setIsExpenseFormOpen: React.Dispatch<React.SetStateAction<boolean>>;
  expenseCategoryFilter: string;
  setExpenseCategoryFilter: React.Dispatch<React.SetStateAction<string>>;
  expenseDateFrom: string;
  setExpenseDateFrom: React.Dispatch<React.SetStateAction<string>>;
  expenseDateTo: string;
  setExpenseDateTo: React.Dispatch<React.SetStateAction<string>>;
  filteredExpenses: ExpenseItem[];
  toEGP: (amount: number, currency: string) => number;
  exportCSV: (filename: string, rows: string[][], headers: string[]) => void;
  addExpense: (expense: ExpenseItem) => void;
  updateExpense: (expense: ExpenseItem) => void;
  deleteExpense: (id: string) => void;
}

export function FinancialExpensesPanel({
  expenseDraft,
  setExpenseDraft,
  expenseCategories,
  editingExpenseId,
  setEditingExpenseId,
  isExpenseFormOpen,
  setIsExpenseFormOpen,
  expenseCategoryFilter,
  setExpenseCategoryFilter,
  expenseDateFrom,
  setExpenseDateFrom,
  expenseDateTo,
  setExpenseDateTo,
  filteredExpenses,
  toEGP,
  exportCSV,
  addExpense,
  updateExpense,
  deleteExpense,
}: Props) {
  return (
  <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-bold text-gray-800 flex items-center gap-2"><Wallet size={16} className="text-red-500" />سجل المصروفات</h4>
              <button onClick={() => { setIsExpenseFormOpen(v => !v); setEditingExpenseId(''); setExpenseDraft({ category: 'أخرى', description: '', amount: 0, currency: 'EGP', date: new Date().toISOString().slice(0,10), receiptUrl: '' }); }} className="flex items-center gap-1.5 bg-primary-600 text-white px-3 py-2 rounded-xl text-sm font-bold"><Plus size={14}/>{isExpenseFormOpen ? 'إغلاق' : 'إضافة مصروف'}</button>
            </div>
            {isExpenseFormOpen && (
              <ExpenseForm
                expenseDraft={expenseDraft}
                setExpenseDraft={setExpenseDraft}
                expenseCategories={expenseCategories}
                editingExpenseId={editingExpenseId}
                onSubmit={() => {
                  if (!expenseDraft.description || expenseDraft.amount <= 0) return;
                  const now = new Date().toISOString();
                  if (editingExpenseId) {
                    updateExpense({ ...expenseDraft, id: editingExpenseId, createdAt: now });
                    setEditingExpenseId('');
                  } else {
                    addExpense({ ...expenseDraft, id: `exp-${Date.now()}`, createdAt: now });
                  }
                  setIsExpenseFormOpen(false);
                }}
              />
            )}
            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <select className="border border-gray-300 rounded-xl px-3 py-2 text-sm" value={expenseCategoryFilter} onChange={e => setExpenseCategoryFilter(e.target.value)}>
                <option value="all">كل الفئات</option>
                {expenseCategories.map(c => <option key={c}>{c}</option>)}
              </select>
              <input type="date" className="border border-gray-300 rounded-xl px-3 py-2 text-sm" value={expenseDateFrom} onChange={e => setExpenseDateFrom(e.target.value)} />
              <input type="date" className="border border-gray-300 rounded-xl px-3 py-2 text-sm" value={expenseDateTo} onChange={e => setExpenseDateTo(e.target.value)} />
            </div>
            <ExpenseTable
              filteredExpenses={filteredExpenses}
              totalEGP={filteredExpenses.reduce((sum, expense) => sum + toEGP(expense.amount, expense.currency), 0)}
              exportCSV={exportCSV}
              onEdit={(expense) => { setExpenseDraft({ category: expense.category, description: expense.description, amount: expense.amount, currency: expense.currency, date: expense.date, receiptUrl: expense.receiptUrl || '' }); setEditingExpenseId(expense.id); setIsExpenseFormOpen(true); }}
              onDelete={deleteExpense}
            />
          </article>
  );
}
