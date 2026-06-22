import React from 'react';
import { CreditCard, X } from 'lucide-react';
import type { SubscriberItem, Course, PaymentHistoryEntry } from '../../types';

type BookingMap = Record<string, { paidEGP: number; expectedEGP?: number; discount?: number }>;

interface Props {
  clientName: string;
  subscriber: SubscriberItem;
  courses: Course[];
  subPaidTotals: { EGP: number; SAR: number; USD: number };
  subRemainingEGP: number;
  bookingMap: BookingMap;
  confirmedHistory: PaymentHistoryEntry[];
  onClose: () => void;
}

/** "التفاصيل المالية" modal — extracted from UnifiedClientPage. */
export default function PaymentDetailModal({ clientName, subscriber, courses, subPaidTotals, subRemainingEGP, bookingMap, confirmedHistory, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow">
              <CreditCard size={18} />
            </div>
            <div>
              <p className="font-extrabold text-gray-900 text-sm">التفاصيل المالية</p>
              <p className="text-[11px] text-gray-400">{clientName}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500"><X size={16} /></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            {subPaidTotals.EGP > 0 && (
              <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                <p className="font-extrabold text-emerald-700 text-base">{subPaidTotals.EGP.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ج.م</p>
              </div>
            )}
            {subRemainingEGP > 0 && (
              <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                <p className="font-extrabold text-red-600 text-base">{subRemainingEGP.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">متبقي ج.م</p>
              </div>
            )}
            {subPaidTotals.SAR > 0 && (
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="font-extrabold text-blue-700 text-base">{subPaidTotals.SAR.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ر.س</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wider">تفاصيل كل كورس</p>
            {subscriber.enrolledCourseIds.map(cId => {
              const course = courses.find(x => x.id === cId);
              const bm = bookingMap[cId];
              const remaining = bm?.expectedEGP != null ? Math.max(0, bm.expectedEGP - bm.paidEGP) : null;
              return (
                <div key={cId} className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                  <p className="font-bold text-gray-800 text-sm mb-2">{course?.title || cId}</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {bm?.expectedEGP != null && (
                      <div>
                        <p className="text-gray-400">السعر</p>
                        <p className="font-bold text-gray-700">{bm.expectedEGP.toLocaleString()}</p>
                      </div>
                    )}
                    {bm && (
                      <div>
                        <p className="text-gray-400">مدفوع</p>
                        <p className="font-bold text-emerald-700">{bm.paidEGP.toLocaleString()}</p>
                      </div>
                    )}
                    {remaining !== null && (
                      <div>
                        <p className="text-gray-400">متبقي</p>
                        <p className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{remaining > 0 ? remaining.toLocaleString() : '✅'}</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {confirmedHistory.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wider">سجل المدفوعات ({confirmedHistory.length})</p>
              {confirmedHistory.slice().reverse().map((p, i) => (
                <div key={i} className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-xs font-bold text-gray-800">{p.amount.toLocaleString()} {p.currency === 'SAR' ? 'ر.س' : p.currency === 'USD' ? '$' : 'ج.م'}</p>
                    {p.note && <p className="text-[11px] text-gray-400 mt-0.5">{p.note}</p>}
                  </div>
                  <p className="text-[11px] text-gray-400">{p.at || ''}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
