import React from 'react';
import { CreditCard, X } from 'lucide-react';
import type { PaymentItemType, SubscriberItem, Bundle, Course } from '../../../../types';

export type DaqqiPayDraft = {
  bookingType: 'new_booking' | 'installment';
  paymentType: PaymentItemType;
  courseId: string; courseExpected: string; bookingDiscount: string;
  customExpected: string; discountPct: string;
  certType: string; certReqId: string;
  amount: string; currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string; transactionId: string; fromAccountNumber: string;
  date: string; note: string;
  extraItems: { type: PaymentItemType; label: string; amount: string; courseId?: string; certType?: string; discountPct?: string; customExpected?: string }[];
};

export type DaqqiPayModalTrigger = {
  subscriberId: string;
  subscriberName: string;
  roundId?: string;
  attendeeAmountPaid?: number;
};

interface Props {
  modal: DaqqiPayModalTrigger | null;
  draft: DaqqiPayDraft;
  setDraft: (d: DaqqiPayDraft) => void;
  onClose: () => void;
  onSubmit: (shouldPrint: boolean) => void;
  subscribers: SubscriberItem[];
  courses: Course[];
  bundles: Bundle[];
  content: Record<string, string>;
  requirePaymentApproval?: boolean;
}

const certTypeLabels: Record<string, string> = {
  social_solidarity: 'تضامن اجتماعي', ain_shams: 'عين شمس',
  experience_external: 'خبرة خارجي', practice_external: 'ممارسة خارجي',
  national_council: 'المجلس القومي', american_board: 'البورد الأمريكي',
  institute: 'شهادة المعهد', other: 'أخرى',
};

