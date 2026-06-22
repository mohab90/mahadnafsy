import React from 'react';
import { CreditCard, X } from 'lucide-react';
import type { PaymentRecord, Course, Bundle } from '../../types';

type LeadPayDraft = Omit<PaymentRecord, 'id'>;

interface Props {
  clientName: string;
  leadPayDraft: LeadPayDraft; setLeadPayDraft: (v: LeadPayDraft) => void;
  courses: Course[];
  bundles: Bundle[];
  onSave: () => void;
  onClose: () => void;
}

/** "تسجيل دفعة جديدة" (lead) modal — extracted from UnifiedClientPage. */
export default function LeadPaymentModal({ clientName, leadPayDraft, setLeadPayDraft, courses, bundles, onSave, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="bg-gradient-to-l from-red-700 to-red-500 px-5 py-4 rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-xl p-2"><CreditCard size={20} className="text-white" /></div>
              <div>
                <p className="font-extrabold text-white text-base leading-tight">تسجيل دفعة جديدة</p>
                <p className="text-red-100 text-xs mt-0.5">{clientName}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"><X size={16} /></button>
          </div>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs text-gray-600 mb-1 block">المبلغ</label>
              <input type="number" min="0" value={leadPayDraft.amount || ''} onChange={e => setLeadPayDraft({ ...leadPayDraft, amount: Number(e.target.value) })}
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="text-xs text-gray-600 mb-1 block">العملة</label>
              <select value={leadPayDraft.currency} onChange={e => setLeadPayDraft({ ...leadPayDraft, currency: e.target.value as 'EGP' | 'SAR' | 'USD' })}
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
              </select></div>
            <div><label className="text-xs text-gray-600 mb-1 block">الكورس</label>
              <select value={leadPayDraft.courseId} onChange={e => setLeadPayDraft({ ...leadPayDraft, courseId: e.target.value })}
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
                <option value="">اختر</option>
                {(() => {
                  const bundledIds = new Set(bundles.flatMap(b => b.courses.map(x => x.id)));
                  return (<>
                    {bundles.map(b => (
                      <optgroup key={b.id} label={`📌 ${b.title}`}>
                        {b.courses.map(bc => <option key={bc.id} value={bc.id}>{bc.title}</option>)}
                      </optgroup>
                    ))}
                    <optgroup label="🎓 الكورسات الفردية">
                      {courses.filter(bc => !bundledIds.has(bc.id)).map(bc => <option key={bc.id} value={bc.id}>{bc.title}</option>)}
                    </optgroup>
                  </>);
                })()}
              </select></div>
            <div><label className="text-xs text-gray-600 mb-1 block">التاريخ</label>
              <input type="date" value={leadPayDraft.date} onChange={e => setLeadPayDraft({ ...leadPayDraft, date: e.target.value })}
                className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div><label className="text-xs text-gray-600 mb-1 block">ملاحظة</label>
            <input value={leadPayDraft.note || ''} onChange={e => setLeadPayDraft({ ...leadPayDraft, note: e.target.value })}
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" /></div>
          <div className="flex gap-2 pt-1">
            <button onClick={onSave} className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 flex items-center justify-center gap-2"><CreditCard size={15} /> تسجيل الدفعة</button>
            <button onClick={onClose} className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
