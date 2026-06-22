import React from 'react';
import { X } from 'lucide-react';
import type { SubscriberItem, Course, ExtraCertificateType } from '../../types';
import { EXTRA_TYPE_LABELS } from '../unifiedClient.constants';

type ExtraCertDraft = { courseId: string; type: ExtraCertificateType | ''; certExpected: string; certPaid: string };

interface Props {
  clientName: string;
  subscriber: SubscriberItem;
  courses: Course[];
  extraCertDraft: ExtraCertDraft; setExtraCertDraft: (v: ExtraCertDraft) => void;
  onSave: () => void;
  onClose: () => void;
}

/** "طلب شهادة إضافية" modal — extracted from UnifiedClientPage. */
export default function ExtraCertRequestModal({ clientName, subscriber, courses, extraCertDraft, setExtraCertDraft, onSave, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-lg shadow">🏆</div>
            <div>
              <p className="font-extrabold text-gray-900 text-sm">طلب شهادة إضافية</p>
              <p className="text-[11px] text-gray-400">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-xs text-gray-600 mb-1.5 block font-medium">الكورس</label>
            <select value={extraCertDraft.courseId}
              onChange={e => setExtraCertDraft({ ...extraCertDraft, courseId: e.target.value })}
              className="w-full border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm">
              <option value="">— اختر الكورس —</option>
              {subscriber.enrolledCourseIds.map(cId => {
                const ec = courses.find(x => x.id === cId);
                return <option key={cId} value={cId}>{ec?.title || cId}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1.5 block font-medium">نوع الشهادة</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.entries(EXTRA_TYPE_LABELS) as [ExtraCertificateType, string][]).map(([val, label]) => (
                <button key={val} onClick={() => setExtraCertDraft({ ...extraCertDraft, type: val })}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium border transition text-right ${extraCertDraft.type === val ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-bold shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-emerald-200'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">سعر الشهادة (اختياري)</label>
              <input type="number" min="0" placeholder="0 ج.م" value={extraCertDraft.certExpected}
                onChange={e => setExtraCertDraft({ ...extraCertDraft, certExpected: e.target.value })}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-600 mb-1 block">مدفوع منها (اختياري)</label>
              <input type="number" min="0" placeholder="0 ج.م" value={extraCertDraft.certPaid}
                onChange={e => setExtraCertDraft({ ...extraCertDraft, certPaid: e.target.value })}
                className="w-full border border-gray-200 bg-white rounded-lg px-2 py-1.5 text-sm" />
            </div>
          </div>
          {extraCertDraft.certExpected && Number(extraCertDraft.certExpected) > 0 && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs flex items-center justify-between">
              <span className="text-blue-600">متبقي</span>
              <span className="font-extrabold text-red-600">{Math.max(0, Number(extraCertDraft.certExpected) - Number(extraCertDraft.certPaid || 0)).toLocaleString()} ج.م</span>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={onSave}
              disabled={!extraCertDraft.courseId || !extraCertDraft.type}
              className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">
              💾 إضافة الطلب
            </button>
            <button onClick={onClose}
              className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
