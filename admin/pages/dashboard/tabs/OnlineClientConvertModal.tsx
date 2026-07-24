import { X } from 'lucide-react';
import type { SubscriberItem } from '../../../types';

export type OnlineClientConvertType = 'finished' | 'paused' | 'refunded' | 'daqqi' | 'leads' | 'online' | '';

type OnlineClientConvertModalProps = {
  row: SubscriberItem;
  convertType: OnlineClientConvertType;
  setConvertType: (value: OnlineClientConvertType) => void;
  attendedLive: boolean;
  setAttendedLive: (value: boolean) => void;
  gotCert: boolean;
  setGotCert: (value: boolean) => void;
  pauseReason: string;
  setPauseReason: (value: string) => void;
  refundReason: string;
  setRefundReason: (value: string) => void;
  refundAmount: string;
  setRefundAmount: (value: string) => void;
  refundMethod: string;
  setRefundMethod: (value: string) => void;
  saving: boolean;
  isDaqqiClientsTab: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export function OnlineClientConvertModal({
  row,
  convertType,
  setConvertType,
  attendedLive,
  setAttendedLive,
  gotCert,
  setGotCert,
  pauseReason,
  setPauseReason,
  refundReason,
  setRefundReason,
  refundAmount,
  setRefundAmount,
  refundMethod,
  setRefundMethod,
  saving,
  isDaqqiClientsTab,
  onClose,
  onConfirm,
}: OnlineClientConvertModalProps) {
  const disabled = saving
    || (convertType === 'paused' && !pauseReason.trim())
    || (convertType === 'refunded' && !refundReason.trim())
    || convertType === '';

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" dir="rtl" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-orange-50">
          <div>
            <h3 className="font-extrabold text-gray-900">🔄 تحويل العميل</h3>
            <p className="text-xs text-gray-500 mt-0.5">{row.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="p-5">
          {!convertType ? (
            <div className="space-y-2">
              <p className="text-sm font-bold text-gray-700 mb-3">اختر نوع التحويل:</p>
              {([
                { key: 'finished' as const, label: '✅ منتهي', cls: 'bg-green-50 border-green-200 text-green-700 hover:bg-green-100' },
                { key: 'paused' as const, label: '⏸ متوقف', cls: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' },
                { key: 'refunded' as const, label: '↩️ استرداد', cls: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' },
                { key: 'leads' as const, label: '👥 عملاء محتملين', cls: 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100' },
                isDaqqiClientsTab
                  ? { key: 'online' as const, label: '🌐 تحويل لأونلاين', cls: 'bg-teal-50 border-teal-200 text-teal-700 hover:bg-teal-100' }
                  : { key: 'daqqi' as const, label: '🏢 فرع الدقي', cls: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' },
              ] as { key: Exclude<OnlineClientConvertType, ''>; label: string; cls: string }[]).map(option => (
                <button key={option.key} onClick={() => setConvertType(option.key)}
                  className={`w-full border rounded-xl px-4 py-2.5 text-sm font-bold transition ${option.cls}`}>
                  {option.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {convertType === 'finished' && (
                <>
                  <p className="text-sm font-bold text-gray-700 mb-1">هل حضر العميل اللايف؟</p>
                  <div className="flex gap-2">
                    <button onClick={() => setAttendedLive(true)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${attendedLive ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 hover:bg-gray-50'}`}>✅ نعم</button>
                    <button onClick={() => setAttendedLive(false)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${!attendedLive ? 'bg-gray-600 text-white border-gray-600' : 'border-gray-200 hover:bg-gray-50'}`}>❌ لا</button>
                  </div>
                  <p className="text-sm font-bold text-gray-700 mb-1">هل استلم العميل شهادته؟</p>
                  <div className="flex gap-2">
                    <button onClick={() => setGotCert(true)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${gotCert ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 hover:bg-gray-50'}`}>✅ نعم</button>
                    <button onClick={() => setGotCert(false)} className={`flex-1 border rounded-xl px-3 py-2 text-sm font-bold transition ${!gotCert ? 'bg-gray-600 text-white border-gray-600' : 'border-gray-200 hover:bg-gray-50'}`}>❌ لا</button>
                  </div>
                </>
              )}
              {convertType === 'paused' && (
                <>
                  <label className="block text-sm font-bold text-gray-700 mb-1">سبب التوقف:</label>
                  <textarea value={pauseReason} onChange={event => setPauseReason(event.target.value)}
                    rows={3} placeholder="اكتب سبب التوقف..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 resize-none" />
                </>
              )}
              {convertType === 'refunded' && (
                <>
                  <label className="block text-sm font-bold text-gray-700 mb-1">سبب الاسترداد: <span className="text-red-500">*</span></label>
                  <textarea value={refundReason} onChange={event => setRefundReason(event.target.value)}
                    rows={3} placeholder="اكتب سبب الاسترداد..."
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 resize-none" />
                  <label className="block text-sm font-bold text-gray-700 mb-1 mt-2">المبلغ المطلوب للاسترداد (ج.م):</label>
                  <input type="number" min="0" value={refundAmount} onChange={event => setRefundAmount(event.target.value)}
                    placeholder="0"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200" />
                  <label className="block text-sm font-bold text-gray-700 mb-1 mt-2">طريقة تحويل الاسترداد:</label>
                  <select value={refundMethod} onChange={event => setRefundMethod(event.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 bg-white">
                    <option value="">اختر الطريقة (اختياري)</option>
                    <option value="bank">تحويل بنكي</option>
                    <option value="vodafone">فودافون كاش</option>
                    <option value="instapay">إنستاباي</option>
                    <option value="cash">كاش</option>
                    <option value="other">أخرى</option>
                  </select>
                </>
              )}
              {convertType === 'leads' && (
                <p className="text-sm text-gray-600 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                  سيتم نقل هذا العميل بشكل مباشر إلى صفحة العملاء المحتملين وحذفه من عملاء الأونلاين. هل أنت متأكد؟
                </p>
              )}
              {convertType === 'daqqi' && (
                <p className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  سيتم تحويل هذا العميل إلى فرع الدقي. هل أنت متأكد؟
                </p>
              )}
              {convertType === 'online' && (
                <p className="text-sm text-gray-600 bg-teal-50 border border-teal-200 rounded-xl px-3 py-2">
                  سيتم تحويل هذا العميل من فرع الدقي إلى الأونلاين. هل أنت متأكد؟
                </p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <button onClick={() => setConvertType('')} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm hover:bg-gray-50">رجوع</button>
                <button disabled={disabled} onClick={onConfirm}
                  className="flex-1 bg-orange-600 text-white rounded-xl px-3 py-2 text-sm font-bold hover:bg-orange-700 disabled:opacity-50 transition">
                  {saving ? '⏳...' : '✅ تأكيد التحويل'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
