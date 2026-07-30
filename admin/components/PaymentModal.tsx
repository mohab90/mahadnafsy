/**
 * PaymentModal — unified payment/booking registration modal
 * Based on DaqqiScheduleTab design. Used in all payment locations.
 */
import React, { useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import type {
  PaymentItemType, PaymentHistoryEntry,
  ExtraCertificateRequest,
} from '../types';

// ── Shared draft type ──────────────────────────────────────────────────────
export interface PaymentDraft {
  bookingType: 'new_booking' | 'installment';
  paymentType: PaymentItemType;
  courseId: string;
  customExpected: string;   // override the system price
  discountPct: string;      // % discount
  certType: string;
  certReqId: string;
  amount: string;
  currency: 'EGP' | 'SAR' | 'USD';
  paymentMethod: string;
  transactionId: string;
  fromAccountNumber: string;
  date: string;
  note: string;
  extraItems: ExtraPayItem[];
  // Lead-only
  branch?: string;
  email?: string;
  nationalId?: string;
}

export interface ExtraPayItem {
  type: PaymentItemType;
  label: string;
  amount: string;
  courseId?: string;
  certType?: string;
  discountPct?: string;
  customExpected?: string;
}

export const blankPaymentDraft = (opts?: {
  courseId?: string; branch?: string; currency?: 'EGP' | 'SAR' | 'USD';
  email?: string;
}): PaymentDraft => ({
  bookingType: 'new_booking',
  paymentType: 'course',
  courseId: opts?.courseId || '',
  customExpected: '',
  discountPct: '',
  certType: '',
  certReqId: '',
  amount: '',
  currency: opts?.currency || 'EGP',
  paymentMethod: '',
  transactionId: '',
  fromAccountNumber: '',
  date: new Date().toISOString().slice(0, 10),
  note: '',
  extraItems: [],
  branch: opts?.branch,
  email: opts?.email,
  nationalId: '',
});

// ── PrintReceipt sub-component ─────────────────────────────────────────────
interface PrintData {
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
}

const PrintReceiptModal: React.FC<{ data: PrintData; onClose: () => void }> = ({ data, onClose }) => (
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
          {data.courseExpected > 0 && <div className="flex justify-between"><span className="text-gray-600">إجمالي الكورس:</span><span className="font-bold">{data.courseExpected.toLocaleString()} {data.currency}</span></div>}
          {data.prevPaid > 0 && <div className="flex justify-between"><span className="text-gray-600">مدفوع سابقاً:</span><span className="font-bold">{data.prevPaid.toLocaleString()} {data.currency}</span></div>}
          <div className="flex justify-between font-extrabold text-[12px]">
            <span>المدفوع الآن:</span><span>{data.total.toLocaleString()} {data.currency}</span>
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
          <div className="font-bold text-gray-700">{data.instituteName}</div>
          <div>🌐 mahadnafsy.com</div>
          <div className="mt-1">شكراً لثقتكم — نتمنى لكم رحلة نفسية سليمة 🌿</div>
        </div>
      </div>
    </div>
    <style>{`
      @media print {
        body > *:not(#payModalPrintReceipt) { display: none !important; }
        #payModalPrintReceipt {
          display: block !important; width: 80mm !important; max-width: 80mm !important;
          margin: 0 !important; padding: 3mm !important; font-size: 10px !important;
          font-family: monospace !important; line-height: 1.4 !important; color: #000 !important;
        }
      }
    `}</style>
  </div>
);

// ── Main PaymentModal ──────────────────────────────────────────────────────
interface SubjectInfo {
  id: string;
  name: string;
  phone?: string;
  enrolledCourseIds?: string[];
  paymentHistory?: PaymentHistoryEntry[];
  extraCertificateRequests?: ExtraCertificateRequest[];
  branch?: string;
  email?: string;
}

interface BranchOption { id: string; label: string; }

interface PaymentModalProps {
  mode: 'lead' | 'subscriber';
  subject: SubjectInfo;
  draft: PaymentDraft;
  setDraft: (d: PaymentDraft) => void;
  /** Parent should save data here. Component handles closing. */
  onSubmit: (draft: PaymentDraft, shouldPrint: boolean) => void | Promise<void>;
  /** Called when the modal should close (user cancelled or finished) */
  onClose: () => void;
  requirePaymentApproval?: boolean;
  branchOptions?: BranchOption[];
  instituteName?: string;
  branchLabel?: string;
}

const certTypeLabels: Record<string, string> = {
  social_solidarity: 'تضامن اجتماعي', ain_shams: 'عين شمس',
  experience_external: 'خبرة خارجي', practice_external: 'ممارسة خارجي',
  national_council: 'المجلس القومي', american_board: 'البورد الأمريكي',
  institute: 'شهادة المعهد', other: 'أخرى',
};

const PaymentModal: React.FC<PaymentModalProps> = ({
  mode, subject, draft, setDraft, onSubmit, onClose,
  requirePaymentApproval, branchOptions = [], instituteName = 'معهد الدراسات النفسية',
  branchLabel,
}) => {
  const { courses, bundles, content, authUser } = useSiteData();
  const [printData, setPrintData] = useState<PrintData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const d = draft;
  const set = (partial: Partial<PaymentDraft>) => setDraft({ ...d, ...partial });

  // ── Helpers ────────────────────────────────────────────────────────────
  const sysPrice = (courseId: string): number => {
    if (!courseId) return 0;
    if (courseId.startsWith('bundle:')) {
      const b = bundles.find(bx => bx.id === courseId.replace('bundle:', ''));
      return (b?.price as unknown as Record<string, number>)?.[d.currency] || (b?.price as unknown as Record<string, number>)?.EGP || 0;
    }
    const c = courses.find(cx => cx.id === courseId);
    return (c?.price as unknown as Record<string, number>)?.[d.currency] || (c?.price as unknown as Record<string, number>)?.EGP || 0;
  };

  const courseLabel = (courseId: string): string => {
    if (!courseId) return '';
    if (courseId.startsWith('bundle:')) return bundles.find(b => b.id === courseId.replace('bundle:', ''))?.title || courseId;
    const c = courses.find(cx => cx.id === courseId);
    return c?.titleAr || c?.title || courseId;
  };

  const _sysPx = sysPrice(d.courseId);
  const _customExp = Number(d.customExpected) || 0;
  const _discPct = Number(d.discountPct) || 0;
  const _effPx = _customExp > 0 ? _customExp : (_discPct > 0 && _sysPx > 0 ? Math.round(_sysPx * (1 - _discPct / 100)) : _sysPx);
  const _hasDiscount = _effPx > 0 && _sysPx > 0 && _effPx < _sysPx;
  const _amtPaid = Number(d.amount) || 0;
  const _extraTotal = (d.extraItems || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const _grandTotal = _amtPaid + _extraTotal;
  const _remaining = _effPx > 0 && _amtPaid > 0 ? Math.max(0, _effPx - _amtPaid) : 0;

  // Payment history stats (subscriber only)
  const payHistory: PaymentHistoryEntry[] = subject.paymentHistory || [];
  const payTotalPaid = payHistory.filter(p => p.currency === d.currency).reduce((s, p) => s + Number(p.amount), 0);
  const coursePayMap: Record<string, { paid: number; expected: number }> = {};
  payHistory.forEach(p => {
    // Use 'bundle:ID' as key for bundle payments (where courseId is null but bundleId is set)
    const effId = p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : null);
    if (effId) {
      if (!coursePayMap[effId]) coursePayMap[effId] = { paid: 0, expected: 0 };
      coursePayMap[effId].paid += Number(p.amount);
      if (p.courseExpected && Number(p.courseExpected) > 0)
        coursePayMap[effId].expected = Math.max(coursePayMap[effId].expected, Number(p.courseExpected));
    }
  });
  const payTotalExpected = Object.values(coursePayMap).reduce((s, v) => s + v.expected, 0);
  const payRemaining = Math.max(0, payTotalExpected - payTotalPaid);

  const enrolledIds: string[] = subject.enrolledCourseIds || [];

  // Auto-detect bundles: if ALL courses of a bundle are in enrolledIds but bundle:ID isn't explicit,
  // treat it as a bundle enrollment and collapse individual courses into one entry.
  const explicitBundleIds = new Set(
    enrolledIds.filter(id => id.startsWith('bundle:')).map(id => id.replace('bundle:', ''))
  );
  type AutoBundle = { bId: string; courseIds: string[] };
  const autoDetectedBundles: AutoBundle[] = [];
  const autoDetectedCourseIds = new Set<string>();
  for (const b of bundles) {
    if (explicitBundleIds.has(b.id)) continue;
    const bCourseIds = (b.courses || []).map(c => c.id);
    if (bCourseIds.length > 1 && bCourseIds.every(cid => enrolledIds.includes(cid))) {
      autoDetectedBundles.push({ bId: b.id, courseIds: bCourseIds });
      bCourseIds.forEach(cid => autoDetectedCourseIds.add(cid));
    }
  }

  const buildPaid = (cid: string, bCourseIds?: string[]) =>
    payHistory.filter(p => {
      if (p.currency !== d.currency) return false;
      const effId = p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : null);
      if (effId === cid) return true;
      // Also count individual course payments that belong to an auto-detected bundle
      if (bCourseIds && p.courseId && bCourseIds.includes(p.courseId)) return true;
      return false;
    }).reduce((s, p) => s + Number(p.amount), 0);

  const enrolledOptions = [
    // 1. Auto-detected bundles — shown as ONE entry with bundle price
    ...autoDetectedBundles.map(({ bId, courseIds }) => {
      const b = bundles.find(x => x.id === bId)!;
      const bKey = `bundle:${bId}`;
      const px = (b.price as unknown as Record<string, number>)?.[d.currency] ?? (b.price as unknown as Record<string, number>)?.EGP ?? 0;
      const paid = buildPaid(bKey, courseIds);
      const remaining = px > 0 ? Math.max(0, px - paid) : null;
      return { cid: bKey, label: b.title, px, paid, remaining, isBnd: true };
    }),
    // 2. Individual entries — skip courses already collapsed into an auto-detected bundle
    ...enrolledIds
      .filter(cid => !autoDetectedCourseIds.has(cid))
      .map(cid => {
        const isBnd = cid.startsWith('bundle:');
        const bnd = isBnd ? bundles.find(b => b.id === cid.replace('bundle:', '')) : null;
        const crs = !isBnd ? courses.find(c => c.id === cid) : null;
        const label = bnd?.title || crs?.titleAr || crs?.title || cid;
        const px = isBnd
          ? ((bnd?.price as unknown as Record<string, number>)?.[d.currency] ?? (bnd?.price as unknown as Record<string, number>)?.EGP ?? 0)
          : ((crs?.price as unknown as Record<string, number>)?.[d.currency] ?? (crs?.price as unknown as Record<string, number>)?.EGP ?? 0);
        const paid = buildPaid(cid);
        const remaining = px > 0 ? Math.max(0, px - paid) : null;
        return { cid, label, px, paid, remaining, isBnd };
      }),
  ];

  const certRequests = subject.extraCertificateRequests || [];

  const paymentMethods: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map((s: string) => s.trim()).filter(Boolean)
    : ['كاش', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'أخرى'];

  const isValid = _amtPaid > 0 && !!d.paymentMethod && (mode === 'lead' ? !!d.branch : true);

  // ── Build print data ───────────────────────────────────────────────────
  const buildPrintData = (): PrintData => {
    const prevPaid = payHistory.filter(p => p.currency === d.currency && (!p.courseId || p.courseId === d.courseId)).reduce((s, p) => s + Number(p.amount), 0);
    const extraTotalForPrint = (d.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount), 0);
    const newTotal = prevPaid + _amtPaid + extraTotalForPrint;
    const remaining = _effPx > 0 ? Math.max(0, _effPx - newTotal) : 0;
    const staffName = authUser?.displayName || authUser?.email?.split('@')[0] || 'موظف';
    const label = courseLabel(d.courseId) || d.paymentType;
    return {
      subName: subject.name,
      phone: subject.phone,
      courseName: label,
      items: [
        { label, amount: _amtPaid, currency: d.currency },
        ...(d.extraItems || []).filter(i => Number(i.amount) > 0).map(i => ({
          label: i.label || courseLabel(i.courseId || '') || i.type,
          amount: Number(i.amount),
          currency: d.currency,
        })),
      ],
      total: _amtPaid + extraTotalForPrint,
      currency: d.currency,
      method: d.paymentMethod,
      date: d.date,
      note: d.note || undefined,
      bookingType: d.bookingType,
      courseExpected: _effPx,
      prevPaid,
      remaining,
      staffName,
      transactionId: d.transactionId || undefined,
      instituteName,
      branchLabel,
    };
  };

  // ── Submit handler ─────────────────────────────────────────────────────
  const handleSubmit = async (shouldPrint: boolean) => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const printPayload = shouldPrint ? buildPrintData() : null;
      await onSubmit(d, shouldPrint);
      if (printPayload) setPrintData(printPayload);
      else onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'تعذر حفظ الدفعة. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Show print receipt if needed ───────────────────────────────────────
  if (printData) {
    return (
      <PrintReceiptModal
        data={printData}
        onClose={() => { setPrintData(null); onClose(); }}
      />
    );
  }

  // ── Main modal render ──────────────────────────────────────────────────
  const isCourse = d.paymentType === 'course';
  const isCert = d.paymentType === 'certificate';
  const isConsultation = d.paymentType === 'consultation';
  const isBookOrCarneh = d.paymentType === 'book' || d.paymentType === 'carneh';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[95vh] overflow-auto"
        dir="rtl"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="bg-gradient-to-l from-red-700 to-red-500 px-5 py-4 rounded-t-3xl sm:rounded-t-2xl sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 rounded-xl p-2"><CreditCard size={20} className="text-white" /></div>
              <div>
                <h4 className="font-extrabold text-white text-base leading-tight">
                  {mode === 'lead' ? 'حجز عميل' : 'تسجيل دفعة'}
                </h4>
                <p className="text-red-100 text-xs mt-0.5">{subject.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div>
                <p className="text-red-200 text-[10px] font-medium mb-0.5 text-center">العملة</p>
                <select
                  value={d.currency}
                  onChange={e => set({ currency: e.target.value as 'EGP' | 'SAR' | 'USD' })}
                  className="bg-white/20 border border-white/30 text-white rounded-lg px-2 py-1.5 text-sm font-bold"
                >
                  <option value="EGP" className="text-gray-900 bg-white">ج.م</option>
                  <option value="SAR" className="text-gray-900 bg-white">ر.س</option>
                  <option value="USD" className="text-gray-900 bg-white">$</option>
                </select>
              </div>
              <button onClick={onClose} className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-lg p-1.5 transition">
                <X size={18} />
              </button>
            </div>
          </div>
          {/* Payment stats bar (subscriber only) */}
          {mode === 'subscriber' && payTotalExpected > 0 && (
            <div className="flex gap-2 mt-3">
              {[
                { label: 'مدفوع', value: `${payTotalPaid.toLocaleString()} ج` },
                { label: 'متبقي', value: payRemaining > 0 ? `${payRemaining.toLocaleString()} ج` : '✅ مكتمل' },
                { label: 'إجمالي', value: `${payTotalExpected.toLocaleString()} ج` },
              ].map(item => (
                <div key={item.label} className="flex-1 bg-white/10 border border-white/20 rounded-xl px-3 py-2 text-center">
                  <p className="text-[10px] text-red-100 font-semibold">{item.label}</p>
                  <p className="text-sm font-extrabold text-white">{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* ── 1: Booking type chips ── */}
          <div className="grid grid-cols-2 gap-3">
            {[{ v: 'new_booking', ic: '🆕', lb: 'حجز جديد' }, { v: 'installment', ic: '💳', lb: 'قسط' }].map(opt => (
              <button
                key={opt.v}
                type="button"
                onClick={() => {
                  if (opt.v === 'installment' && enrolledOptions.length > 0) {
                    let bestCid = ''; let bestRem = 0;
                    for (const o of enrolledOptions) {
                      if ((o.remaining ?? 0) > bestRem) { bestRem = o.remaining!; bestCid = o.cid; }
                    }
                    set({
                      bookingType: 'installment', paymentType: 'course',
                      ...(bestCid ? { courseId: bestCid, amount: String(bestRem), customExpected: '', discountPct: '' } : {}),
                    });
                  } else {
                    set({ bookingType: 'new_booking', courseId: '', amount: '', customExpected: '', discountPct: '' });
                  }
                }}
                className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-base font-extrabold border-2 transition ${d.bookingType === opt.v ? 'bg-red-600 border-red-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-600 hover:border-red-400 hover:text-red-600'}`}
              >
                <span className="text-xl">{opt.ic}</span>{opt.lb}
              </button>
            ))}
          </div>

          {/* ── 2: Payment type chips ── */}
          <div className="flex items-center gap-1.5 flex-wrap bg-gray-50 border border-gray-100 rounded-xl px-2 py-2">
            {[
              { v: 'course', ic: '🎓', lb: 'كورس' }, { v: 'certificate', ic: '🏅', lb: 'شهادة' },
              { v: 'consultation', ic: '💬', lb: 'استشارة' }, { v: 'book', ic: '📚', lb: 'كتاب' },
              { v: 'carneh', ic: '🗂️', lb: 'كارنيه' }, { v: 'other', ic: '📦', lb: 'أخرى' },
            ].map(opt => (
              <button
                key={opt.v}
                type="button"
                onClick={() => set({ paymentType: opt.v as PaymentItemType, courseId: '', certReqId: '', certType: '' })}
                className={`flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition ${d.paymentType === opt.v ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600'}`}
              >
                {opt.ic} {opt.lb}
              </button>
            ))}
          </div>

          {/* ── 3: Course / item selection ── */}
          {isConsultation ? (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-3 py-2.5 text-sm text-blue-700 font-semibold flex items-center gap-2">
              <span>💬</span>الاستشارة لا تحتاج تحديد كورس
            </div>
          ) : isBookOrCarneh ? (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                الكورس المرتبط <span className="text-red-500">*</span>
              </label>
              {enrolledOptions.length === 0 ? (
                <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-800 font-semibold">
                  ⚠️ العميل غير مسجّل في أي كورس
                </div>
              ) : (
                <div className="space-y-1.5">
                  {enrolledOptions.map(opt => (
                    <button
                      key={opt.cid}
                      type="button"
                      onClick={() => set({ courseId: opt.cid })}
                      className={`w-full flex items-center gap-2 rounded-xl px-3 py-2 border-2 text-right transition ${d.courseId === opt.cid ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300'}`}
                    >
                      <span className="text-base">{opt.isBnd ? '📌' : '🎓'}</span>
                      <span className={`text-sm font-bold flex-1 text-right ${d.courseId === opt.cid ? 'text-red-800' : 'text-gray-800'}`}>{opt.label}</span>
                      {d.courseId === opt.cid && <span className="text-red-500 font-bold text-lg">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : isCert && d.bookingType === 'installment' && certRequests.length === 0 ? (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2.5">
              <span className="text-2xl mt-0.5">⚠️</span>
              <div>
                <p className="text-amber-800 font-bold text-sm">لابد من حجز شهادة جديدة أولاً</p>
                <button
                  type="button"
                  onClick={() => set({ bookingType: 'new_booking' })}
                  className="mt-1.5 text-xs bg-red-600 text-white font-bold px-2.5 py-1 rounded-lg hover:bg-red-700 transition"
                >← تحويل لحجز جديد</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Course selector */}
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                  {isCert ? 'الكورس المرتبطة به الشهادة' : 'الكورس / المسار'}
                </label>
                {isCourse && d.bookingType === 'installment' && enrolledOptions.length > 0 ? (
                  <div className="space-y-1.5">
                    {enrolledOptions.map(opt => (
                      <button
                        key={opt.cid}
                        type="button"
                        onClick={() => {
                          const upd: Partial<PaymentDraft> = { courseId: opt.cid, customExpected: '', discountPct: '' };
                          if ((opt.remaining ?? 0) > 0) upd.amount = String(opt.remaining);
                          set(upd);
                        }}
                        className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 border-2 text-right transition ${d.courseId === opt.cid ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50/30'}`}
                      >
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <span className="text-base mt-0.5">{opt.isBnd ? '📌' : '🎓'}</span>
                          <div className="min-w-0 text-right">
                            <p className={`text-sm font-bold truncate ${d.courseId === opt.cid ? 'text-red-800' : 'text-gray-800'}`}>{opt.label}</p>
                            {opt.px > 0 && (
                              <p className="text-[11px] text-gray-500 mt-0.5">
                                <span className="text-green-700 font-semibold">مدفوع: {opt.paid.toLocaleString()}</span>
                                {' · '}<span className="font-semibold">إجمالي: {opt.px.toLocaleString()}</span>
                                {' · '}{(opt.remaining ?? 0) > 0
                                  ? <span className="text-amber-600 font-bold">متبقي: {opt.remaining!.toLocaleString()}</span>
                                  : <span className="text-green-600 font-bold">✅ مكتمل</span>}
                              </p>
                            )}
                          </div>
                        </div>
                        {d.courseId === opt.cid && <span className="text-red-500 font-bold text-lg mr-1">✓</span>}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => set({ courseId: '', customExpected: '', discountPct: '' })}
                      className="text-xs text-gray-400 hover:text-gray-600 underline mt-0.5"
                    >+ كورس آخر غير مسجّل</button>
                  </div>
                ) : isCert && enrolledOptions.length > 0 ? (
                  <div className="space-y-1.5">
                    {enrolledOptions.map(opt => (
                      <button
                        key={opt.cid}
                        type="button"
                        onClick={() => set({ courseId: opt.cid, certReqId: '', customExpected: '', discountPct: '' })}
                        className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 border-2 text-right transition ${d.courseId === opt.cid ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300 hover:bg-red-50/30'}`}
                      >
                        <div className="flex items-start gap-2 flex-1 min-w-0">
                          <span className="text-base mt-0.5">{opt.isBnd ? '📌' : '🎓'}</span>
                          <p className={`text-sm font-bold truncate ${d.courseId === opt.cid ? 'text-red-800' : 'text-gray-800'}`}>{opt.label}</p>
                        </div>
                        {d.courseId === opt.cid && <span className="text-red-500 font-bold text-lg mr-1">✓</span>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <select
                    value={d.courseId}
                    onChange={e => set({ courseId: e.target.value, customExpected: '', discountPct: '' })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-red-400"
                  >
                    <option value="">— اختر الكورس أو المسار —</option>
                    {bundles.length > 0 && <optgroup label="📌 المسارات">{bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}</optgroup>}
                    <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>
                  </select>
                )}
                {/* Certificate type selector */}
                {isCert && (
                  <div className="mt-2">
                    <label className="block text-xs font-bold text-gray-500 mb-1">نوع الشهادة</label>
                    {certRequests.filter(r => !d.courseId || r.courseId === d.courseId).length > 0 ? (
                      <div className="space-y-1">
                        {certRequests.filter(r => !d.courseId || r.courseId === d.courseId).map(r => {
                          const isSel = d.certReqId === r.id;
                          const certLabel = r.customName || certTypeLabels[r.type] || r.type;
                          const certPx = r.price ?? 0; const certPaid = r.paidAmount ?? 0;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => {
                                const certRem = certPx > 0 ? Math.max(0, certPx - certPaid) : 0;
                                const upd: Partial<PaymentDraft> = { certReqId: r.id, customExpected: String(certPx || ''), certType: r.type };
                                if (d.bookingType === 'installment' && certRem > 0) upd.amount = String(certRem);
                                set(upd);
                              }}
                              className={`w-full flex items-center justify-between rounded-xl px-3 py-2 border-2 text-right transition ${isSel ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white hover:border-red-300'}`}
                            >
                              <div className="text-right">
                                <p className={`text-sm font-bold ${isSel ? 'text-red-800' : 'text-gray-800'}`}>🏅 {certLabel}</p>
                                {certPx > 0 && (
                                  <p className="text-[11px] text-gray-500">
                                    {r.status === 'paid' ? <span className="text-green-600 font-semibold">✅ مدفوعة</span> : <>
                                      <span className="text-green-700 font-semibold">مدفوع: {certPaid.toLocaleString()}</span>
                                      {' · '}<span className="font-semibold">إجمالي: {certPx.toLocaleString()}</span>
                                      {' · '}<span className="text-amber-600 font-bold">متبقي: {Math.max(0, certPx - certPaid).toLocaleString()}</span>
                                    </>}
                                  </p>
                                )}
                              </div>
                              {isSel && <span className="text-red-500 font-bold text-lg">✓</span>}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <select
                        value={d.certType}
                        onChange={e => set({ certType: e.target.value })}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-red-400"
                      >
                        <option value="">— نوع الشهادة —</option>
                        {Object.entries(certTypeLabels).map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 4: Amount + price adjustment ── */}
          <div className="flex flex-wrap items-center gap-2 bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2.5">
            <span className="text-xs font-extrabold text-red-700 whitespace-nowrap">
              {d.bookingType === 'installment' ? '💳 مبلغ القسط' : '💰 المقدم'}<span className="text-red-500">*</span>
            </span>
            <input
              type="number" min="0" placeholder="0"
              value={d.amount}
              onChange={e => set({ amount: e.target.value })}
              className="w-28 border-2 border-red-400 bg-white rounded-lg px-2 py-1.5 text-sm font-extrabold text-red-900 focus:outline-none focus:border-red-600"
              autoFocus
            />
            <span className="text-xs text-gray-500 font-semibold">{d.currency}</span>
            {(isCourse || isCert) && d.courseId && (
              <>
                <span className="text-gray-300 select-none">|</span>
                {_sysPx > 0 && (
                  <select
                    value={d.discountPct || ''}
                    onChange={e => set({ discountPct: e.target.value, customExpected: '' })}
                    className="border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs text-gray-600 focus:outline-none focus:border-red-400"
                  >
                    <option value="">خصم%</option>
                    {['5', '10', '15', '20', '25', '30', '35', '40', '50'].map(p => <option key={p} value={p}>{p}%</option>)}
                  </select>
                )}
                <input
                  type="number" min="0" placeholder="سعر مختلف؟"
                  value={d.customExpected || ''}
                  onChange={e => set({ customExpected: e.target.value, discountPct: '' })}
                  className="w-24 border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:border-amber-400"
                />
                {_hasDiscount && (
                  <span className="text-xs font-bold text-red-600 whitespace-nowrap">
                    <span className="text-gray-400 line-through mr-1">{_sysPx.toLocaleString()}</span>→{_effPx.toLocaleString()} {d.currency}
                  </span>
                )}
              </>
            )}
            {/* ⚡ Quick "all remaining" for installment */}
            {d.bookingType === 'installment' && d.courseId && (() => {
              const alreadyPaid = coursePayMap[d.courseId]?.paid ?? 0;
              const bal = _sysPx > 0 ? Math.max(0, _sysPx - alreadyPaid) : 0;
              if (bal > 0) return (
                <button
                  type="button"
                  onClick={() => set({ amount: String(bal) })}
                  className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-lg hover:bg-amber-100 transition whitespace-nowrap"
                >
                  ⚡ كل المتبقي ({bal.toLocaleString()})
                </button>
              );
              if (alreadyPaid > 0 && bal === 0) return <span className="text-[10px] font-bold text-green-600">✅ مكتمل الدفع</span>;
              return null;
            })()}
            {d.bookingType === 'new_booking' && _remaining > 0 && (
              <span className="text-[10px] text-amber-600 font-medium whitespace-nowrap">متبقي: <span className="font-bold">{_remaining.toLocaleString()}</span></span>
            )}
          </div>

          {/* ── 5: Add extra items ── */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => set({ extraItems: [...(d.extraItems || []), { type: 'course', label: '', amount: '', courseId: '', discountPct: '', customExpected: '' }] })}
              className="text-xs text-blue-700 hover:text-blue-900 font-bold border border-blue-300 hover:border-blue-500 px-3 py-1.5 rounded-lg transition bg-blue-50 hover:bg-blue-100"
            >+ إضافة كورس آخر</button>
            <button
              type="button"
              onClick={() => set({ extraItems: [...(d.extraItems || []), { type: 'other', label: '', amount: '' }] })}
              className="text-xs text-gray-600 hover:text-gray-900 font-bold border border-gray-300 hover:border-gray-500 px-3 py-1.5 rounded-lg transition bg-white hover:bg-gray-50"
            >+ إضافة خدمة / منتج</button>
            {_grandTotal > 0 && (
              <span className="mr-auto text-xs font-bold text-gray-700">
                الإجمالي: <span className="text-red-600 font-extrabold">{_grandTotal.toLocaleString()} {d.currency}</span>
              </span>
            )}
          </div>

          {/* ── 6: Extra items list ── */}
          {(d.extraItems || []).length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wide">➕ الإضافات</p>
              {d.extraItems.map((item, idx) => {
                const isExtraCourse = item.type === 'course';
                const eiSysPx = isExtraCourse && item.courseId ? sysPrice(item.courseId) : 0;
                const eiCustomExp = Number(item.customExpected) || 0;
                const eiDiscPct = Number(item.discountPct) || 0;
                const eiEffPx = eiCustomExp > 0 ? eiCustomExp : (eiDiscPct > 0 && eiSysPx > 0 ? Math.round(eiSysPx * (1 - eiDiscPct / 100)) : eiSysPx);
                const eiHasDiscount = eiEffPx > 0 && eiSysPx > 0 && eiEffPx < eiSysPx;
                const updateItem = (upd: Partial<ExtraPayItem>) => {
                  const ni = [...d.extraItems]; ni[idx] = { ...ni[idx], ...upd }; set({ extraItems: ni });
                };
                return (
                  <div key={idx} className="border-2 border-blue-200 rounded-xl p-3 bg-blue-50/40 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-blue-600 whitespace-nowrap">#{idx + 1}</span>
                      <select
                        value={item.type}
                        onChange={e => updateItem({ type: e.target.value as PaymentItemType, courseId: '', certType: '', discountPct: '', customExpected: '' })}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white flex-shrink-0 font-semibold"
                      >
                        <option value="course">🎓 كورس</option>
                        <option value="certificate">🏅 شهادة</option>
                        <option value="consultation">💬 استشارة</option>
                        <option value="book">📚 كتاب</option>
                        <option value="carneh">🗂️ كارنيه</option>
                        <option value="other">📦 أخرى</option>
                      </select>
                      {!isExtraCourse && (
                        <input
                          type="text" placeholder="وصف (اختياري)" value={item.label}
                          onChange={e => updateItem({ label: e.target.value })}
                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs min-w-0 bg-white"
                        />
                      )}
                      {!isExtraCourse && (
                        <input
                          type="number" min="0" placeholder="المبلغ" value={item.amount}
                          onChange={e => updateItem({ amount: e.target.value })}
                          className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white font-bold text-center"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => set({ extraItems: d.extraItems.filter((_, i) => i !== idx) })}
                        className="text-red-400 hover:text-red-600 font-bold text-xl leading-none px-1 flex-shrink-0 mr-auto"
                      >×</button>
                    </div>
                    {isExtraCourse && (
                      <>
                        <select
                          value={item.courseId || ''}
                          onChange={e => updateItem({ courseId: e.target.value, discountPct: '', customExpected: '' })}
                          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"
                        >
                          <option value="">— اختر الكورس —</option>
                          {bundles.length > 0 && <optgroup label="📌 المسارات">{bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}</optgroup>}
                          <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>
                        </select>
                        <div className="flex flex-wrap items-center gap-2 bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2.5">
                          <span className="text-xs font-extrabold text-red-700 whitespace-nowrap">💰 المقدم<span className="text-red-500">*</span></span>
                          <input
                            type="number" min="0" placeholder="0" value={item.amount}
                            onChange={e => updateItem({ amount: e.target.value })}
                            className="w-28 border-2 border-red-400 bg-white rounded-lg px-2 py-1.5 text-sm font-extrabold text-red-900 focus:outline-none focus:border-red-600"
                          />
                          <span className="text-xs text-gray-500 font-semibold">{d.currency}</span>
                          {item.courseId && (
                            <>
                              <span className="text-gray-300 select-none">|</span>
                              {eiSysPx > 0 && (
                                <select
                                  value={item.discountPct || ''}
                                  onChange={e => updateItem({ discountPct: e.target.value, customExpected: '' })}
                                  className="border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs"
                                >
                                  <option value="">خصم%</option>
                                  {['5', '10', '15', '20', '25', '30', '35', '40', '50'].map(p => <option key={p} value={p}>{p}%</option>)}
                                </select>
                              )}
                              <input
                                type="number" min="0" placeholder="السعر النهائي؟"
                                value={item.customExpected || ''}
                                onChange={e => updateItem({ customExpected: e.target.value, discountPct: '' })}
                                className="w-24 border border-gray-200 bg-white rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:border-amber-400"
                              />
                              {eiSysPx > 0 && (
                                <span className="text-xs font-bold text-gray-500 whitespace-nowrap">
                                  {eiHasDiscount
                                    ? <><span className="text-gray-400 line-through mr-1">{eiSysPx.toLocaleString()}</span>→{eiEffPx.toLocaleString()} {d.currency}</>
                                    : <>{eiSysPx.toLocaleString()} {d.currency}</>
                                  }
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 7: Lead-only: branch selector ── */}
          {mode === 'lead' && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">الفرع <span className="text-red-500">*</span></label>
              <select
                value={d.branch || ''}
                onChange={e => set({ branch: e.target.value })}
                className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!d.branch ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white'}`}
              >
                <option value="">— اختر الفرع —</option>
                {branchOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
          )}

          {/* ── 8: Payment details ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">وسيلة الدفع <span className="text-red-500">*</span></label>
              <select
                value={d.paymentMethod}
                onChange={e => set({ paymentMethod: e.target.value })}
                className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!d.paymentMethod ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white'}`}
              >
                <option value="">— وسيلة الدفع —</option>
                {paymentMethods.map((m: string) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">التاريخ</label>
              <input
                type="date" value={d.date}
                onChange={e => set({ date: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">رقم العملية <span className="text-gray-400 font-normal">(اختياري)</span></label>
              <input
                type="text" dir="ltr" placeholder="اختياري"
                value={d.transactionId}
                onChange={e => set({ transactionId: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1.5">رقم المحوّل <span className="text-gray-400 font-normal">(اختياري)</span></label>
              <input
                type="text" dir="ltr" placeholder="اختياري"
                value={d.fromAccountNumber}
                onChange={e => set({ fromAccountNumber: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
          {/* Lead-only: email + national ID */}
          {mode === 'lead' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  البريد الإلكتروني
                  {d.email && d.email.includes('@') && <span className="text-emerald-600 mr-1 text-[10px]">✓ سيُرسَل ترحيب</span>}
                </label>
                <input
                  type="email" dir="ltr" placeholder="email@example.com"
                  value={d.email || ''}
                  onChange={e => set({ email: e.target.value })}
                  className={`w-full border rounded-xl px-3 py-2 text-sm font-mono ${d.email && !d.email.includes('@') ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">الرقم القومي <span className="text-gray-400 font-normal">(اختياري)</span></label>
                <input
                  type="text" dir="ltr" placeholder="14 رقم"
                  value={d.nationalId || ''}
                  onChange={e => set({ nationalId: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1.5">ملاحظة</label>
            <input
              type="text" placeholder="اختياري"
              value={d.note}
              onChange={e => set({ note: e.target.value })}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
            />
          </div>

          {/* ── 9: Payment summary ── */}
          {_amtPaid > 0 && (() => {
            const typeLabel: Record<string, string> = { course: 'كورس', certificate: 'شهادة', consultation: 'استشارة', book: 'كتاب', carneh: 'كارنيه', other: 'أخرى' };
            const cLabel = d.courseId ? (d.courseId.startsWith('bundle:') ? '📌 ' : '🎓 ') + courseLabel(d.courseId) : '';
            return (
              <div className="bg-gradient-to-l from-gray-50 to-blue-50/60 border border-blue-200 rounded-xl p-3 space-y-1.5">
                <p className="font-extrabold text-gray-800 text-sm">📋 ملخص الدفعة</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <span className="text-gray-500">نوع الخدمة:</span><span className="font-semibold">{typeLabel[d.paymentType] || d.paymentType}</span>
                  {cLabel && <><span className="text-gray-500">الكورس:</span><span className="font-semibold">{cLabel}</span></>}
                  {_effPx > 0 && <><span className="text-gray-500">السعر:</span><span className="font-semibold">{_effPx.toLocaleString()} {d.currency}{_hasDiscount ? ' (بعد الخصم)' : ''}</span></>}
                  <span className="text-gray-500">المدفوع الآن:</span><span className="font-bold text-green-700">{_amtPaid.toLocaleString()} {d.currency}</span>
                  {_extraTotal > 0 && <><span className="text-gray-500">إضافات:</span><span className="font-semibold">+{_extraTotal.toLocaleString()} {d.currency}</span></>}
                  {_grandTotal > 0 && _extraTotal > 0 && <><span className="text-gray-500">الإجمالي:</span><span className="font-extrabold text-red-700">{_grandTotal.toLocaleString()} {d.currency}</span></>}
                  {_remaining > 0 && d.bookingType === 'new_booking' && <><span className="text-gray-500">المتبقي:</span><span className="font-bold text-amber-600">{_remaining.toLocaleString()} {d.currency}</span></>}
                  {requirePaymentApproval && <><span className="text-gray-500">الحالة:</span><span className="font-bold text-amber-600">⏳ بانتظار الموافقة</span></>}
                </div>
              </div>
            );
          })()}

          {/* ── 10: Submit buttons ── */}
          {submitError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
              {submitError}
            </div>
          )}
          <div className="flex gap-2 pb-2">
            <button
              onClick={() => { void handleSubmit(false); }}
              disabled={!isValid || submitting}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white rounded-2xl text-sm font-extrabold disabled:opacity-40 transition-all shadow-sm flex items-center justify-center gap-2 shadow-lg shadow-red-100"
            >
              <CreditCard size={16} /> {submitting ? 'جارٍ الحفظ...' : 'تسجيل الدفعة'}
            </button>
            <button
              onClick={() => { void handleSubmit(true); }}
              disabled={!isValid || submitting}
              className="flex-1 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-2xl text-sm font-extrabold disabled:opacity-40 transition-all shadow-sm flex items-center justify-center gap-2"
            >
              🖨️ {submitting ? 'جارٍ الحفظ...' : 'تسجيل وطباعة'}
            </button>
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-3 bg-gray-100 text-gray-700 rounded-2xl text-sm font-bold hover:bg-gray-200 transition"
            >إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
