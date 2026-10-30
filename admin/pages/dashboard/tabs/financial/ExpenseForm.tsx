import React, { useEffect, useState } from 'react';
import { Loader2, Receipt } from 'lucide-react';
import type { BranchType, ExpenseItem } from '../../../../types';
import { Modal } from '../../../../../shared/ui/Modal';
import { BRANCH_LABELS_AR, BRANCHES, normalizeBranch } from '../../../../constants/branches';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

interface BoxOption { method: string; currency: 'EGP' | 'SAR' | 'USD'; balance: number | null }

const branchName = (value?: string | null) => { const key = normalizeBranch(value); return key ? BRANCH_LABELS_AR[key] : ''; };

interface ExpenseFormProps {
  expenseDraft: Omit<ExpenseItem, 'id' | 'createdAt'>;
  setExpenseDraft: React.Dispatch<React.SetStateAction<Omit<ExpenseItem, 'id' | 'createdAt'>>>;
  expenseCategories: string[];
  editingExpenseId: string;
  onSubmit: () => void;
  onClose: () => void;
  saving?: boolean;
  /** The branch this screen is for (الدقي, التجمع) — fixed, not asked. */
  fixedBranch?: BranchType | null;
}

const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-red-400 focus:outline-none';

/** «إضافة مصروف» opens a window of its own instead of a strip above the table. */
export function ExpenseForm({
  expenseDraft,
  setExpenseDraft,
  expenseCategories,
  editingExpenseId,
  onSubmit,
  onClose,
  saving = false,
  fixedBranch = null,
}: ExpenseFormProps) {
  const set = <K extends keyof typeof expenseDraft>(key: K, value: (typeof expenseDraft)[K]) =>
    setExpenseDraft(draft => ({ ...draft, [key]: value }));
  // «لازم يكون اختيار الخزنة اللى هصرف منها الفلوس»: every box there is, with what is in it.
  const [boxes, setBoxes] = useState<BoxOption[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/admin/finance/box-options', { credentials: 'include', headers: adminAuthHeaders() })
      .then(response => (response.ok ? response.json() : []))
      .then((rows: BoxOption[]) => { if (alive) setBoxes(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (alive) setBoxes([]); });
    return () => { alive = false; };
  }, []);
  const boxKey = (box: Pick<BoxOption, 'method' | 'currency'>) => `${box.method}|${box.currency}`;
  const chosenBox = boxes?.find(box => box.method === expenseDraft.boxMethod && box.currency === expenseDraft.currency)
    || boxes?.find(box => box.method === expenseDraft.boxMethod);
  // An expense recorded before boxes were asked for has none, and may be saved without one.
  const needsBox = !editingExpenseId || !!expenseDraft.boxMethod;
  const ready = expenseDraft.description.trim().length > 0 && expenseDraft.amount > 0 && !!expenseDraft.date
    && (!needsBox || !!expenseDraft.boxMethod);
  const categories = expenseCategories.includes(expenseDraft.category) ? expenseCategories : [expenseDraft.category, ...expenseCategories].filter(Boolean);

  return (
    <Modal open onClose={onClose} size="md" tone="red" closeOnBackdrop={false} icon={<Receipt size={16} />}
      title={editingExpenseId ? 'تعديل مصروف' : 'إضافة مصروف'}
      subtitle={fixedBranch ? branchName(fixedBranch) : 'هيتسجل على الفرع اللي تختاره، وباسمك كقائم بالعملية'}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100">إلغاء</button>
          <button type="button" disabled={saving || !ready} onClick={onSubmit}
            className="flex items-center gap-1.5 rounded-xl bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40">
            {saving && <Loader2 size={14} className="animate-spin" />} {editingExpenseId ? 'حفظ التعديل' : 'إضافة المصروف'}
          </button>
        </div>
      )}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" dir="rtl">
        <label className="space-y-1 text-xs font-bold text-gray-600 sm:col-span-2">وصف المصروف *
          <input autoFocus className={field} value={expenseDraft.description} onChange={e => set('description', e.target.value)} placeholder="مثلاً: فاتورة كهرباء أكتوبر" />
        </label>
        <label className="space-y-1 text-xs font-bold text-gray-600">البند
          <select className={field} value={expenseDraft.category} onChange={e => set('category', e.target.value)}>
            {categories.map(category => <option key={category}>{category}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-bold text-gray-600">الفرع
          {fixedBranch
            ? <input className={`${field} bg-gray-50`} value={branchName(fixedBranch)} readOnly />
            : (
              <select className={field} value={expenseDraft.branchType || 'ONLINE_EGYPT'} onChange={e => set('branchType', e.target.value as BranchType)}>
                {BRANCHES.filter(branch => branch !== 'OTHER').map(branch => <option key={branch} value={branch}>{BRANCH_LABELS_AR[branch]}</option>)}
              </select>
            )}
        </label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="space-y-1 text-xs font-bold text-gray-600">المبلغ *
            <input type="number" min={0} inputMode="decimal" className={field} value={expenseDraft.amount || ''} onChange={e => set('amount', +e.target.value)} />
          </label>
          <label className="space-y-1 text-xs font-bold text-gray-600">العملة
            <select className={field} value={expenseDraft.currency} onChange={e => set('currency', e.target.value as 'EGP' | 'SAR' | 'USD')}>
              <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
            </select>
          </label>
        </div>
        <label className="space-y-1 text-xs font-bold text-gray-600 sm:col-span-2">الخزنة اللي هتصرف منها *
          <select className={`${field} ${expenseDraft.boxMethod ? '' : 'border-red-300'}`} value={chosenBox ? boxKey(chosenBox) : ''}
            onChange={event => {
              const box = boxes?.find(option => boxKey(option) === event.target.value);
              if (box) setExpenseDraft(draft => ({ ...draft, boxMethod: box.method, currency: box.currency }));
            }}>
            <option value="">{boxes === null ? 'بنحمّل الخزن…' : '— اختار الخزنة —'}</option>
            {(boxes || []).map(box => (
              <option key={boxKey(box)} value={boxKey(box)}>{box.method} ({box.currency}){box.balance === null ? '' : ` — الرصيد ${box.balance.toLocaleString('ar-EG-u-nu-latn')}`}</option>
            ))}
          </select>
          {chosenBox && chosenBox.balance !== null && Number(expenseDraft.amount) > chosenBox.balance && (
            <span className="block text-[11px] font-bold text-amber-700">المبلغ أكبر من رصيد الخزنة الحالي ({chosenBox.balance.toLocaleString('ar-EG-u-nu-latn')} {chosenBox.currency}).</span>
          )}
        </label>
        <label className="space-y-1 text-xs font-bold text-gray-600">التاريخ
          <input type="date" className={field} value={expenseDraft.date} onChange={e => set('date', e.target.value)} />
        </label>
        <label className="space-y-1 text-xs font-bold text-gray-600 sm:col-span-2">رابط الإيصال (اختياري)
          <input className={field} dir="ltr" value={expenseDraft.receiptUrl || ''} onChange={e => set('receiptUrl', e.target.value)} />
        </label>
      </div>
    </Modal>
  );
}
