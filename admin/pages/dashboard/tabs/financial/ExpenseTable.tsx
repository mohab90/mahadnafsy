import { Download } from 'lucide-react';
import type { ExpenseItem } from '../../../../types';
import { BRANCH_LABELS_AR, normalizeBranch } from '../../../../constants/branches';

const branchLabel = (value?: string) => { const key = normalizeBranch(value); return key ? BRANCH_LABELS_AR[key] : '—'; };

interface ExpenseTableProps {
  filteredExpenses: ExpenseItem[];
  totalEGP: number;
  exportCSV: (filename: string, rows: string[][], headers: string[]) => void;
  onEdit: (expense: ExpenseItem) => void;
  onDelete: (id: string) => Promise<void>;
  deletingId?: string;
}

export function ExpenseTable({ filteredExpenses, totalEGP, exportCSV, onEdit, onDelete, deletingId }: ExpenseTableProps) {
  return (
    <>
      <div className="mr-auto flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-500">المجموع: <span className="font-bold text-red-600">{totalEGP.toLocaleString('ar-EG-u-nu-latn')} ج.م</span></span>
        <button
          onClick={() => exportCSV(
            'expenses.csv',
            filteredExpenses.map((expense) => [expense.category, expense.description, String(expense.amount), expense.currency, expense.date, branchLabel(expense.branchType), expense.staffName || '']),
            ['البند', 'الوصف', 'المبلغ', 'العملة', 'التاريخ', 'الفرع', 'القائم بالعملية']
          )}
          className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl px-3 py-1.5 text-xs font-bold transition">
          <Download size={13} /> تصدير CSV
        </button>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[720px]">
        <thead><tr className="text-right border-b border-gray-100"><th className="py-2">البند</th><th className="py-2">الوصف</th><th className="py-2">المبلغ</th><th className="py-2">الفرع</th><th className="py-2">القائم بالعملية</th><th className="py-2">التاريخ</th><th className="py-2">إجراءات</th></tr></thead>
        <tbody>
          {filteredExpenses.map((expense) => (
            <tr key={expense.id} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-2.5"><span className="bg-red-50 text-red-700 text-xs px-2 py-0.5 rounded-full border border-red-200">{expense.category}</span></td>
              <td className="py-2.5 text-gray-700">{expense.description}</td>
              <td className="py-2.5 font-bold text-red-600 tabular-nums">{Number(expense.amount).toLocaleString('ar-EG-u-nu-latn')} {expense.currency}</td>
              <td className="py-2.5 text-xs text-gray-600">{branchLabel(expense.branchType)}</td>
              <td className="py-2.5 text-xs text-gray-600">{expense.staffName || '—'}</td>
              <td className="py-2.5 text-gray-500 text-xs">{expense.date}</td>
              <td className="py-2.5 flex gap-2">
                <button onClick={() => onEdit(expense)} className="text-primary-600 text-xs font-bold">تعديل</button>
                <button disabled={deletingId === expense.id} onClick={() => void onDelete(expense.id)} className="text-red-500 disabled:opacity-50 text-xs">
                  {deletingId === expense.id ? 'جاري...' : 'حذف'}
                </button>
              </td>
            </tr>
          ))}
          {filteredExpenses.length === 0 && (<tr><td colSpan={7} className="py-6 text-center text-gray-400">لا توجد مصروفات مطابقة للفلاتر</td></tr>)}
        </tbody>
      </table>
      </div>
    </>
  );
}
