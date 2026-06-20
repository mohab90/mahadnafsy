import React from 'react';
import { X } from 'lucide-react';
import { useSiteData } from '../../../../context/SiteDataContext';

export type DaqqiPayPrintData = {
  subName: string; phone: string;
  courseName: string;
  items: Array<{ label: string; amount: number; currency: string }>;
  total: number; currency: string; method: string; date: string;
  note?: string; bookingType: string;
  courseExpected: number;
  prevPaid: number;
  remaining: number;
  staffName: string;
  transactionId?: string;
};

interface Props {
  data: DaqqiPayPrintData | null;
  onClose: () => void;
}

export function DaqqiPayReceiptModal({ data, onClose }: Props) {
  const { content } = useSiteData();
  if (!data) return null;
  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 print:hidden" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[320px]" dir="rtl" onClick={e => e.stopPropagation()}>
        <div className="bg-gray-800 text-white rounded-t-2xl px-4 py-3 flex items-center justify-between">
          <span className="font-bold text-sm">وصل دفعة — فرع الدقي</span>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="px-3 py-1.5 bg-white text-gray-800 rounded-lg text-xs font-bold hover:bg-gray-100 transition">🖨️ طباعة</button>
            <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition"><X size={14} /></button>
          </div>
        </div>
        <div id="daqqiPrintReceipt" className="p-4 font-mono text-[11px] leading-relaxed" style={{width:'80mm', boxSizing:'border-box', fontFamily:'monospace'}}>
          <div className="text-center mb-1">
            <div className="font-extrabold text-[13px]">معهد الدراسات النفسية</div>
            <div className="text-[11px]">فرع الدقي</div>
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
                <span className="font-bold whitespace-nowrap">{item.amount.toLocaleString()} {item.currency}</span>
              </div>
            ))}
            {data.items.length > 1 && (
              <div className="flex justify-between font-extrabold border-t border-dashed border-gray-300 pt-0.5 mt-0.5">
                <span>المدفوع الآن:</span>
                <span>{data.total.toLocaleString()} {data.currency}</span>
              </div>
            )}
          </div>
          <div className="border-t border-dashed border-gray-400 my-1.5" />
          <div className="space-y-0.5">
            {data.courseExpected > 0 && (
              <div className="flex justify-between"><span className="text-gray-600">إجمالي الكورس:</span><span className="font-bold">{data.courseExpected.toLocaleString()} {data.currency}</span></div>
            )}
            {data.prevPaid > 0 && (
              <div className="flex justify-between"><span className="text-gray-600">مدفوع سابقاً:</span><span className="font-bold">{data.prevPaid.toLocaleString()} {data.currency}</span></div>
            )}
            <div className="flex justify-between font-extrabold text-[12px]">
              <span>المدفوع الآن:</span>
              <span>{data.total.toLocaleString()} {data.currency}</span>
            </div>
            {data.courseExpected > 0 && (
              <div className={`flex justify-between font-bold ${data.remaining === 0 ? 'text-green-700' : 'text-red-600'}`}>
                <span>المتبقي:</span>
                <span>{data.remaining === 0 ? '✓ مكتمل' : `${data.remaining.toLocaleString()} ${data.currency}`}</span>
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
            <div className="font-bold text-gray-700">معهد الدراسات النفسية</div>
            {content['footer.address'] && <div>{content['footer.address']}</div>}
            {content['footer.phone'] && <div>📞 {content['footer.phone']}</div>}
            {content['footer.whatsapp'] && <div>WhatsApp: {content['footer.whatsapp']}</div>}
            <div>🌐 mahadnafsy.com</div>
            <div className="mt-1">شكراً لثقتكم — نتمنى لكم رحلة نفسية سليمة 🌿</div>
          </div>
        </div>
      </div>
    </div>
  );
}
