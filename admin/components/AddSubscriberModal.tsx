/**
 * AddSubscriberModal — unified add-client modal used system-wide.
 * mode='daqqi'   → branch fixed to 'daqqi', red gradient
 * mode='online'  → branch selectable, optional account credentials
 * mode='general' → branch selectable, minimal fields
 */
import React, { useState } from 'react';
import { UserPlus, X, Printer } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import type { PaymentHistoryEntry, PaymentItemType } from '../types';

type Mode = 'daqqi' | 'online' | 'general';

interface Draft {
  name: string;
  phone: string;
  email: string;
  branch: string;
  password: string;
  courseIds: string[];
  courseExpected: string;
  paymentType: PaymentItemType;
  bookingType: 'new_booking' | 'installment';
  amount: string;
  currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string;
  transactionId: string;
  date: string;
  note: string;
  referredBy: string;
}

const blank = (mode: Mode): Draft => ({
  name: '', phone: '', email: '',
  branch: mode === 'daqqi' ? 'daqqi' : mode === 'online' ? 'online_egypt' : '',
  password: '',
  courseIds: [],
  courseExpected: '',
  paymentType: 'course',
  bookingType: 'new_booking',
  amount: '', currency: 'EGP',
  paymentMethod: '', transactionId: '',
  date: new Date().toISOString().slice(0, 10),
  note: '', referredBy: '',
});

const BRANCHES: { id: string; label: string }[] = [
  { id: 'daqqi',         label: 'فرع الدقي' },
  { id: 'tagamoa',       label: 'فرع التجمع' },
  { id: 'online_egypt',  label: 'أونلاين محلي (مصر)' },
  { id: 'online_saudi',  label: 'أونلاين سعودي' },
  { id: 'online_abroad', label: 'أونلاين دولي' },
  { id: 'other',         label: 'أخرى' },
];

