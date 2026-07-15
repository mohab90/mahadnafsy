import React from 'react';
import type { ExpenseItem } from '../../../../types';

interface ExpenseFormProps {
  expenseDraft: Omit<ExpenseItem, 'id' | 'createdAt'>;
  setExpenseDraft: React.Dispatch<React.SetStateAction<Omit<ExpenseItem, 'id' | 'createdAt'>>>;
  expenseCategories: string[];
  editingExpenseId: string;
  onSubmit: () => void;
}

export function ExpenseForm({
  expenseDraft,
  setExpenseDraft,
  expenseCategories,
  editingExpenseId,
  onSubmit,
}: ExpenseFormProps) {
  return (
    <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <select className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.category} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, category: event.target.value as ExpenseItem['category'] }))}>
          {expenseCategories.map((category) => <option key={category}>{category}</option>)}
        </select>
        <input type="number" min={0} placeholder="المبلغ" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.amount || ''} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, amount: +event.target.value }))} />
        <select className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.currency} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, currency: event.target.value as 'EGP' | 'SAR' | 'USD' }))}>
          <option value="EGP">ج.م (EGP)</option><option value="SAR">ر.س (SAR)</option><option value="USD">$ (USD)</option>
        </select>
        <input type="date" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.date} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, date: event.target.value }))} />
        <input placeholder="رابط الإيصال (اختياري)" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.receiptUrl || ''} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, receiptUrl: event.target.value }))} />
        <input placeholder="وصف المصروف *" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.description} onChange={(event) => setExpenseDraft((draft) => ({ ...draft, description: event.target.value }))} />
      </div>
      <button onClick={onSubmit} className="bg-primary-600 text-white px-5 py-2 rounded-xl font-bold">
        {editingExpenseId ? 'تحديث' : 'إضافة مصروف'}
      </button>
    </div>
  );
}
