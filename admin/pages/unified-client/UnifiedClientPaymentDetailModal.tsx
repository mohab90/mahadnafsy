import React from 'react';
import { CreditCard, X } from 'lucide-react';

import type { Course, PaymentHistoryEntry, SubscriberItem } from '../../types';

type PaidTotals = { EGP: number; SAR: number; USD: number };
type BookingMap = Record<string, { paidEGP: number; expectedEGP?: number; discount?: number }>;

interface UnifiedClientPaymentDetailModalProps {
  open: boolean;
  subscriber: SubscriberItem | null | undefined;
  clientName: string;
  courses: Course[];
  paidTotals: PaidTotals;
  remainingEGP: number;
  settlementLabel: string;
  bookingMap: BookingMap;
  confirmedHistory: PaymentHistoryEntry[];
  onClose: () => void;
}

export const UnifiedClientPaymentDetailModal: React.FC<UnifiedClientPaymentDetailModalProps> = ({
  open,
  subscriber,
  clientName,
  courses,
  paidTotals,
  remainingEGP,
  settlementLabel,
  bookingMap,
  confirmedHistory,
  onClose,
}) => {
  if (!open || !subscriber) return null;

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
            {paidTotals.EGP > 0 && (
              <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100">
                <p className="font-extrabold text-emerald-700 text-base">{paidTotals.EGP.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ج.م</p>
              </div>
            )}
            {remainingEGP > 0 && (
              <div className="bg-red-50 rounded-xl p-3 border border-red-100">
                <p className="font-extrabold text-red-600 text-base">{remainingEGP.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">متبقي {settlementLabel}</p>
              </div>
            )}
            {paidTotals.SAR > 0 && (
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <p className="font-extrabold text-blue-700 text-base">{paidTotals.SAR.toLocaleString()}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">مدفوع ر.س</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wider">تفاصيل كل كورس</p>
            {subscriber.enrolledCourseIds.map(courseId => {
              const course = courses.find(c => c.id === courseId);
              const booking = bookingMap[courseId];
              const remaining = booking?.expectedEGP != null ? Math.max(0, booking.expectedEGP - booking.paidEGP) : null;
              return (
                <div key={courseId} className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                  <p className="font-bold text-gray-800 text-sm mb-2">{course?.title || courseId}</p>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {booking?.expectedEGP != null && (
                      <div>
                        <p className="text-gray-400">السعر</p>
                        <p className="font-bold text-gray-700">{booking.expectedEGP.toLocaleString()} {settlementLabel}</p>
                      </div>
                    )}
                    {booking && (
                      <div>
                        <p className="text-gray-400">مدفوع</p>
                        <p className="font-bold text-emerald-700">{booking.paidEGP.toLocaleString()} {settlementLabel}</p>
                      </div>
                    )}
                    {remaining !== null && (
                      <div>
                        <p className="text-gray-400">متبقي</p>
                        <p className={`font-bold ${remaining > 0 ? 'text-red-600' : 'text-green-600'}`}>{remaining > 0 ? remaining.toLocaleString() : 'مكتمل'}</p>
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
              {confirmedHistory.slice().reverse().map((payment, index) => (
                <div key={`${payment.id || index}-${index}`} className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-3 py-2.5">
                  <div>
                    <p className="text-xs font-bold text-gray-800">{payment.amount.toLocaleString()} {payment.currency === 'SAR' ? 'ر.س' : payment.currency === 'USD' ? '$' : 'ج.م'}</p>
                    {payment.note && <p className="text-[11px] text-gray-400 mt-0.5">{payment.note}</p>}
                  </div>
                  <p className="text-[11px] text-gray-400">{payment.at || ''}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