const PAY_TYPES: { v: PaymentItemType; ic: string; lb: string }[] = [
  { v: 'course', ic: '🎓', lb: 'كورس' },
  { v: 'certificate', ic: '🏅', lb: 'شهادة' },
  { v: 'consultation', ic: '💬', lb: 'استشارة' },
  { v: 'book', ic: '📚', lb: 'كتاب' },
  { v: 'carneh', ic: '🗂️', lb: 'كارنيه' },
  { v: 'other', ic: '📦', lb: 'أخرى' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  mode?: Mode;
  /** Called with new subscriber id after successful creation */
  onSuccess?: (subscriberId: string) => void;
  /** Optional override for branch default label */
  branchLabel?: string;
}

type PrintData = {
  name: string; phone: string; courses: string[];
  amount: number; currency: string; method: string; bookingType: string; date: string;
} | null;

export default function AddSubscriberModal({
  isOpen, onClose, notify, mode = 'general', onSuccess, branchLabel,
}: Props) {
  const { addSubscriber, courses, bundles, content } = useSiteData();
  const [draft, setDraft] = useState<Draft>(() => blank(mode));
  const [saving, setSaving] = useState(false);
  const [printData, setPrintData] = useState<PrintData>(null);

  const pmList: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map((s: string) => s.trim()).filter(Boolean)
    : ['خزنة الدقي', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'بطاقة ائتمان', 'أخرى'];

  const set = (partial: Partial<Draft>) => setDraft(d => ({ ...d, ...partial }));

  const headerGradient =
    mode === 'daqqi'  ? 'from-red-700 to-red-500' :
    mode === 'online' ? 'from-indigo-700 to-indigo-500' :
                        'from-slate-700 to-slate-500';

  const accentBorder =
    mode === 'daqqi'  ? 'border-red-200 focus:border-red-400 focus:ring-red-100' :
    mode === 'online' ? 'border-indigo-200 focus:border-indigo-400 focus:ring-indigo-100' :
                        'border-gray-200 focus:border-blue-400 focus:ring-blue-100';

  const modeLabel =
    mode === 'daqqi'  ? 'فرع الدقي' :
    mode === 'online' ? 'أونلاين' :
                        '';

  const canSubmit = draft.name.trim().length > 0 && draft.phone.trim().length > 0 && !saving;
  const hasPayment = Number(draft.amount) > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);

    const courseAccessMap: Record<string, { mode: 'full' }> = {};
    draft.courseIds.forEach(cid => { courseAccessMap[cid] = { mode: 'full' }; });

    const newSub: Parameters<typeof addSubscriber>[0] = {
      id: `sub-${Date.now()}`,
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      branch: (draft.branch || (mode === 'daqqi' ? 'daqqi' : 'online_egypt')) as any,
      status: 'active',
      enrolledCourseIds: draft.courseIds,
      paymentHistory: [],
      courseAccess: courseAccessMap,
      createdAt: new Date().toISOString().slice(0, 10),
      clientCode: '',
      ...(draft.password.trim() ? { password: draft.password.trim() } : {}),
      ...(draft.referredBy.trim() ? { referredBy: draft.referredBy.trim() } : {}),
    };

    if (hasPayment) {
      const entry: PaymentHistoryEntry = {
        id: `pay-${Date.now()}`,
        amount: Number(draft.amount),
        currency: draft.currency,
        paymentType: draft.paymentType,
        isInstallment: draft.bookingType === 'installment',
        courseId: draft.paymentType === 'course' ? (draft.courseIds[0] || '') : undefined,
        courseExpected: Number(draft.courseExpected) || undefined,
        paymentMethod: draft.paymentMethod || undefined,
        note: [draft.note, draft.transactionId].filter(Boolean).join(' | ') || undefined,
        at: draft.date,
      };
      newSub.paymentHistory = [entry];
    }

    try {
      const ok = await addSubscriber(newSub as any);
      if (!ok) {
        notify('error', 'العميل موجود بالفعل (هاتف أو إيميل مكرر).');
        setSaving(false);
        return;
      }
    } catch (err) {
      notify('error', `فشل الإضافة: ${err instanceof Error ? err.message : String(err)}`);
      setSaving(false);
      return;
    }

    notify('success', `تم إضافة ${draft.name.trim()} بنجاح`);
    onSuccess?.(newSub.id as string);

    if (hasPayment) {
      const courseLabels = draft.courseIds.map(cid => {
        if (cid.startsWith('bundle:')) return bundles.find(b => b.id === cid.replace('bundle:', ''))?.title || cid;
        const c = courses.find(x => x.id === cid);
        return c?.titleAr || c?.title || cid;
      });
      setPrintData({ name: draft.name.trim(), phone: draft.phone.trim(), courses: courseLabels, amount: Number(draft.amount), currency: draft.currency, method: draft.paymentMethod || '—', bookingType: draft.bookingType, date: draft.date });
    }

    setDraft(blank(mode));
    setSaving(false);
    onClose();
  };

  if (!isOpen && !printData) return null;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={e => { if (e.target === e.currentTarget) { onClose(); setDraft(blank(mode)); } }}>
          <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] overflow-auto" dir="rtl"
            onClick={e => e.stopPropagation()}>

            {/* ── Header ── */}
            <div className={`sticky top-0 bg-gradient-to-l ${headerGradient} rounded-t-3xl sm:rounded-t-2xl px-5 pt-5 pb-4 z-10`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                    <UserPlus size={18} className="text-white" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-white text-base">إضافة عميل جديد</h4>
                    {(modeLabel || branchLabel) && (
                      <p className="text-white/70 text-[11px] mt-0.5">{branchLabel || modeLabel}</p>
                    )}
                  </div>
                </div>
                <button onClick={() => { onClose(); setDraft(blank(mode)); }}
                  className="p-2 rounded-xl bg-white/20 hover:bg-white/30 text-white transition">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="px-5 py-5 space-y-5">

              {/* ── 1. Client Info ── */}
              <section>
                <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">👤 بيانات العميل</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">الاسم الكامل <span className="text-red-500">*</span></label>
                    <input type="text" placeholder="اسم العميل" value={draft.name}
                      onChange={e => set({ name: e.target.value })} autoFocus
                      className={`w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 transition ${draft.name.trim() ? 'border-emerald-300 focus:border-emerald-400' : `${accentBorder}`}`} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">رقم الهاتف <span className="text-red-500">*</span></label>
                    <input type="tel" placeholder="01xxxxxxxxx" value={draft.phone}
                      onChange={e => set({ phone: e.target.value })} dir="ltr"
                      className={`w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 transition ${draft.phone.trim() ? 'border-emerald-300 focus:border-emerald-400' : `${accentBorder}`}`} />
                  </div>
                </div>
                <div className="mb-3">
                  <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">البريد الإلكتروني <span className="text-gray-400 font-normal">(اختياري)</span></label>
                  <input type="email" placeholder="email@example.com" value={draft.email}
                    onChange={e => set({ email: e.target.value })} dir="ltr"
                    className={`w-full border-2 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 ${accentBorder}`} />
                </div>

                {/* Branch selector for non-daqqi modes */}
                {mode !== 'daqqi' && (
                  <div className="mb-3">
                    <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">الفرع</label>
                    <select value={draft.branch} onChange={e => set({ branch: e.target.value })}
                      className={`w-full border-2 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-1 ${accentBorder}`}>
                      <option value="">— اختر الفرع —</option>
                      {BRANCHES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </div>
                )}

                {/* Online-specific: password + referral */}
                {mode === 'online' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">كلمة المرور <span className="text-gray-400 font-normal">(اختياري)</span></label>
                      <input type="text" placeholder="auto-generated if empty" value={draft.password}
                        onChange={e => set({ password: e.target.value })} dir="ltr"
                        className={`w-full border-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentBorder}`} />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">المُحيل <span className="text-gray-400 font-normal">(اختياري)</span></label>
                      <input type="text" placeholder="اسم المُحيل" value={draft.referredBy}
                        onChange={e => set({ referredBy: e.target.value })}
                        className={`w-full border-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentBorder}`} />
                    </div>
                  </div>
                )}
              </section>

              {/* ── 2. Courses ── */}
              <section className="border-t border-gray-100 pt-5">
                <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">📚 الكورسات <span className="font-normal normal-case text-gray-300">(اختياري)</span></p>
                <div className="space-y-1 max-h-44 overflow-y-auto pr-0.5">
                  {[
                    ...bundles.map(b => ({ id: `bundle:${b.id}`, label: `📌 ${b.titleAr || b.title}`, price: (b.price as any)?.EGP || 0 })),
                    ...courses.map(c => ({ id: c.id, label: `🎓 ${c.titleAr || c.title}`, price: c.price?.EGP || 0 })),
                  ].map(item => {
                    const sel = draft.courseIds.includes(item.id);
                    return (
                      <label key={item.id}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border-2 text-xs cursor-pointer transition ${sel ? 'border-purple-400 bg-purple-50' : 'border-gray-100 hover:border-purple-200 bg-white'}`}>
                        <input type="checkbox" checked={sel} className="w-3.5 h-3.5 accent-purple-600 flex-shrink-0"
                          onChange={e => set({ courseIds: e.target.checked ? [...draft.courseIds, item.id] : draft.courseIds.filter(x => x !== item.id) })} />
                        <span className="flex-1 font-medium text-gray-800">{item.label}</span>
                        {item.price > 0 && <span className="text-emerald-600 font-bold">{item.price.toLocaleString()} ج</span>}
                      </label>
                    );
                  })}
                </div>
                {draft.courseIds.length > 0 && (
                  <div className="mt-2">
                    <label className="text-[11px] text-gray-500 font-bold mb-1 block">المبلغ المتوقع الإجمالي</label>
                    <input type="number" min="0" placeholder="0 ج.م" value={draft.courseExpected}
                      onChange={e => set({ courseExpected: e.target.value })}
                      className={`w-full border-2 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 ${accentBorder}`} />
                  </div>
                )}
              </section>

              {/* ── 3. First Payment ── */}
              <section className="border-t border-gray-100 pt-5">
                <p className="text-[10px] font-extrabold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">💳 الدفعة الأولى <span className="font-normal normal-case text-gray-300">(اختياري)</span></p>
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
                  {/* Booking type */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-gray-500 font-bold">نوع الحجز:</span>
                    {[{ v: 'new_booking', ic: '🆕', lb: 'حجز جديد' }, { v: 'installment', ic: '💳', lb: 'قسط' }].map(bt => (
                      <button key={bt.v} type="button"
                        onClick={() => set({ bookingType: bt.v as Draft['bookingType'] })}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition ${draft.bookingType === bt.v ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-emerald-400'}`}>
                        <span>{bt.ic}</span>{bt.lb}
                      </button>
                    ))}
                  </div>
                  {/* Payment type */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-gray-500 font-bold">نوع:</span>
                    {PAY_TYPES.map(opt => (
                      <button key={opt.v} type="button"
                        onClick={() => set({ paymentType: opt.v })}
                        className={`flex items-center gap-0.5 px-2 py-0.5 rounded-md text-[11px] font-bold border transition ${draft.paymentType === opt.v ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-emerald-300'}`}>
                        {opt.ic} {opt.lb}
                      </button>
                    ))}
                  </div>
                  {/* Amount + currency */}
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[11px] text-gray-500 font-bold mb-1 block">المبلغ المدفوع</label>
                      <input type="number" min="0" placeholder="0.00" value={draft.amount}
                        onChange={e => set({ amount: e.target.value })}
                        className="w-full border-2 border-emerald-200 rounded-xl px-3 py-2.5 text-base font-bold focus:border-emerald-500 focus:outline-none bg-white" />
                    </div>
                    <div className="w-28">
                      <label className="text-[11px] text-gray-500 font-bold mb-1 block">العملة</label>
                      <select value={draft.currency} onChange={e => set({ currency: e.target.value as Draft['currency'] })}
                        className="w-full border-2 border-emerald-200 rounded-xl px-2 py-2.5 text-sm focus:border-emerald-500 focus:outline-none bg-white font-bold">
                        <option value="EGP">🇪🇬 ج.م</option>
                        <option value="SAR">🇸🇦 ر.س</option>
                        <option value="USD">🇺🇸 $</option>
                      </select>
                    </div>
                  </div>
                  {/* Payment method */}
                  <div>
                    <label className="text-[11px] text-gray-500 font-bold mb-1.5 block">طريقة الدفع</label>
                    <div className="flex flex-wrap gap-1.5">
                      {pmList.map(m => (
                        <button key={m} type="button" onClick={() => set({ paymentMethod: draft.paymentMethod === m ? '' : m })}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition ${draft.paymentMethod === m ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-100 bg-white'}`}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Transaction ID + Date */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-gray-500 font-bold mb-1 block">رقم الإيصال</label>
                      <input type="text" placeholder="اختياري" value={draft.transactionId}
                        onChange={e => set({ transactionId: e.target.value })}
                        className="w-full border-2 border-emerald-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none bg-white" />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500 font-bold mb-1 block">التاريخ</label>
                      <input type="date" value={draft.date} onChange={e => set({ date: e.target.value })}
                        className="w-full border-2 border-emerald-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none bg-white" />
                    </div>
                  </div>
                  {/* Note */}
                  <div>
                    <label className="text-[11px] text-gray-500 font-bold mb-1 block">ملاحظة</label>
                    <input type="text" placeholder="أي ملاحظة..." value={draft.note} onChange={e => set({ note: e.target.value })}
                      className="w-full border-2 border-emerald-200 rounded-xl px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none bg-white" />
                  </div>
                </div>
              </section>

              {/* ── Summary preview ── */}
              {draft.name.trim() && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs space-y-1">
                  <p className="font-bold text-slate-700 mb-1">ملخص</p>
                  <p className="text-slate-600">👤 {draft.name.trim()} — {draft.phone}</p>
                  {draft.courseIds.map(cid => {
                    if (cid.startsWith('bundle:')) { const b = bundles.find(bx => bx.id === cid.replace('bundle:', '')); return <p key={cid} className="text-slate-600">📌 {b?.title || cid}</p>; }
                    const c = courses.find(cx => cx.id === cid); return <p key={cid} className="text-slate-600">📚 {c?.titleAr || c?.title || cid}</p>;
                  })}
                  {hasPayment && <p className="text-emerald-700 font-bold">💰 {Number(draft.amount).toLocaleString()} {draft.currency}{draft.paymentMethod ? ` — ${draft.paymentMethod}` : ''}</p>}
                </div>
              )}

              {/* ── Actions ── */}
              <div className="flex gap-3 pb-2">
                <button onClick={handleSubmit} disabled={!canSubmit}
                  className={`flex-1 py-3.5 bg-gradient-to-l ${headerGradient} text-white rounded-2xl text-sm font-extrabold disabled:opacity-40 transition-all shadow-sm flex items-center justify-center gap-2`}>
                  <UserPlus size={16} /> {saving ? 'جاري الإضافة...' : 'إضافة العميل'}
                </button>
                <button onClick={() => { onClose(); setDraft(blank(mode)); }}
                  className="px-5 py-3.5 bg-gray-100 text-gray-700 rounded-2xl text-sm font-bold hover:bg-gray-200 transition">
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Print Receipt ── */}
      {printData && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => setPrintData(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs" dir="rtl" onClick={e => e.stopPropagation()}>
            <div className="bg-gray-800 text-white rounded-t-2xl px-4 py-3 flex items-center justify-between">
              <span className="font-bold text-sm">وصل الدفعة</span>
              <div className="flex items-center gap-2">
                <button onClick={() => window.print()} className="px-3 py-1.5 bg-white text-gray-800 rounded-lg text-xs font-bold hover:bg-gray-100 flex items-center gap-1">
                  <Printer size={12} /> طباعة
                </button>
                <button onClick={() => setPrintData(null)} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30"><X size={14} /></button>
              </div>
            </div>
            <div id="addSubPrintReceipt" className="p-5 font-mono text-xs space-y-2">
              <div className="text-center font-extrabold text-base">مهاد نفسي</div>
              <div className="text-center text-gray-500 text-[11px]">{printData.date}</div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="space-y-1">
                <div><span className="text-gray-500">الاسم: </span><span className="font-bold">{printData.name}</span></div>
                <div><span className="text-gray-500">الهاتف: </span><span className="font-bold">{printData.phone}</span></div>
                {printData.courses.length > 0 && printData.courses.map((c, i) => (
                  <div key={i}><span className="text-gray-500">الكورس: </span><span className="font-bold">{c}</span></div>
                ))}
              </div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">نوع الحجز:</span>
                  <span className="font-bold">{printData.bookingType === 'new_booking' ? '◆ حجز جديد' : '◈ قسط'}</span>
                </div>
                <div className="flex justify-between font-extrabold text-sm">
                  <span>المبلغ:</span><span>{printData.amount.toLocaleString()} {printData.currency}</span>
                </div>
                <div className="flex justify-between"><span className="text-gray-500">طريقة الدفع:</span><span className="font-bold">{printData.method}</span></div>
              </div>
              <div className="border-t border-dashed border-gray-300 my-2" />
              <div className="text-center text-gray-400 text-[10px]">شكراً لثقتكم 🌿</div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
