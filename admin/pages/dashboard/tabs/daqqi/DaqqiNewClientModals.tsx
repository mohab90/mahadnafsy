import React from 'react';
import { UserPlus, X } from 'lucide-react';
import type { Bundle, Course, PaymentItemType } from '../../../../types';

export interface DaqqiNewClientDraft {
  name: string;
  phone: string;
  email: string;
  courseIds: string[];
  paymentType: PaymentItemType;
  courseExpected: string;
  amount: string;
  currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string;
  transactionId: string;
  date: string;
  note: string;
  bookingType: 'new_booking' | 'installment';
}

export interface DaqqiNewClientReceipt {
  name: string;
  phone: string;
  courses: string[];
  amount: number;
  currency: string;
  method: string;
  bookingType: string;
  date: string;
}

interface NewClientModalProps {
  open: boolean;
  content: Record<string, string>;
  courses: Course[];
  bundles: Bundle[];
  draft: DaqqiNewClientDraft;
  setDraft: React.Dispatch<React.SetStateAction<DaqqiNewClientDraft>>;
  onClose: () => void;
  onSubmit: () => void;
}

export function DaqqiNewClientModal({
  open,
  content,
  courses,
  bundles,
  draft,
  setDraft,
  onClose,
  onSubmit,
}: NewClientModalProps) {
  if (!open) return null;

  const paymentMethods = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map((item) => item.trim()).filter(Boolean)
    : ['خزنة الدقي', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'أونلاين', 'أخرى'];
  const hasPayment = !!draft.amount && Number(draft.amount) > 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] overflow-auto" dir="rtl" onClick={(event) => event.stopPropagation()}>
        <div className="sticky top-0 bg-gradient-to-l from-red-700 to-red-500 rounded-t-3xl sm:rounded-t-2xl px-5 pt-5 pb-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                <UserPlus size={18} className="text-white" />
              </div>
              <div>
                <h4 className="font-extrabold text-white text-base">إضافة عميل جديد</h4>
                <p className="text-red-100 text-[11px]">فرع الدقي</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition"><X size={16} /></button>
          </div>
        </div>

        <div className="px-5 py-5 space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-blue-100 flex items-center justify-center text-sm">👤</div>
              <p className="text-xs font-extrabold text-gray-700 tracking-wide uppercase">بيانات العميل</p>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">الاسم الكامل <span className="text-red-500">*</span></label>
                <input type="text" placeholder="الاسم الكامل" value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  className={`w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:outline-none transition ${draft.name.trim() ? 'border-green-300 focus:border-green-400' : 'border-gray-200 focus:border-blue-400'}`}
                  autoFocus />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">رقم الهاتف <span className="text-red-500">*</span></label>
                <input type="tel" placeholder="01xxxxxxxxx" value={draft.phone}
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                  className={`w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:outline-none transition ${draft.phone.trim() ? 'border-green-300 focus:border-green-400' : 'border-gray-200 focus:border-blue-400'}`} />
              </div>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">البريد الإلكتروني <span className="text-gray-400 font-normal">(اختياري)</span></label>
              <input type="email" placeholder="example@mail.com" value={draft.email}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-blue-400 focus:outline-none" />
            </div>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center text-sm">📚</div>
              <p className="text-xs font-extrabold text-gray-700 tracking-wide uppercase">الكورسات</p>
              <span className="text-[10px] text-gray-400 font-medium">(يمكن اختيار أكثر من كورس)</span>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-auto pr-1">
              {bundles.map((bundle) => {
                const bundleKey = `bundle:${bundle.id}`;
                const checked = draft.courseIds.includes(bundleKey);
                return (
                  <label key={bundleKey} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 text-xs cursor-pointer transition ${checked ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-200'}`}>
                    <input type="checkbox" checked={checked}
                      onChange={(event) => setDraft({ ...draft, courseIds: event.target.checked ? [...draft.courseIds, bundleKey] : draft.courseIds.filter((id) => id !== bundleKey) })}
                      className="w-3.5 h-3.5 rounded accent-purple-600 flex-shrink-0" />
                    <span className="font-medium text-gray-700">📌 {bundle.title}</span>
                    {bundle.price?.EGP && <span className="text-gray-400 mr-auto font-normal">{Number(bundle.price.EGP).toLocaleString()} ج</span>}
                  </label>
                );
              })}
              {courses.map((course) => {
                const checked = draft.courseIds.includes(course.id);
                return (
                  <label key={course.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 text-xs cursor-pointer transition ${checked ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-purple-200'}`}>
                    <input type="checkbox" checked={checked}
                      onChange={(event) => setDraft({ ...draft, courseIds: event.target.checked ? [...draft.courseIds, course.id] : draft.courseIds.filter((id) => id !== course.id) })}
                      className="w-3.5 h-3.5 rounded accent-purple-600 flex-shrink-0" />
                    <span className="font-medium text-gray-700">{course.titleAr || course.title}</span>
                    {course.price?.EGP && <span className="text-gray-400 mr-auto font-normal">{Number(course.price.EGP).toLocaleString()} ج</span>}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="border-t border-gray-100 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-green-100 flex items-center justify-center text-sm">💰</div>
              <p className="text-xs font-extrabold text-gray-700 tracking-wide uppercase">الدفع الأولي</p>
              <span className="text-[10px] text-gray-400 font-medium">(اختياري)</span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 space-y-3">
              <div className="space-y-1.5 pb-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-gray-400 font-semibold whitespace-nowrap">نوع الحجز:</span>
                  {[{ value: 'new_booking', icon: '🆕', label: 'حجز جديد' }, { value: 'installment', icon: '💳', label: 'قسط' }].map((bookingType) => (
                    <button key={bookingType.value} type="button"
                      onClick={() => setDraft({ ...draft, bookingType: bookingType.value as DaqqiNewClientDraft['bookingType'] })}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition ${draft.bookingType === bookingType.value ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-red-300 hover:text-red-600'}`}>
                      <span>{bookingType.icon}</span>{bookingType.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-gray-400 font-semibold whitespace-nowrap">النوع:</span>
                  {[{ value: 'course', icon: '🎓', label: 'كورس' }, { value: 'certificate', icon: '🏅', label: 'شهادة' }, { value: 'consultation', icon: '💬', label: 'استشارة' }, { value: 'book', icon: '📚', label: 'كتاب' }, { value: 'carneh', icon: '🗂️', label: 'كارنيه' }, { value: 'other', icon: '📦', label: 'أخرى' }].map((paymentType) => (
                    <button key={paymentType.value} type="button"
                      onClick={() => setDraft({ ...draft, paymentType: paymentType.value as PaymentItemType })}
                      className={`flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-bold border transition ${draft.paymentType === paymentType.value ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600'}`}>
                      {paymentType.icon} {paymentType.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">المبلغ المدفوع</label>
                  <input type="number" min="0" placeholder="0.00" value={draft.amount}
                    onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-base font-bold focus:border-green-400 focus:outline-none bg-white" />
                </div>
                <div className="w-28">
                  <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">العملة</label>
                  <select value={draft.currency}
                    onChange={(event) => setDraft({ ...draft, currency: event.target.value as DaqqiNewClientDraft['currency'] })}
                    className="w-full border-2 border-gray-200 rounded-xl px-2 py-2.5 text-sm focus:border-green-400 focus:outline-none bg-white font-bold">
                    <option value="EGP">🇪🇬 ج.م</option>
                    <option value="SAR">🇸🇦 ر.س</option>
                    <option value="USD">🇺🇸 $</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">وسيلة الدفع</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {paymentMethods.map((method) => (
                    <button key={method} type="button"
                      onClick={() => setDraft({ ...draft, paymentMethod: method })}
                      className={`py-2 px-1 rounded-xl border-2 text-[11px] font-bold text-center transition ${draft.paymentMethod === method ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200 text-gray-600 hover:border-gray-300 bg-white'}`}>
                      {method}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">رقم العملية</label>
                  <input type="text" placeholder="اختياري" value={draft.transactionId}
                    onChange={(event) => setDraft({ ...draft, transactionId: event.target.value })}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-400 focus:outline-none bg-white" />
                </div>
                <div>
                  <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">التاريخ</label>
                  <input type="date" value={draft.date}
                    onChange={(event) => setDraft({ ...draft, date: event.target.value })}
                    className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-400 focus:outline-none bg-white" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">ملاحظة</label>
                <input type="text" placeholder="اكتب أي ملاحظة..." value={draft.note}
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-green-400 focus:outline-none bg-white" />
              </div>
            </div>
          </div>

          {draft.name.trim() && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs">
              <p className="font-bold text-blue-800 mb-1">ملخص الإضافة</p>
              <div className="text-blue-700 space-y-0.5">
                <div>👤 {draft.name.trim()}{draft.phone && ` — ${draft.phone}`}</div>
                {draft.courseIds.map((courseId) => {
                  if (courseId.startsWith('bundle:')) {
                    const bundle = bundles.find((item) => item.id === courseId.replace('bundle:', ''));
                    return <div key={courseId}>📌 {bundle?.title || courseId}</div>;
                  }
                  const course = courses.find((item) => item.id === courseId);
                  return <div key={courseId}>📚 {course?.titleAr || course?.title || courseId}</div>;
                })}
                {hasPayment && <div>💰 {Number(draft.amount).toLocaleString()} {draft.currency}{draft.paymentMethod && ` عبر ${draft.paymentMethod}`}</div>}
              </div>
            </div>
          )}

          <div className="flex gap-3 pb-2">
            <button onClick={onSubmit}
              disabled={!draft.name.trim() || !draft.phone.trim()}
              className="flex-1 py-3.5 bg-gradient-to-l from-red-700 to-red-500 text-white rounded-2xl text-sm font-extrabold hover:from-red-800 hover:to-red-600 disabled:opacity-40 transition-all shadow-sm flex items-center justify-center gap-2">
              <UserPlus size={16} /> إضافة العميل
            </button>
            <button onClick={onClose}
              className="px-5 py-3.5 bg-gray-100 text-gray-700 rounded-2xl text-sm font-bold hover:bg-gray-200 transition">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ReceiptModalProps {
  receipt: DaqqiNewClientReceipt | null;
  onClose: () => void;
}

export function DaqqiNewClientReceiptModal({ receipt, onClose }: ReceiptModalProps) {
  if (!receipt) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4 print:hidden" onClick={onClose}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs" dir="rtl" onClick={(event) => event.stopPropagation()}>
          <div className="bg-gray-800 text-white rounded-t-2xl px-4 py-3 flex items-center justify-between">
            <span className="font-bold text-sm">طباعة الوصل</span>
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="px-3 py-1.5 bg-white text-gray-800 rounded-lg text-xs font-bold hover:bg-gray-100 transition">🖨️ طباعة</button>
              <button onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition"><X size={14} /></button>
            </div>
          </div>
          <div id="daqqiPrintReceipt" className="p-5 font-mono text-xs text-center space-y-2">
            <div className="font-extrabold text-base">مهاد نفسي — الدقي</div>
            <div className="text-gray-500 text-[11px]">{receipt.date}</div>
            <div className="border-t border-dashed border-gray-300 my-2" />
            <div className="text-right space-y-1">
              <div><span className="text-gray-500">الاسم: </span><span className="font-bold">{receipt.name}</span></div>
              <div><span className="text-gray-500">الهاتف: </span><span className="font-bold">{receipt.phone}</span></div>
            </div>
            {receipt.courses.length > 0 && <>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="text-right">
                <div className="text-gray-500 mb-1">الكورسات:</div>
                {receipt.courses.map((course, index) => <div key={index} className="font-bold">• {course}</div>)}
              </div>
            </>}
            <div className="border-t border-dashed border-gray-300 my-2" />
            <div className="text-right space-y-1">
              <div><span className="text-gray-500">المدفوع: </span><span className="font-extrabold text-lg">{receipt.amount.toLocaleString()}</span> <span className="text-gray-500">{receipt.currency}</span></div>
              <div><span className="text-gray-500">الوسيلة: </span><span className="font-bold">{receipt.method}</span></div>
              <div><span className="text-gray-500">النوع: </span><span className="font-bold">{receipt.bookingType === 'new_booking' ? 'حجز جديد' : 'قسط'}</span></div>
            </div>
            <div className="border-t border-dashed border-gray-300 my-2" />
            <div className="text-gray-400 text-[10px]">شكراً لثقتكم 🌿</div>
          </div>
        </div>
      </div>
      <style>{`
        @media print {
          body > *:not(#daqqiPrintReceipt) { display: none !important; }
          #daqqiPrintReceipt {
            display: block !important;
            width: 80mm !important;
            max-width: 80mm !important;
            margin: 0 !important;
            padding: 3mm !important;
            font-size: 10px !important;
            font-family: monospace !important;
            line-height: 1.4 !important;
            color: #000 !important;
          }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </>
  );
}