export function DaqqiPayModal({ modal, draft, setDraft, onClose, onSubmit, subscribers, courses, bundles, content, requirePaymentApproval }: Props) {
  if (!modal) return null;

  const payModalSub = subscribers.find(s => s.id === modal.subscriberId);
  const payModalHistory = payModalSub?.paymentHistory || [];
  const payModalTotalPaid = payModalHistory.filter(p => p.currency === draft.currency).reduce((sum, p) => sum + Number(p.amount), 0);
  const payModalCourseMap: Record<string, { paid: number; expected: number }> = {};
  payModalHistory.forEach(p => {
    if (p.courseId) {
      if (!payModalCourseMap[p.courseId]) payModalCourseMap[p.courseId] = { paid: 0, expected: 0 };
      payModalCourseMap[p.courseId].paid += Number(p.amount);
      if (p.courseExpected && Number(p.courseExpected) > 0)
        payModalCourseMap[p.courseId].expected = Math.max(payModalCourseMap[p.courseId].expected, Number(p.courseExpected));
    }
  });
  const payModalTotalExpected = Object.values(payModalCourseMap).reduce((s, v) => s + v.expected, 0);
  const payModalRemaining = Math.max(0, payModalTotalExpected - payModalTotalPaid);

  const _sysPx = (() => {
    const cid = draft.courseId;
    if (!cid) return 0;
    if (cid.startsWith('bundle:')) {
      const b = bundles.find(bx => bx.id === cid.replace('bundle:', ''));
      return (b?.price as unknown as Record<string,number>)?.[draft.currency] || (b?.price as unknown as Record<string,number>)?.EGP || 0;
    }
    const c = courses.find(cx => cx.id === cid);
    return (c?.price as unknown as Record<string,number>)?.[draft.currency] || (c?.price as unknown as Record<string,number>)?.EGP || 0;
  })();
  const _customExp = Number(draft.customExpected) || 0;
  const _discPct = Number(draft.discountPct) || 0;
  const _effPx = _customExp > 0 ? _customExp : (_discPct > 0 && _sysPx > 0 ? Math.round(_sysPx * (1 - _discPct / 100)) : _sysPx);
  const _hasDiscount = _effPx > 0 && _sysPx > 0 && _effPx < _sysPx;
  const _amtPaid = Number(draft.amount) || 0;
  const _remaining = _effPx > 0 && _amtPaid > 0 ? Math.max(0, _effPx - _amtPaid) : 0;
  const _extraTotal = (draft.extraItems || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const _grandTotal = _amtPaid + _extraTotal;
  const paymentMethodsList: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map((s: string) => s.trim()).filter(Boolean)
    : ['خزنة الدقي', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'أخرى'];
  const isValid = _amtPaid > 0 && !!draft.paymentMethod;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] overflow-auto" dir="rtl" onClick={e => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="bg-gradient-to-l from-red-700 to-red-500 px-5 py-4 rounded-t-3xl sm:rounded-t-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-xl p-2"><CreditCard size={20} className="text-white" /></div>
              <div>
                <h4 className="font-extrabold text-white text-base leading-tight">تسجيل دفعة</h4>
                <p className="text-red-100 text-xs mt-0.5">{modal.subscriberName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div>
                <p className="text-red-200 text-[10px] font-medium mb-0.5 text-center">العملة</p>
                <select value={draft.currency} onChange={e => setDraft({ ...draft, currency: e.target.value as 'EGP'|'SAR'|'USD' })} className="bg-white/20 border border-white/30 text-white rounded-lg px-2 py-1.5 text-sm font-bold">
                  <option value="EGP" className="text-gray-900 bg-white">ج.م</option>
                  <option value="SAR" className="text-gray-900 bg-white">ر.س</option>
                  <option value="USD" className="text-gray-900 bg-white">$</option>
                </select>
              </div>
              <button onClick={onClose} className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg p-1.5 transition"><X size={18} /></button>
            </div>
          </div>
          {payModalTotalExpected > 0 && (
            <div className="flex gap-2 mt-3">
              <div className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-center">
                <p className="text-[10px] text-red-100 font-semibold">مدفوع</p>
                <p className="text-sm font-extrabold text-white">{payModalTotalPaid.toLocaleString()} ج</p>
              </div>
              <div className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-center">
                <p className="text-[10px] text-red-100 font-semibold">متبقي</p>
                <p className="text-sm font-extrabold text-white">{payModalRemaining > 0 ? `${payModalRemaining.toLocaleString()} ج` : '✅ مكتمل'}</p>
              </div>
              <div className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-center">
                <p className="text-[10px] text-red-100 font-semibold">إجمالي</p>
                <p className="text-sm font-extrabold text-white">{payModalTotalExpected.toLocaleString()} ج</p>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* ── 1: Booking type chips ── */}
          <div className="grid grid-cols-2 gap-3">
            {[{v:'new_booking',ic:'🆕',lb:'حجز جديد'},{v:'installment',ic:'💳',lb:'قسط'}].map(opt => (
              <button key={opt.v} type="button" onClick={() => {
                if (opt.v === 'installment' && payModalSub) {
                  const subEnrolled = payModalSub.enrolledCourseIds || [];
                  let bestCid = ''; let bestRemaining = 0;
                  for (const cid of subEnrolled) {
                    const isBnd = cid.startsWith('bundle:');
                    const bnd = isBnd ? bundles.find(b => b.id === cid.replace('bundle:', '')) : null;
                    const crs = !isBnd ? courses.find(c => c.id === cid) : null;
                    const sysPx = isBnd
                      ? ((bnd?.price as unknown as Record<string,number>)?.[draft.currency] ?? (bnd?.price as unknown as Record<string,number>)?.EGP ?? 0)
                      : ((crs?.price as unknown as Record<string,number>)?.[draft.currency] ?? (crs?.price as unknown as Record<string,number>)?.EGP ?? 0);
                    const paid = (payModalSub.paymentHistory || [])
                      .filter(p => p.courseId === cid && p.currency === draft.currency)
                      .reduce((s, p) => s + Number(p.amount), 0);
                    const rem = sysPx > 0 ? Math.max(0, sysPx - paid) : 0;
                    if (rem > bestRemaining) { bestRemaining = rem; bestCid = cid; }
                  }
                  setDraft({ ...draft, bookingType: 'installment', paymentType: 'course', ...(bestCid ? { courseId: bestCid, amount: String(bestRemaining), customExpected: '', discountPct: '' } : {}) });
                } else {
                  setDraft({ ...draft, bookingType: 'new_booking', courseId: '', amount: '', customExpected: '', discountPct: '' });
                }
              }}
                className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-base font-extrabold border-2 transition ${draft.bookingType === opt.v ? 'bg-red-600 border-red-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-600 hover:border-red-400 hover:text-red-600'}`}>
                <span className="text-xl">{opt.ic}</span>{opt.lb}
              </button>
            ))}
          </div>

          {/* ── 2: Payment type chips ── */}
          <div className="flex items-center gap-1.5 flex-wrap bg-gray-50 border border-gray-100 rounded-xl px-2 py-2">
            {[{v:'course',ic:'🎓',lb:'كورس'},{v:'certificate',ic:'🏅',lb:'شهادة'},{v:'consultation',ic:'💬',lb:'استشارة'},{v:'book',ic:'📚',lb:'كتاب'},{v:'carneh',ic:'🗂️',lb:'كارنيه'},{v:'other',ic:'📦',lb:'أخرى'}].map(opt => (
              <button key={opt.v} type="button" onClick={() => setDraft({ ...draft, paymentType: opt.v as PaymentItemType, courseId: '', certReqId: '', certType: '' })}
                className={`flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition ${draft.paymentType === opt.v ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600'}`}>
                {opt.ic} {opt.lb}
              </button>
            ))}
          </div>

          {/* ── 3: Course / item selection ── */}
          {(() => {
            const subEnrolledIds: string[] = payModalSub?.enrolledCourseIds || [];
            const isCourse = draft.paymentType === 'course';
            const isCert = draft.paymentType === 'certificate';
            const isConsultation = draft.paymentType === 'consultation';
            const isBookOrCarneh = draft.paymentType === 'book' || draft.paymentType === 'carneh';
            const enrolledCourseOptions = subEnrolledIds.map(cid => {
              const isBnd = cid.startsWith('bundle:');
              const bnd = isBnd ? bundles.find(b => b.id === cid.replace('bundle:', '')) : null;
              const crs = !isBnd ? courses.find(c => c.id === cid) : null;
              const label = bnd?.title || crs?.titleAr || crs?.title || cid;
              const sysPx = isBnd
                ? ((bnd?.price as unknown as Record<string,number>)?.[draft.currency] ?? (bnd?.price as unknown as Record<string,number>)?.EGP ?? 0)
                : ((crs?.price as unknown as Record<string,number>)?.[draft.currency] ?? (crs?.price as unknown as Record<string,number>)?.EGP ?? 0);
              const paidForThis = (payModalSub?.paymentHistory || [])
                .filter(p => p.courseId === cid && p.currency === draft.currency)
                .reduce((s, p) => s + Number(p.amount), 0);
              const remaining = sysPx > 0 ? Math.max(0, sysPx - paidForThis) : null;
              return { cid, label, sysPx, paidForThis, remaining, isBnd };
            });
            const certRequests = payModalSub?.extraCertificateRequests || [];

            if (isConsultation) return (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 text-sm text-blue-700 font-semibold flex items-center gap-2">
                <span>💬</span>الاستشارة لا تحتاج تحديد كورس
              </div>
            );

            if (isBookOrCarneh) {
              if (enrolledCourseOptions.length === 0) return (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3">
                  <p className="text-amber-800 font-bold text-sm flex items-center gap-2"><span>⚠️</span>لازم يكون الكتاب/الكارنيه لكورس محجوز مسبقاً</p>
                  <p className="text-amber-600 text-xs mt-1">العميل غير مسجّل في أي كورس بعد</p>
                </div>
              );
              return (
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">الكورس المرتبط <span className="text-red-500">*</span></label>
                  <div className="space-y-1.5">
                    {enrolledCourseOptions.map(opt => {
                      const isSel = draft.courseId === opt.cid;
                      return (
                        <button key={opt.cid} type="button" onClick={() => setDraft({ ...draft, courseId: opt.cid })}
                          className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 border-2 text-right transition ${isSel ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300'}`}>
                          <span className="text-base">{opt.isBnd ? '📌' : '🎓'}</span>
                          <span className={`text-sm font-bold flex-1 text-right ${isSel ? 'text-red-800' : 'text-gray-800'}`}>{opt.label}</span>
                          {isSel && <span className="text-red-500 font-bold text-lg">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (isCert && draft.bookingType === 'installment' && certRequests.length === 0) return (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2.5">
                <span className="text-2xl mt-0.5">⚠️</span>
                <div>
                  <p className="text-amber-800 font-bold text-sm">لابد من حجز شهادة جديدة أولاً</p>
                  <p className="text-amber-600 text-xs mt-0.5">يجب إضافة طلب شهادة للعميل قبل دفع قسط عليها</p>
                  <button type="button" onClick={() => setDraft({ ...draft, bookingType: 'new_booking' })}
                    className="mt-1.5 text-xs bg-red-600 text-white font-bold px-2.5 py-1 rounded-lg hover:bg-red-700 transition">← تحويل لحجز جديد</button>
                </div>
              </div>
            );

            return (
              <div className="space-y-2">
                {(isCourse || isCert || (!isCourse && !isCert)) && (
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                      {isCert ? 'الكورس المرتبطة به الشهادة' : 'الكورس / المسار'}
                    </label>
                    {isCourse && draft.bookingType === 'installment' && enrolledCourseOptions.length > 0 ? (
                      <div className="space-y-1.5">
                        {enrolledCourseOptions.map(opt => {
                          const isSelected = draft.courseId === opt.cid;
                          return (
                            <button key={opt.cid} type="button"
                              onClick={() => {
                                const upd: Record<string,string> = { courseId: opt.cid, customExpected: '', discountPct: '' };
                                if (draft.bookingType === 'installment' && (opt.remaining ?? 0) > 0) upd.amount = String(opt.remaining);
                                setDraft({ ...draft, ...upd });
                              }}
                              className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 border-2 text-right transition ${isSelected ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50/30'}`}>
                              <div className="flex items-start gap-2 flex-1 min-w-0">
                                <span className="text-base mt-0.5">{opt.isBnd ? '📌' : '🎓'}</span>
                                <div className="min-w-0 text-right">
                                  <p className={`text-sm font-bold truncate ${isSelected ? 'text-red-800' : 'text-gray-800'}`}>{opt.label}</p>
                                  {opt.sysPx > 0 && (
                                    <p className="text-[11px] text-gray-500 mt-0.5">
                                      <span className="text-green-700 font-semibold">مدفوع: {opt.paidForThis.toLocaleString()}</span>
                                      {' · '}<span className="font-semibold">إجمالي: {opt.sysPx.toLocaleString()}</span>
                                      {' · '}{(opt.remaining ?? 0) > 0
                                        ? <span className="text-amber-600 font-bold">متبقي: {opt.remaining!.toLocaleString()}</span>
                                        : <span className="text-green-600 font-bold">✅ مكتمل</span>}
                                    </p>
                                  )}
                                </div>
                              </div>
                              {isSelected && <span className="text-red-500 font-bold text-lg mr-1">✓</span>}
                            </button>
                          );
                        })}
                        <button type="button"
                          onClick={() => setDraft({ ...draft, courseId: '', customExpected: '', discountPct: '' })}
                          className="text-xs text-gray-400 hover:text-gray-600 underline mt-0.5">
                          + كورس آخر غير مسجّل
                        </button>
                      </div>
                    ) : isCourse ? (
                      <select value={draft.courseId} onChange={e => setDraft({ ...draft, courseId: e.target.value, customExpected: '', discountPct: '' })}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-red-400">
                        <option value="">— اختر الكورس أو المسار —</option>
                        {bundles.length > 0 && <optgroup label="📌 المسارات">{bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}</optgroup>}
                        <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>
                      </select>
                    ) : isCert && enrolledCourseOptions.length > 0 ? (
                      <div className="space-y-1.5">
                        {enrolledCourseOptions.map(opt => {
                          const isSelected = draft.courseId === opt.cid;
                          return (
                            <button key={opt.cid} type="button"
                              onClick={() => setDraft({ ...draft, courseId: opt.cid, certReqId: undefined, customExpected: '', discountPct: '' } as DaqqiPayDraft)}
                              className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 border-2 text-right transition ${isSelected ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50/30'}`}>
                              <div className="flex items-start gap-2 flex-1 min-w-0">
                                <span className="text-base mt-0.5">{opt.isBnd ? '📌' : '🎓'}</span>
                                <p className={`text-sm font-bold truncate ${isSelected ? 'text-red-800' : 'text-gray-800'}`}>{opt.label}</p>
                              </div>
                              {isSelected && <span className="text-red-500 font-bold text-lg mr-1">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <select value={draft.courseId} onChange={e => setDraft({ ...draft, courseId: e.target.value, customExpected: '', discountPct: '' })}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-red-400">
                        <option value="">— اختر الكورس أو المسار —</option>
                        {bundles.length > 0 && <optgroup label="📌 المسارات">{bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}</optgroup>}
                        <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>
                      </select>
                    )}
                    {/* Certificate type selector */}
                    {isCert && (
                      <div className="mt-2">
                        <label className="block text-xs font-bold text-gray-500 mb-1">نوع الشهادة</label>
                        {certRequests.filter(r => !draft.courseId || r.courseId === draft.courseId).length > 0 ? (
                          <div className="space-y-1">
                            {certRequests.filter(r => !draft.courseId || r.courseId === draft.courseId).map(r => {
                              const isSelCert = draft.certReqId === r.id;
                              const certLabel = r.customName || certTypeLabels[r.type] || r.type;
                              const certPx = r.price ?? 0;
                              const certPaid = r.paidAmount ?? 0;
                              return (
                                <button key={r.id} type="button"
                                  onClick={() => {
                                    const certRem = certPx > 0 ? Math.max(0, certPx - certPaid) : 0;
                                    const upd: Record<string,unknown> = { certReqId: r.id, customExpected: String(certPx || ''), certType: r.type };
                                    if (draft.bookingType === 'installment' && certRem > 0) upd.amount = String(certRem);
                                    setDraft({ ...draft, ...upd } as DaqqiPayDraft);
                                  }}
                                  className={`w-full flex items-center justify-between rounded-xl px-3 py-2 border-2 text-right transition ${isSelCert ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300'}`}>
                                  <div className="text-right">
                                    <p className={`text-sm font-bold ${isSelCert ? 'text-red-800' : 'text-gray-800'}`}>🏅 {certLabel}</p>
                                    {certPx > 0 && (
                                      <p className="text-[11px] text-gray-500">
                                        {r.status === 'paid'
                                          ? <span className="font-semibold text-green-600">✅ مدفوعة</span>
                                          : <><span className="text-green-700 font-semibold">مدفوع: {certPaid.toLocaleString()}</span>{' · '}<span className="font-semibold">إجمالي: {certPx.toLocaleString()}</span>{' · '}<span className="text-amber-600 font-bold">متبقي: {Math.max(0, certPx - certPaid).toLocaleString()}</span></>
                                        }
                                      </p>
                                    )}
                                  </div>
                                  {isSelCert && <span className="text-red-500 font-bold text-lg">✓</span>}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <select value={draft.certType} onChange={e => setDraft({ ...draft, certType: e.target.value })}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-red-400">
                            <option value="">— نوع الشهادة —</option>
                            {Object.entries(certTypeLabels).map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 4: Amount + price adjustment ── */}
          <div className="flex flex-wrap items-center gap-2 bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2.5">
            <span className="text-xs font-extrabold text-red-700 whitespace-nowrap">
              {draft.bookingType === 'installment' ? '💳 مبلغ القسط' : '💰 المقدم'}<span className="text-red-500">*</span>
            </span>
            <input type="number" min="0" placeholder="0" value={draft.amount}
              onChange={e => setDraft({ ...draft, amount: e.target.value })}
              className="w-28 border-2 border-red-400 bg-white rounded-lg px-2 py-1.5 text-sm font-extrabold text-red-900 focus:outline-none focus:border-red-600"
              autoFocus />
            <span className="text-xs text-gray-500 font-semibold">{draft.currency}</span>
            {(draft.paymentType === 'course' || draft.paymentType === 'certificate') && draft.courseId && (
              <>
                <span className="text-gray-300 select-none">|</span>
                {_sysPx > 0 && (
                  <select value={draft.discountPct || ''}
                    onChange={e => setDraft({ ...draft, discountPct: e.target.value, customExpected: '' })}
                    className="border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs text-gray-600 focus:outline-none focus:border-red-400">
                    <option value="">خصم%</option>
                    {['5','10','15','20','25','30','35','40','50'].map(p => <option key={p} value={p}>{p}%</option>)}
                  </select>
                )}
                <input type="number" min="0" placeholder="سعر مختلف؟"
                  value={draft.customExpected || ''}
                  onChange={e => setDraft({ ...draft, customExpected: e.target.value, discountPct: '' })}
                  className="w-24 border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:border-amber-400" />
                {_hasDiscount && (
                  <span className="text-xs font-bold text-red-600 whitespace-nowrap">
                    <span className="text-gray-400 line-through mr-1">{_sysPx.toLocaleString()}</span>→{_effPx.toLocaleString()} {draft.currency}
                  </span>
                )}
              </>
            )}
            {draft.bookingType === 'installment' && draft.courseId && (() => {
              const _alreadyPaid = payModalCourseMap[draft.courseId]?.paid ?? 0;
              const _bal = _sysPx > 0 ? Math.max(0, _sysPx - _alreadyPaid) : 0;
              if (_bal > 0) return (
                <button type="button" onClick={() => setDraft({ ...draft, amount: String(_bal) })}
                  className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-lg hover:bg-amber-100 transition whitespace-nowrap">
                  ⚡ كل المتبقي ({_bal.toLocaleString()})
                </button>
              );
              if (_alreadyPaid > 0 && _bal === 0) return <span className="text-[10px] font-bold text-green-600">✅ مكتمل الدفع</span>;
              return null;
            })()}
            {draft.bookingType === 'new_booking' && _remaining > 0 && <span className="text-[10px] text-amber-600 font-medium whitespace-nowrap">متبقي: <span className="font-bold">{_remaining.toLocaleString()}</span></span>}
            {draft.bookingType === 'new_booking' && _effPx > 0 && _amtPaid >= _effPx && _amtPaid > 0 && <span className="text-[10px] font-bold text-green-600">✅ مكتمل</span>}
          </div>

          {/* ── 5: Add buttons ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button"
              onClick={() => setDraft({ ...draft, extraItems: [...(draft.extraItems || []), { type: 'course' as PaymentItemType, label: '', amount: '', courseId: '', discountPct: '', customExpected: '' }] })}
              className="text-xs text-blue-700 hover:text-blue-900 font-bold border border-blue-300 hover:border-blue-500 px-3 py-1.5 rounded-lg transition bg-blue-50 hover:bg-blue-100">
              + إضافة كورس آخر
            </button>
            <button type="button"
              onClick={() => setDraft({ ...draft, extraItems: [...(draft.extraItems || []), { type: 'other' as PaymentItemType, label: '', amount: '' }] })}
              className="text-xs text-gray-600 hover:text-gray-900 font-bold border border-gray-300 hover:border-gray-500 px-3 py-1.5 rounded-lg transition bg-white hover:bg-gray-50">
              + إضافة خدمة / منتج
            </button>
            {_grandTotal > 0 && <span className="mr-auto text-xs font-bold text-gray-700">الإجمالي: <span className="text-red-600 font-extrabold">{_grandTotal.toLocaleString()} {draft.currency}</span></span>}
          </div>

          {/* ── 6: Extra items ── */}
          {(draft.extraItems || []).length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wide">➕ الإضافات</p>
              {draft.extraItems.map((item, idx) => {
                const isExtraCourse = item.type === 'course';
                const isExtraCert = item.type === 'certificate';
                const enrolledForExtra: string[] = payModalSub?.enrolledCourseIds || [];
                const certTypeLbls: Record<string, string> = { social_solidarity: 'تضامن اجتماعي', ain_shams: 'عين شمس', experience_external: 'خبرة خارجي', practice_external: 'ممارسة خارجي', national_council: 'المجلس القومي', american_board: 'البورد الأمريكي', institute: 'شهادة المعهد', other: 'أخرى' };
                const eiSysPx = isExtraCourse && item.courseId ? (() => {
                  const cid = item.courseId!;
                  if (cid.startsWith('bundle:')) {
                    const b = bundles.find(bx => bx.id === cid.replace('bundle:', ''));
                    return (b?.price as unknown as Record<string,number>)?.[draft.currency] || (b?.price as unknown as Record<string,number>)?.EGP || 0;
                  }
                  const c = courses.find(cx => cx.id === cid);
                  return (c?.price as unknown as Record<string,number>)?.[draft.currency] || (c?.price as unknown as Record<string,number>)?.EGP || 0;
                })() : 0;
                const eiCustomExp = Number(item.customExpected) || 0;
                const eiDiscPct = Number(item.discountPct) || 0;
                const eiEffPx = eiCustomExp > 0 ? eiCustomExp : (eiDiscPct > 0 && eiSysPx > 0 ? Math.round(eiSysPx * (1 - eiDiscPct / 100)) : eiSysPx);
                const eiHasDiscount = eiEffPx > 0 && eiSysPx > 0 && eiEffPx < eiSysPx;
                return (
                  <div key={idx} className="border-2 border-blue-200 rounded-xl p-3 bg-blue-50/40 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-blue-600 whitespace-nowrap">#{idx + 1}</span>
                      <select value={item.type}
                        onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], type: e.target.value as PaymentItemType, courseId: '', certType: '', discountPct: '', customExpected: '' }; setDraft({ ...draft, extraItems: ni }); }}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white flex-shrink-0 font-semibold">
                        <option value="course">🎓 كورس</option>
                        <option value="certificate">🏅 شهادة</option>
                        <option value="consultation">💬 استشارة</option>
                        <option value="book">📚 كتاب</option>
                        <option value="carneh">🗂️ كارنيه</option>
                        <option value="other">📦 أخرى</option>
                      </select>
                      {!isExtraCourse && !isExtraCert && (
                        <input type="text" placeholder="وصف (اختياري)" value={item.label}
                          onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], label: e.target.value }; setDraft({ ...draft, extraItems: ni }); }}
                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-0 bg-white" />
                      )}
                      {!isExtraCourse && (
                        <input type="number" min="0" placeholder="المبلغ" value={item.amount}
                          onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], amount: e.target.value }; setDraft({ ...draft, extraItems: ni }); }}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white font-bold text-center" />
                      )}
                      <button type="button" onClick={() => setDraft({ ...draft, extraItems: draft.extraItems.filter((_, i) => i !== idx) })}
                        className="text-red-400 hover:text-red-600 font-bold text-xl leading-none px-1 flex-shrink-0 mr-auto">×</button>
                    </div>
                    {isExtraCourse && (
                      <select value={item.courseId || ''} onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], courseId: e.target.value, discountPct: '', customExpected: '' }; setDraft({ ...draft, extraItems: ni }); }}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-400">
                        <option value="">— اختر الكورس —</option>
                        {bundles.length > 0 && <optgroup label="📌 المسارات">{bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}</optgroup>}
                        <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>
                      </select>
                    )}
                    {isExtraCourse && (
                      <div className="flex flex-wrap items-center gap-2 bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2.5">
                        <span className="text-xs font-extrabold text-red-700 whitespace-nowrap">
                          💰 المقدم<span className="text-red-500">*</span>
                        </span>
                        <input type="number" min="0" placeholder="0" value={item.amount}
                          onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], amount: e.target.value }; setDraft({ ...draft, extraItems: ni }); }}
                          className="w-28 border-2 border-red-400 bg-white rounded-lg px-2 py-1.5 text-sm font-extrabold text-red-900 focus:outline-none focus:border-red-600" />
                        <span className="text-xs text-gray-500 font-semibold">{draft.currency}</span>
                        {item.courseId && (
                          <>
                            <span className="text-gray-300 select-none">|</span>
                            {eiSysPx > 0 && (
                              <select value={item.discountPct || ''}
                                onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], discountPct: e.target.value, customExpected: '' }; setDraft({ ...draft, extraItems: ni }); }}
                                className="border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs text-gray-600 focus:outline-none focus:border-red-400">
                                <option value="">خصم%</option>
                                {['5','10','15','20','25','30','35','40','50'].map(p => <option key={p} value={p}>{p}%</option>)}
                              </select>
                            )}
                            <input type="number" min="0" placeholder="السعر النهائي؟"
                              value={item.customExpected || ''}
                              onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], customExpected: e.target.value, discountPct: '' }; setDraft({ ...draft, extraItems: ni }); }}
                              className="w-24 border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:border-amber-400" />
                            {eiSysPx > 0 && (
                              <span className="text-xs font-bold text-gray-500 whitespace-nowrap">
                                {eiHasDiscount
                                  ? <><span className="text-gray-400 line-through mr-1">{eiSysPx.toLocaleString()}</span>→{eiEffPx.toLocaleString()} {draft.currency}</>
                                  : <>{eiSysPx.toLocaleString()} {draft.currency}</>
                                }
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {isExtraCert && (
                      <div className="space-y-1.5">
                        {enrolledForExtra.length > 0 ? (
                          <select value={item.courseId || ''} onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], courseId: e.target.value }; setDraft({ ...draft, extraItems: ni }); }}
                            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-red-400">
                            <option value="">— كورس الشهادة —</option>
                            {enrolledForExtra.map(cid => {
                              const isBnd = cid.startsWith('bundle:');
                              const lb = isBnd ? bundles.find(b => b.id === cid.replace('bundle:', ''))?.title || cid : courses.find(c => c.id === cid)?.titleAr || courses.find(c => c.id === cid)?.title || cid;
                              return <option key={cid} value={cid}>{isBnd ? '📌' : '🎓'} {lb}</option>;
                            })}
                          </select>
                        ) : (
                          <div className="text-xs text-amber-600 font-semibold bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                            ⚠️ لابد من حجز شهادة جديدة — العميل غير مسجّل في أي كورس
                          </div>
                        )}
                        <select value={item.certType || ''} onChange={e => { const ni = [...draft.extraItems]; ni[idx] = { ...ni[idx], certType: e.target.value }; setDraft({ ...draft, extraItems: ni }); }}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-red-400">
                          <option value="">— نوع الشهادة —</option>
                          {Object.entries(certTypeLbls).map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 7: Payment details ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">وسيلة الدفع <span className="text-red-500">*</span></label>
              <select value={draft.paymentMethod} onChange={e => setDraft({ ...draft, paymentMethod: e.target.value })} className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!draft.paymentMethod ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white'}`}>
                <option value="">— وسيلة الدفع —</option>
                {paymentMethodsList.map((m: string) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">التاريخ</label>
              <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">رقم العملية <span className="text-gray-400 font-normal">(اختياري)</span></label>
              <input type="text" dir="ltr" placeholder="اختياري" value={draft.transactionId} onChange={e => setDraft({ ...draft, transactionId: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">رقم المحول <span className="text-gray-400 font-normal">(اختياري)</span></label>
              <input type="text" dir="ltr" placeholder="اختياري" value={draft.fromAccountNumber} onChange={e => setDraft({ ...draft, fromAccountNumber: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">ملاحظة</label>
            <input type="text" placeholder="اختياري" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          </div>

          {/* ── 8: Payment summary ── */}
          {_amtPaid > 0 && (() => {
            const typeLabel: Record<string, string> = { course: 'كورس', certificate: 'شهادة', consultation: 'استشارة', book: 'كتاب', carneh: 'كارنيه', other: 'أخرى' };
            const courseLabel = (() => {
              const cid = draft.courseId;
              if (!cid) return '';
              if (cid.startsWith('bundle:')) return '📌 ' + (bundles.find(b => b.id === cid.replace('bundle:', ''))?.title || cid);
              return '🎓 ' + (courses.find(c => c.id === cid)?.titleAr || courses.find(c => c.id === cid)?.title || cid);
            })();
            return (
              <div className="bg-gradient-to-l from-gray-50 to-blue-50/60 border border-blue-200 rounded-xl p-3 space-y-1.5">
                <p className="font-extrabold text-gray-800 text-sm">📋 ملخص الدفعة</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <span className="text-gray-500">نوع الخدمة:</span><span className="font-semibold">{typeLabel[draft.paymentType] || draft.paymentType}</span>
                  {courseLabel && <><span className="text-gray-500">الكورس:</span><span className="font-semibold">{courseLabel}</span></>}
                  {_effPx > 0 && <><span className="text-gray-500">السعر:</span><span className="font-semibold">{_effPx.toLocaleString()} {draft.currency}{_hasDiscount ? ' (بعد الخصم)' : ''}</span></>}
                  <span className="text-gray-500">المدفوع الآن:</span><span className="font-bold text-green-700">{_amtPaid.toLocaleString()} {draft.currency}</span>
                  {_extraTotal > 0 && <><span className="text-gray-500">إضافات:</span><span className="font-semibold">+{_extraTotal.toLocaleString()} {draft.currency}</span></>}
                  {_grandTotal > 0 && _extraTotal > 0 && <><span className="text-gray-500">الإجمالي:</span><span className="font-extrabold text-red-700">{_grandTotal.toLocaleString()} {draft.currency}</span></>}
                  {_remaining > 0 && draft.bookingType === 'new_booking' && <><span className="text-gray-500">المتبقي:</span><span className="font-bold text-amber-600">{_remaining.toLocaleString()} {draft.currency}</span></>}
                </div>
              </div>
            );
          })()}

          {/* ── 9: Submit buttons ── */}
          <div className="flex gap-2 pb-2">
            <button onClick={() => onSubmit(false)} disabled={!isValid}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-sm font-extrabold disabled:opacity-40 transition-all shadow-sm flex items-center justify-center gap-2 shadow-lg shadow-red-100">
              <CreditCard size={16} /> تسجيل الدفعة
            </button>
            <button onClick={() => onSubmit(true)} disabled={!isValid}
              className="flex-1 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-2xl text-sm font-extrabold disabled:opacity-40 transition-all shadow-sm flex items-center justify-center gap-2">
              🖨️ تسجيل وطباعة
            </button>
            <button onClick={onClose} className="px-4 py-3 bg-gray-100 text-gray-700 rounded-2xl text-sm font-bold hover:bg-gray-200 transition">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}
