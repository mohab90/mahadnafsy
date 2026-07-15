import type React from 'react';
import { Plus, X } from 'lucide-react';
import type { Course, Currency, SubscriberItem } from '../../../../types';

export interface InstallmentPlanDraft {
  courseId: string;
  courseTitle: string;
  totalAmount: number;
  currency: Currency;
  notes: string;
  entries: { dueDate: string; amount: number; note: string }[];
}

interface InstallmentPlanModalProps {
  open: boolean;
  subscribers: SubscriberItem[];
  courses: Course[];
  newPlanSubId: string;
  setNewPlanSubId: React.Dispatch<React.SetStateAction<string>>;
  newPlanDraft: InstallmentPlanDraft;
  setNewPlanDraft: React.Dispatch<React.SetStateAction<InstallmentPlanDraft>>;
  newEntry: { dueDate: string; amount: number; note: string };
  setNewEntry: React.Dispatch<React.SetStateAction<{ dueDate: string; amount: number; note: string }>>;
  onClose: () => void;
  onSave: () => void;
}

export function InstallmentPlanModal({
  open,
  subscribers,
  courses,
  newPlanSubId,
  setNewPlanSubId,
  newPlanDraft,
  setNewPlanDraft,
  newEntry,
  setNewEntry,
  onClose,
  onSave,
}: InstallmentPlanModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" dir="rtl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-4">إضافة خطة أقساط</h3>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">العميل *</label>
            <select value={newPlanSubId} onChange={e => setNewPlanSubId(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">— اختر العميل —</option>
              {[...subscribers].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(s => (
                <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">الكورس / البرنامج (اختياري)</label>
            <select value={newPlanDraft.courseId} onChange={e => {
              const c = courses.find(x => x.id === e.target.value);
              setNewPlanDraft(d => ({ ...d, courseId: e.target.value, courseTitle: c?.title || d.courseTitle }));
            }} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
              <option value="">— اختر كورس —</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">اسم الكورس / المنتج (نص حر)</label>
            <input value={newPlanDraft.courseTitle} onChange={e => setNewPlanDraft(d => ({ ...d, courseTitle: e.target.value }))}
              placeholder="مثال: دبلوم الإرشاد النفسي"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">الإجمالي *</label>
              <input type="number" min={0} value={newPlanDraft.totalAmount || ''}
                onChange={e => setNewPlanDraft(d => ({ ...d, totalAmount: +e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">العملة</label>
              <select value={newPlanDraft.currency} onChange={e => setNewPlanDraft(d => ({ ...d, currency: e.target.value as Currency }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                <option value="EGP">ج.م (EGP)</option>
                <option value="SAR">ر.س (SAR)</option>
                <option value="USD">$ (USD)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">ملاحظات</label>
            <input value={newPlanDraft.notes} onChange={e => setNewPlanDraft(d => ({ ...d, notes: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-gray-700">الدفعات ({newPlanDraft.entries.length} دفعة)</p>
            <div className="flex gap-1.5 flex-wrap">
              <input type="date" value={newEntry.dueDate} onChange={e => setNewEntry(d => ({ ...d, dueDate: e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
              <input type="number" min={0} placeholder="المبلغ" value={newEntry.amount || ''}
                onChange={e => setNewEntry(d => ({ ...d, amount: +e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs w-24" />
              <input placeholder="ملاحظة" value={newEntry.note}
                onChange={e => setNewEntry(d => ({ ...d, note: e.target.value }))}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs flex-1 min-w-16" />
              <button onClick={() => {
                if (!newEntry.dueDate || !newEntry.amount) return;
                setNewPlanDraft(d => ({ ...d, entries: [...d.entries, { ...newEntry }] }));
                setNewEntry({ dueDate: '', amount: 0, note: '' });
              }} className="bg-primary-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">
                <Plus size={13} />
              </button>
            </div>
            {newPlanDraft.entries.map((e, i) => (
              <div key={i} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-1.5 text-xs">
                <span className="text-gray-700">{e.dueDate} · {e.amount.toLocaleString()} {newPlanDraft.currency}{e.note ? ` · ${e.note}` : ''}</span>
                <button onClick={() => setNewPlanDraft(d => ({ ...d, entries: d.entries.filter((_, j) => j !== i) }))}
                  className="text-red-400 hover:text-red-600"><X size={12} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={onSave}
              disabled={!newPlanSubId || !newPlanDraft.totalAmount || newPlanDraft.entries.length === 0}
              className="flex-1 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50">
              حفظ الخطة
            </button>
            <button onClick={onClose} className="px-5 bg-gray-200 text-gray-700 rounded-xl hover:bg-gray-300">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
