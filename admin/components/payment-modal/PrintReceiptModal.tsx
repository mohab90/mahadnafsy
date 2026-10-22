// The receipt the payment dialog prints after a payment is recorded.
import React from 'react';
import { X } from 'lucide-react';

// ── PrintReceipt sub-component ─────────────────────────────────────────────
export interface PrintData {
  subName: string; phone?: string;
  courseName: string;
  items: { label: string; amount: number; currency: string }[];
  total: number; currency: string;
  method: string; date: string; note?: string;
  bookingType: string;
  courseExpected: number;
  prevPaid: number; remaining: number;
  staffName: string;
  transactionId?: string;
  instituteName: string;
  branchLabel?: string;
  /** The branch's receipt number, «57» or «57–59» (api/lib/receiptNumbers.js); only Dokki and Tagamoa number them. */
  receiptNo?: string;
}

export const PrintReceiptModal: React.FC<{ data: PrintData; onClose: () => void }> = ({ data, onClose }) => (
  <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[320px]" dir="rtl" onClick={e => e.stopPropagation()}>
      <div className="bg-gray-800 text-white rounded-t-2xl px-4 py-3 flex items-center justify-between">
        <span className="font-bold text-sm">وصل دفعة{data.branchLabel ? ` — ${data.branchLabel}` : ''}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="px-3 py-1.5 bg-white text-gray-800 rounded-lg text-xs font-bold hover:bg-gray-100 transition">🖨️ طباعة</button>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition"><X size={14} /></button>
        </div>
      </div>
      <div id="payModalPrintReceipt" className="p-4 font-mono text-[11px] leading-relaxed" style={{ width: '80mm', boxSizing: 'border-box', fontFamily: 'monospace' }}>
        <div className="text-center mb-1">
          <div className="font-extrabold text-[13px]">{data.instituteName}</div>
          {data.branchLabel && <div className="text-[11px]">{data.branchLabel}</div>}
          {data.receiptNo && <div className="mt-0.5 text-[12px] font-extrabold">إيصال رقم {data.receiptNo}</div>}
          <div className="text-[10px] text-gray-500">{data.date}</div>
        </div>
        <div className="border-t border-dashed border-gray-400 my-1.5" />
        <div className="space-y-0.5">
          <div className="flex justify-between"><span className="text-gray-600">الاسم:</span><span className="font-bold text-right flex-1 mr-1">{data.subName}</span></div>
          {data.phone && <div className="flex justify-between"><span className="text-gray-600">الهاتف:</span><span className="font-bold">{data.phone}</span></div>}
          <div className="flex justify-between"><span className="text-gray-600">الكورس:</span><span className="font-bold text-right flex-1 mr-1">{data.courseName}</span></div>
          <div className="flex justify-between">
            <span className="text-gray-600">نوع الدفع:</span>
            <span className={`font-bold ${data.bookingType === 'new_booking' ? 'text-green-700' : 'text-blue-700'}`}>
              {data.bookingType === 'new_booking' ? '◆ حجز جديد' : '◈ قسط'}
            </span>
          </div>
        </div>
        <div className="border-t border-dashed border-gray-400 my-1.5" />
        <div className="space-y-0.5">
          {data.items.map((item, i) => (
            <div key={i} className="flex justify-between">
              <span className="text-gray-600 truncate flex-1 ml-1">{item.label}</span>
              <span className="font-bold whitespace-nowrap">{item.amount.toLocaleString('ar-EG-u-nu-latn')} {item.currency}</span>
            </div>
          ))}
          {data.items.length > 1 && (
            <div className="flex justify-between font-extrabold border-t border-dashed border-gray-300 pt-0.5 mt-0.5">
              <span>المدفوع الآن:</span>
              <span>{data.total.toLocaleString('ar-EG-u-nu-latn')} {data.currency}</span>
            </div>
          )}
        </div>
        <div className="border-t border-dashed border-gray-400 my-1.5" />
        <div className="space-y-0.5">
          {data.courseExpected > 0 && <div className="flex justify-between"><span className="text-gray-600">إجمالي الكورس:</span><span className="font-bold">{data.courseExpected.toLocaleString('ar-EG-u-nu-latn')} {data.currency}</span></div>}
          {data.prevPaid > 0 && <div className="flex justify-between"><span className="text-gray-600">مدفوع سابقاً:</span><span className="font-bold">{data.prevPaid.toLocaleString('ar-EG-u-nu-latn')} {data.currency}</span></div>}
          <div className="flex justify-between font-extrabold text-[12px]">
            <span>المدفوع الآن:</span><span>{data.total.toLocaleString('ar-EG-u-nu-latn')} {data.currency}</span>
          </div>
          {data.courseExpected > 0 && (
            <div className={`flex justify-between font-bold ${data.remaining === 0 ? 'text-green-700' : 'text-red-600'}`}>
              <span>المتبقي:</span>
              <span>{data.remaining === 0 ? '✓ مكتمل' : `${data.remaining.toLocaleString('ar-EG-u-nu-latn')} ${data.currency}`}</span>
            </div>
          )}
        </div>
        <div className="border-t border-dashed border-gray-400 my-1.5" />
        <div className="space-y-0.5">
          <div className="flex justify-between"><span className="text-gray-600">وسيلة الدفع:</span><span className="font-bold">{data.method}</span></div>
          {data.transactionId && <div className="flex justify-between"><span className="text-gray-600">رقم العملية:</span><span className="font-bold">{data.transactionId}</span></div>}
          {data.note && <div className="flex justify-between"><span className="text-gray-600">ملاحظة:</span><span className="font-bold">{data.note}</span></div>}
          <div className="flex justify-between"><span className="text-gray-600">بواسطة:</span><span className="font-bold">{data.staffName}</span></div>
        </div>
        <div className="border-t border-dashed border-gray-400 my-1.5" />
        <div className="text-center text-[10px] text-gray-500 space-y-0.5">
          <div className="font-bold text-gray-700">{data.instituteName}</div>
          <div>🌐 mahadnafsy.com</div>
          <div className="mt-1">شكراً لثقتكم — نتمنى لكم رحلة نفسية سليمة 🌿</div>
        </div>
      </div>
    </div>
    {/* Hidden by visibility, not display.
      *
      * This rule was `body > *:not(#payModalPrintReceipt) { display: none }`,
      * and the receipt is not a child of body — the modal renders inside the
      * React tree, so it sits under div#root. The rule therefore matched
      * #root, set it to display:none, and took the receipt down with it: every
      * printed receipt was a blank page. Nothing on screen showed it, because
      * the rule only applies to print.
      *
      * display:none on an ancestor cannot be undone by a descendant.
      * visibility:hidden can, which is why this shape survives being nested at
      * any depth. Kept out of the template literal so the explanation stays in
      * the source instead of shipping to every browser. */}
    <style>{`
      @media print {
        body * { visibility: hidden !important; }
        #payModalPrintReceipt, #payModalPrintReceipt * { visibility: visible !important; }
        #payModalPrintReceipt {
          position: absolute !important; top: 0 !important; right: 0 !important; left: auto !important;
          display: block !important; width: 80mm !important; max-width: 80mm !important;
          margin: 0 !important; padding: 3mm !important; font-size: 10px !important;
          font-family: monospace !important; line-height: 1.4 !important; color: #000 !important;
        }
        @page { margin: 0; }
      }
    `}</style>
  </div>
);
