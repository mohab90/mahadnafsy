import type { Dispatch, SetStateAction } from 'react';
import { Clock, X } from 'lucide-react';

import type { Bundle, Course } from '../../types';

type LegacyPaymentDraft = { courseId: string; courseExpected: string; amountPaid: string; note: string };

type UnifiedClientLegacyPaymentModalProps = {
  open: boolean;
  clientName: string;
  courses: Course[];
  bundles: Bundle[];
  legacyPayDraft: LegacyPaymentDraft;
  settlementLabel: string;
  setLegacyPayDraft: Dispatch<SetStateAction<LegacyPaymentDraft>>;
  onSubmit: () => void;
  onClose: () => void;
};

export function UnifiedClientLegacyPaymentModal({
  open,
  clientName,
  courses,
  bundles,
  legacyPayDraft,
  settlementLabel,
  setLegacyPayDraft,
  onSubmit,
  onClose,
}: UnifiedClientLegacyPaymentModalProps) {
  if (!open) return null;

  return (

  <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => onClose()}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow">
            <Clock size={18} />
          </div>
          <div>
            <p className="font-extrabold text-gray-900 text-sm">تسجيل مدفوع قديم</p>
            <p className="text-[11px] text-gray-400">{clientName}</p>
          </div>
        </div>
        <button onClick={() => onClose()} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
      </div>
      <div className="p-5 space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
          لتسجيل عميل قديم سبق أن دفع قبل النظام الحالي
        </div>
        <div>
          <label className="text-xs text-gray-600 mb-1 block">الكورس *</label>
          <select value={legacyPayDraft.courseId} onChange={e => setLegacyPayDraft({ ...legacyPayDraft, courseId: e.target.value })}
            className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
            <option value="">— اختر الكورس —</option>
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
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-600 mb-1 block">سعر الكورس الكامل *</label>
            <input type="number" min="0" placeholder="مثال: 3000" value={legacyPayDraft.courseExpected}
              onChange={e => setLegacyPayDraft({ ...legacyPayDraft, courseExpected: e.target.value })}
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block">المبلغ المدفوع *</label>
            <input type="number" min="0" placeholder="مثال: 2000" value={legacyPayDraft.amountPaid}
              onChange={e => setLegacyPayDraft({ ...legacyPayDraft, amountPaid: e.target.value })}
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        {legacyPayDraft.courseExpected && legacyPayDraft.amountPaid && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
            <span className="text-blue-600">متبقي</span>
            <span className="font-extrabold text-red-600">
              {Math.max(0, Number(legacyPayDraft.courseExpected) - Number(legacyPayDraft.amountPaid)).toLocaleString()} {settlementLabel}
            </span>
          </div>
        )}
        <div>
          <label className="text-xs text-gray-600 mb-1 block">ملاحظة (اختياري)</label>
          <input value={legacyPayDraft.note} onChange={e => setLegacyPayDraft({ ...legacyPayDraft, note: e.target.value })}
            placeholder="مثال: دفع نقدي قبل النظام"
            className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm" />
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={onSubmit}
            disabled={!legacyPayDraft.courseId || !legacyPayDraft.courseExpected || !legacyPayDraft.amountPaid}
            className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold hover:bg-amber-700 disabled:opacity-40">
            💾 تسجيل المدفوع
          </button>
          <button onClick={() => onClose()}
            className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
        </div>
      </div>
    </div>
  </div>
  );
}
