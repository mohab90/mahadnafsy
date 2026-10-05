/**
 * PaymentModal — unified payment/booking registration modal
 * Based on DaqqiScheduleTab design. Used in all payment locations.
 */
import { latinDigits } from '../../shared/latinDigits';
import React, { useEffect, useState } from 'react';
import { cairoDateOnly } from '../../shared/cairoDate';
import { CreditCard, Home, X } from 'lucide-react';
import { useCrmData, useStaticData } from '../context/siteDataSlices';
import { useCertificateCatalog } from '../lib/certificateCatalog';
import { agreedPriceFor } from '../lib/agreedPrice';
import { mysqlAdmin } from '../lib/mysqlapi';
import { attributeNextPayment } from '../lib/paymentAttribution';
import type {
  PaymentItemType, PaymentHistoryEntry,
  ExtraCertificateRequest,
} from '../types';
import { usePaymentBoxes } from '../lib/paymentMethods';
import { isCollected } from '../lib/money';
import { Modal } from '../../shared/ui/Modal';
import { confirmDialog } from '../../shared/ui/confirmDialog';
import { DaqqiRoundPicker } from '../pages/dashboard/tabs/daqqi/DaqqiRoundPicker';
import { roundLabel } from '../pages/dashboard/tabs/daqqi/daqqiScheduleUtils';
import { getCatalogPricing, tierForBranch, formatMoney, type CatalogPricing, type PriceTierKey, type TierPrice } from '../lib/catalogPricing';
import { arabicNameProblem, englishNameProblem, nationalIdProblem } from '../lib/bookingIdentity';

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
  // Lead mode, and 'new' mode, which is a lead-shaped customer who does not
  // exist in the system yet.
  branch?: string;
  email?: string;
  nationalId?: string;
  // 'new' mode only: the person is being created by this form.
  name?: string;
  phone?: string;
  /**
   * «تسكين»: the Dokki round this booking seats the client in. Only a Dokki booking
   * carries one; the server seats them when it records the booking.
   */
  daqqiRoundId?: string;
  /**
   * «اختيار السعر الصح بيكون بعد اختيار الكورس والفرع»: the branch tier a new
   * course booking is priced at, and whether the client gets its discount
   * price (lib/catalogPricing.ts). The server charges the catalogue's figure
   * for it, never a typed one.
   */
  priceTier?: PriceTierKey | '';
  useDiscount?: boolean;
  /** «اسم العميل الحقيقي عربي ثلاثي … بالانجليزي … تاكيد علي رقم التليفون». */
  nameAr?: string;
  nameEn?: string;
  phoneConfirmed?: boolean;
}

export interface ExtraPayItem {
  type: PaymentItemType;
  label: string;
  amount: string;
  courseId?: string;
  certType?: string;
  discountPct?: string;
  customExpected?: string;
  /** A course added to a tier-priced booking takes the same tier; this is its discount choice. */
  useDiscount?: boolean;
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
  date: cairoDateOnly(),
  note: '',
  extraItems: [],
  branch: opts?.branch,
  email: opts?.email,
  nationalId: '',
  name: '',
  phone: '',
  daqqiRoundId: '',
  priceTier: '',
  useDiscount: false,
  nameAr: '',
  nameEn: '',
  phoneConfirmed: false,
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
  /** Prices agreed per course/track, and money paid before the system (crm_json.priorPaid). */
  customPrices?: Record<string, number>;
  priorPaid?: Record<string, number>;
  /** Courses/tracks the caller knows the client holds though no enrolment says so — the
   *  Dokki desk passes the course of the round the payment is opened from. */
  heldItemIds?: string[];
}

interface BranchOption { id: string; label: string; }

interface PaymentModalProps {
  /**
   * 'subscriber' — an existing customer pays.
   * 'lead'     — a lead pays and becomes one.
   * 'new'      — the person does not exist yet: this form creates them and
   *              takes the first payment. Two screens had their own copy of
   *              that (the Daqqi desk and عملاء الأونلاين) and they disagreed
   *              about the fields, the rules and where the money went.
   */
  mode: 'lead' | 'subscriber' | 'new';
  subject: SubjectInfo;
  draft: PaymentDraft;
  setDraft: (d: PaymentDraft) => void;
  /** Parent should save data here. Component handles closing. */
  onSubmit: (draft: PaymentDraft, shouldPrint: boolean) => void | Promise<void>;
  /** Called when the modal should close (user cancelled or finished) */
  onClose: () => void;
  requirePaymentApproval?: boolean;
  /**
   * No discount, no other price: a collection account books at the price the
   * client agreed — «تغيير سعر الكورس بيتم من الحسابات او الادارة فقط». The
   * API ignores a price sent from one anyway (routes/subscriber-payments.js).
   */
  lockPrice?: boolean;
  branchOptions?: BranchOption[];
  /**
   * Who this payment could be for, when the screen was not opened from a
   * particular customer. الحسابات → «تسجيل دخل» starts from the money and
   * picks the person; every other entry point already knows them.
   *
   * Given, and with no subject.id yet, the screen renders the picker itself
   * rather than a second dialog in front of it.
   */
  subjectOptions?: { id: string; name: string; clientCode?: string }[];
  onSubjectChange?: (id: string) => void;
  instituteName?: string;
  branchLabel?: string;
}

const PaymentModal: React.FC<PaymentModalProps> = ({
  mode, subject, draft, setDraft, onSubmit, onClose,
  requirePaymentApproval, lockPrice = false, branchOptions = [], instituteName = 'معهد الدراسات النفسية',
  subjectOptions, onSubjectChange,
  branchLabel,
}) => {
  const { courses, bundles, content, authUser, isAdmin } = useStaticData();
  const { staffMembers, daqqiRounds } = useCrmData();
  // The certificates «تسعير الشهادات» lists — its own, not eight written here.
  const certCatalog = useCertificateCatalog();
  const [printData, setPrintData] = useState<PrintData | null>(null);
  // Escape closes the dialog and focus starts inside it. The Daqqi desk had
  // this on its own copy of this modal and every other payment screen did not;
  // now they are the same screen, it belongs here. Called before the printData
  // early return below, and told whether it is live — a hook after a return
  // runs on some renders and not others.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // «الدفعة دي جت عن طريق مين؟» — the owner records payments from an account
  // with no staff row, so without this none of them names whose money it was.
  // An admin login with no staff row is the owner, matched as useSignedInStaff does.
  const ownEmail = String(authUser?.email || '').toLowerCase().trim();
  const asksWhoBroughtIt = isAdmin && mode !== 'new'
    && !staffMembers.some(member => String(member.email || '').toLowerCase().trim() === ownEmail);
  const [broughtBy, setBroughtBy] = useState('');
  // «تكملة»: the course being completed into a track; '' when not upgrading.
  const [upgradeFrom, setUpgradeFrom] = useState<string | null>(null);

  const d = draft;
  const set = (partial: Partial<PaymentDraft>) => setDraft({ ...d, ...partial });

  // The real name is often already on file: a client booked before, or a lead
  // that typed it. Offered, not assumed — the desk still confirms it.
  useEffect(() => {
    if (d.nameAr) return;
    const known = mode === 'new' ? d.name : subject.name;
    if (known && !arabicNameProblem(known)) setDraft({ ...d, nameAr: known.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject.id]);

  // Each course's price per branch (api/lib/priceTiers.js), read once per opening.
  const [catalogPricing, setCatalogPricing] = useState<CatalogPricing | null>(null);
  const [pricingError, setPricingError] = useState('');
  useEffect(() => {
    let alive = true;
    getCatalogPricing()
      .then(result => { if (alive) setCatalogPricing(result); })
      .catch(() => { if (alive) setPricingError('تعذر تحميل أسعار الفروع — حدّث الصفحة'); });
    return () => { alive = false; };
  }, []);

  // «تسكين»: a Dokki booking can seat the client in a round as it is recorded. The
  // button shows once the branch is Dokki — the one picked here for a lead or a new
  // client, the client's own for an existing one — and the desk can see the rounds.
  const [housingOpen, setHousingOpen] = useState(false);
  const bookingBranch = String((mode === 'subscriber' ? (subject.branch || d.branch) : d.branch) || '').toUpperCase().replace(/[-\s]/g, '_');
  const canHouse = bookingBranch === 'DAQQI' && d.bookingType === 'new_booking' && (daqqiRounds || []).length > 0;
  const housingRound = d.daqqiRoundId ? (daqqiRounds || []).find(round => round.id === d.daqqiRoundId) : undefined;

  // Who this payment is for. In 'new' mode they do not exist yet, so it is
  // whoever is being typed into the form.
  const personName = mode === 'new' ? (d.name || '').trim() : subject.name;
  const personPhone = mode === 'new' ? (d.phone || '').trim() : subject.phone;

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

  // A new course booking is priced by the branch tier the desk picks, after the course.
  const tierBooking = d.paymentType === 'course' && d.bookingType === 'new_booking' && upgradeFrom === null;
  const itemPricing = d.courseId && catalogPricing
    ? (d.courseId.startsWith('bundle:')
      ? catalogPricing.items.bundle[d.courseId.replace('bundle:', '')]
      : catalogPricing.items.course[d.courseId])
    : undefined;
  const tierOptions: TierPrice[] = itemPricing?.tiers || [];
  const chosenTier = tierBooking ? tierOptions.find(tier => tier.key === d.priceTier) : undefined;
  const tierPx = chosenTier?.price != null
    ? (d.useDiscount && chosenTier.discountPrice != null ? chosenTier.discountPrice : chosenTier.price)
    : null;
  const chooseTier = (tier: TierPrice) => set({
    priceTier: tier.key,
    useDiscount: false,
    currency: tier.currency,
    // A lead or a new client is booked at the branch the price belongs to.
    ...(mode !== 'subscriber' ? { branch: tier.branch } : {}),
  });
  // An added course, priced at the booking's tier.
  const extraTierPrice = (item: ExtraPayItem): number | null => {
    if (!tierBooking || item.type !== 'course' || !item.courseId || !catalogPricing || !d.priceTier) return null;
    const tier = (item.courseId.startsWith('bundle:')
      ? catalogPricing.items.bundle[item.courseId.replace('bundle:', '')]
      : catalogPricing.items.course[item.courseId])?.tiers.find(row => row.key === d.priceTier);
    if (tier?.price == null) return null;
    return item.useDiscount && tier.discountPrice != null ? tier.discountPrice : tier.price;
  };
  // Picking a course preselects the tier of the branch already known, when it has a price.
  const pickCourse = (courseId: string) => {
    const pricing = courseId && catalogPricing
      ? (courseId.startsWith('bundle:') ? catalogPricing.items.bundle[courseId.replace('bundle:', '')] : catalogPricing.items.course[courseId])
      : undefined;
    const known = tierForBranch(mode === 'subscriber' ? (subject.branch || d.branch) : d.branch);
    const tier = pricing?.tiers.find(row => row.key === (d.priceTier || known) && row.price != null);
    set({
      courseId, customExpected: '', discountPct: '', useDiscount: false,
      priceTier: tier?.key || '',
      ...(tier ? { currency: tier.currency } : {}),
    });
  };

  const _sysPx = sysPrice(d.courseId);
  // The price this client agreed for this course: their own price on file, or
  // what their booking recorded. The catalogue is only the starting point for a
  // course they have not booked.
  const _agreedPx = d.courseId ? agreedPriceFor(subject, d.courseId, 0, d.currency) : 0;
  const _basePx = _agreedPx > 0 ? _agreedPx : _sysPx;
  const _customExp = Number(d.customExpected) || 0;
  const _discPct = Number(d.discountPct) || 0;
  const _effPx = tierBooking
    ? (tierPx ?? 0)
    : (_customExp > 0 ? _customExp : (_discPct > 0 && _basePx > 0 ? Math.round(_basePx * (1 - _discPct / 100)) : _basePx));
  const _hasDiscount = tierBooking ? Boolean(d.useDiscount && chosenTier?.discountPrice != null) : (_effPx > 0 && _sysPx > 0 && _effPx < _sysPx);
  const _amtPaid = Number(d.amount) || 0;
  const _extraTotal = (d.extraItems || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const _grandTotal = _amtPaid + _extraTotal;
  const _remaining = _effPx > 0 && _amtPaid > 0 ? Math.max(0, _effPx - _amtPaid) : 0;

  // Payment history stats (subscriber only)
  // Refunds stay in this list. lib/refunds.js flips the same payments row to
  // 'refunded' and leaves its positive amount, so every sum below has to say
  // so — otherwise a customer who was refunded reads as having paid it, «مدفوع
  // سابقاً» is too high, «المتبقي» is too low, and the desk under-charges them.
  //
  // Four sums here had no status filter. The Daqqi desk's own copy of this
  // modal did guard its one, so the fault was in every payment taken anywhere
  // else; it surfaced when that copy was folded into this one.
  const payHistory: PaymentHistoryEntry[] = (subject.paymentHistory || []).filter(isCollected);
  const coursePayMap: Record<string, { paid: number }> = {};
  payHistory.forEach(p => {
    // Use 'bundle:ID' as key for bundle payments (where courseId is null but bundleId is set)
    const effId = p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : null);
    if (effId) {
      if (!coursePayMap[effId]) coursePayMap[effId] = { paid: 0 };
      coursePayMap[effId].paid += Number(p.amount);
    }
  });

  // What the client holds. The list was the enrolments alone, and a client who has
  // not been enrolled yet — the Dokki desk's, whose access opens when a payment is
  // approved — held nothing: «قسط» listed no course to pay towards and «تكملة لمسار»
  // never appeared. A course also counts when money has gone against it (collected
  // or waiting), when a price was agreed for it, when «مدفوع قبل السيستم» names it,
  // and when the caller says the client is housed in it.
  const heldByMoney: string[] = [
    ...(subject.paymentHistory || [])
      .filter(p => p.status !== 'failed' && p.status !== 'refunded')
      .map(p => p.courseId || (p.bundleId ? `bundle:${p.bundleId}` : '')),
    ...Object.keys(subject.customPrices || {}).filter(key => !key.startsWith('multi:')),
    ...Object.entries(subject.priorPaid || {}).filter(([, amount]) => Number(amount) > 0).map(([key]) => key),
    ...(subject.heldItemIds || []),
  ].filter(Boolean);
  const enrolledIds: string[] = [...new Set([...(subject.enrolledCourseIds || []), ...heldByMoney])];

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
    (Number(subject.priorPaid?.[cid]) || 0) + payHistory.filter(p => {
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
      const px = agreedPriceFor(subject, bKey,
        (b.price as unknown as Record<string, number>)?.[d.currency] ?? (b.price as unknown as Record<string, number>)?.EGP ?? 0, d.currency);
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
        // What this client agreed for it, not the catalogue: the instalment
        // list showed list price and «متبقي» against it, whatever was agreed.
        const px = agreedPriceFor(subject, cid, isBnd
          ? ((bnd?.price as unknown as Record<string, number>)?.[d.currency] ?? (bnd?.price as unknown as Record<string, number>)?.EGP ?? 0)
          : ((crs?.price as unknown as Record<string, number>)?.[d.currency] ?? (crs?.price as unknown as Record<string, number>)?.EGP ?? 0), d.currency);
        const paid = buildPaid(cid);
        const remaining = px > 0 ? Math.max(0, px - paid) : null;
        return { cid, label, px, paid, remaining, isBnd };
      }),
  ];

  // The totals bar: every course and track they hold, at the price agreed.
  // It summed only bookings that had recorded a price — a quarter had none —
  // and counted certificate and book money as paid towards the courses.
  // «تكملة يعني العميل يحول الكورس الصغير لمسار»: a course they hold that some
  // track contains, and the tracks it can grow into.
  const tracksHolding = (courseId: string) => bundles.filter(b => (b.courses || []).some(course => course.id === courseId));
  const upgradeCandidates = mode === 'subscriber' && subject.id
    ? enrolledOptions.filter(opt => !opt.isBnd && tracksHolding(opt.cid).length > 0)
    : [];
  const upgrading = upgradeFrom !== null;
  const upgradeSource = upgrading ? enrolledOptions.find(opt => opt.cid === upgradeFrom) : undefined;

  const payTotalExpected = enrolledOptions.reduce((s, opt) => s + (opt.px || 0), 0);
  const payTotalPaid = enrolledOptions.reduce((s, opt) => s + opt.paid, 0);
  const payRemaining = Math.max(0, payTotalExpected - payTotalPaid);

  const certRequests = subject.extraCertificateRequests || [];

  // Base price per certificate type, from الإعدادات ← تسعير الشهادات.
  //
  // Picking a type used to show no price at all unless the client already had a
  // certificate request carrying one, so a first-time certificate had nothing to
  // pay against and the amount had to be typed from memory. The settings hold
  // four tiers per type; the tier follows the payment currency, since that is
  // what the rest of this dialog is already denominated in.
  const certBasePrice = (type: string, currency: string): number => {
    const tiers = certCatalog.map[type];
    if (!tiers) return 0;
    if (currency === 'SAR') return Number(tiers.residentSAR) || 0;
    if (currency === 'USD') return Number(tiers.foreignUSD) || 0;
    return Number(tiers.egyptianEGP) || Number(tiers.residentEGP) || 0;
  };

  // Whatever الإعدادات lists, plus every box the institute has actually
  // collected into. The settings key has never been saved on this tenant, so
  // the configured half is a fallback written in code and the second half is
  // where «فودافون كاش 2020» and the other nine come from.
  const paymentMethods: string[] = usePaymentBoxes(content['finance.payment_methods']);

  // In 'new' mode the amount may be zero — enrolling a customer without
  // taking money yet is a real thing the desk does — but a name and a number
  // are not optional, because they are the only way to find the person again.
  const hasIdentity = !!(d.name || '').trim() && !!(d.phone || '').trim();
  const subjectChosen = !subjectOptions || !!subject.id;
  // A tier-priced booking needs its price and the client's real name.
  const tierProblem = tierBooking && d.courseId
    ? (pricingError || (!chosenTier ? 'اختار الفرع عشان يظهر السعر' : tierPx == null ? 'الكورس ده مش متسعّر للفرع ده — حط سعره من صفحة الكورس' : '')
      || ((d.extraItems || []).some(item => item.type === 'course' && item.courseId && extraTierPrice(item) == null)
        ? 'في كورس مضاف مش متسعّر للفرع ده' : ''))
    : '';
  const egyptianId = !chosenTier || ['DAQQI', 'TAGAMOA', 'ONLINE_EGYPT'].includes(chosenTier.key);
  const identityProblem = tierBooking && d.courseId
    ? (arabicNameProblem(d.nameAr) || englishNameProblem(d.nameEn) || nationalIdProblem(d.nationalId, egyptianId)
      || (d.phoneConfirmed ? '' : 'أكّد رقم التليفون مع العميل'))
    : '';
  const isValid = !subjectChosen ? false : tierProblem || identityProblem ? false : mode === 'new'
    ? hasIdentity && (_amtPaid === 0 || (!!d.paymentMethod && !!d.courseId))
    : _amtPaid > 0 && !!d.paymentMethod && (mode === 'lead' ? !!d.branch : true)
      && (!upgrading || (!!upgradeFrom && d.courseId.startsWith('bundle:')));

  // ── Build print data ───────────────────────────────────────────────────
  const buildPrintData = (): PrintData => {
    const prevPaid = payHistory.filter(p => p.currency === d.currency && (!p.courseId || p.courseId === d.courseId)).reduce((s, p) => s + Number(p.amount), 0);
    const extraTotalForPrint = (d.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount), 0);
    const newTotal = prevPaid + _amtPaid + extraTotalForPrint;
    const remaining = _effPx > 0 ? Math.max(0, _effPx - newTotal) : 0;
    const staffName = authUser?.displayName || authUser?.email?.split('@')[0] || 'موظف';
    const label = courseLabel(d.courseId) || d.paymentType;
    return {
      subName: personName,
      phone: personPhone,
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
    // A digit too many would record millions against a course with thousands left.
    // Asked, not refused: a client paying ahead is real.
    const chosen = enrolledOptions.find(option => option.cid === d.courseId);
    const left = chosen && _effPx > 0 ? Math.max(0, _effPx - chosen.paid) : null;
    if (!upgrading && left !== null && _amtPaid > left && !await confirmDialog({
      title: 'المبلغ أكبر من المتبقي',
      message: `${_amtPaid.toLocaleString('ar-EG-u-nu-latn')} ${d.currency} أكبر من المتبقي على «${chosen?.label}» (${left.toLocaleString('ar-EG-u-nu-latn')}). تسجّلها كده؟`,
      confirmLabel: 'سجّلها',
    })) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const printPayload = shouldPrint ? buildPrintData() : null;
      // The handler records exactly the price shown here. It recomputed a
      // discount from the catalogue while this dialog applied it to the agreed
      // price, and a booking with no change typed was recorded at list price
      // over the client's own. An instalment carries a price only when the desk
      // changed it; otherwise the server uses the one agreed.
      const changedPrice = _customExp > 0 || _discPct > 0;
      const shownPrice = _effPx > 0 ? String(_effPx) : d.customExpected;
      if (asksWhoBroughtIt) attributeNextPayment(broughtBy);
      if (upgrading && upgradeFrom) {
        // The course becomes part of the track first, its money with it; the
        // payment is then an instalment on the track, at the price set here.
        await mysqlAdmin.adminPost(`/admin/subscribers/${encodeURIComponent(subject.id)}/course-upgrade`, {
          item: upgradeFrom, toItem: d.courseId, price: changedPrice ? Number(shownPrice) : null,
        });
        await onSubmit({ ...d, bookingType: 'installment', customExpected: '' }, shouldPrint);
        if (printPayload) setPrintData(printPayload);
        else onClose();
        return;
      }
      if (tierBooking && tierPx != null) {
        // The catalogue's figure for the chosen tier; the server checks it against its own.
        await onSubmit({
          ...d,
          customExpected: String(tierPx),
          discountPct: '',
          extraItems: (d.extraItems || []).map(item => {
            const price = extraTierPrice(item);
            return price == null ? item : { ...item, customExpected: String(price), discountPct: '' };
          }),
        }, shouldPrint);
        if (printPayload) setPrintData(printPayload);
        else onClose();
        return;
      }
      await onSubmit({
        ...d,
        customExpected: d.bookingType === 'installment'
          ? (changedPrice ? shownPrice : '')
          : (changedPrice || (_effPx > 0 && _effPx !== _sysPx) ? shownPrice : d.customExpected),
      }, shouldPrint);
      if (printPayload) setPrintData(printPayload);
      else onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'تعذر حفظ الدفعة. حاول مرة أخرى.');
    } finally {
      // Never carried to a later payment, whatever happened to this one.
      attributeNextPayment(null);
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
    // The header keeps the currency selector — it changes what every figure
    // below it means, so it belongs beside the customer's name rather than in
    // the form. The paid/remaining/total bar moves to the top of the body: it
    // is information about the customer, not part of the dialog's chrome.
    <Modal
      open
      onClose={onClose}
      title={mode === 'lead' ? 'حجز عميل' : mode === 'new' ? 'عميل جديد + حجز' : 'تسجيل دفعة'}
      subtitle={personName || (mode === 'new' ? 'عميل جديد' : undefined)}
      icon={<CreditCard size={20} className="text-white" />}
      tone="red"
      align="sheet"
      bodyClassName="px-5 py-4"
      headerExtra={(
        <div>
          <p className="text-red-200 text-[10px] font-medium mb-0.5 text-center">العملة</p>
          <select
            value={d.currency}
            onChange={e => set({ currency: e.target.value as 'EGP' | 'SAR' | 'USD' })}
            // The tier names the currency: a Saudi price is in riyals, whatever is picked here.
            disabled={Boolean(chosenTier)}
            title={chosenTier ? 'العملة بتتحدد من الفرع' : undefined}
            className="bg-white/20 border border-white/30 text-white rounded-lg px-2 py-1.5 text-sm font-bold disabled:opacity-70"
          >
            <option value="EGP" className="text-gray-900 bg-white">ج.م</option>
            <option value="SAR" className="text-gray-900 bg-white">ر.س</option>
            <option value="USD" className="text-gray-900 bg-white">$</option>
          </select>
        </div>
      )}
    >
        <div className="space-y-4">
          {/* Payment stats bar (subscriber only) */}
          {mode === 'subscriber' && payTotalExpected > 0 && (
            <div className="flex gap-2 mb-1">
              {[
                { label: 'مدفوع', value: `${payTotalPaid.toLocaleString('ar-EG-u-nu-latn')} ج` },
                { label: 'متبقي', value: payRemaining > 0 ? `${payRemaining.toLocaleString('ar-EG-u-nu-latn')} ج` : '✅ مكتمل' },
                { label: 'إجمالي', value: `${payTotalExpected.toLocaleString('ar-EG-u-nu-latn')} ج` },
              ].map(item => (
                <div key={item.label} className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-center">
                  <p className="text-[10px] text-gray-500 font-semibold">{item.label}</p>
                  <p className="text-sm font-extrabold text-gray-900">{item.value}</p>
                </div>
              ))}
            </div>
          )}
          {asksWhoBroughtIt && (
            <label className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
              الدفعة دي جت عن طريق مين؟
              <select value={broughtBy} onChange={e => setBroughtBy(e.target.value)}
                className="min-w-[160px] flex-1 rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-bold text-gray-800">
                <option value="">المالك — مش موظف</option>
                {staffMembers.filter(member => member.status !== 'inactive').map(member => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
              <span className="w-full text-[10px] font-normal text-amber-800">بتتحسب للموظف ده في تقاريره وعمولته.</span>
            </label>
          )}

          {/* ── 1: Booking type chips ── */}
          <div className={`grid gap-3 ${upgradeCandidates.length ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {[
              { v: 'new_booking', ic: '🆕', lb: 'حجز جديد' }, { v: 'installment', ic: '💳', lb: 'قسط' },
              ...(upgradeCandidates.length ? [{ v: 'upgrade', ic: '⬆️', lb: 'تكملة لمسار' }] : []),
            ].map(opt => (
              <button
                key={opt.v}
                type="button"
                onClick={() => {
                  if (opt.v === 'upgrade') {
                    const first = upgradeCandidates[0];
                    const track = first ? tracksHolding(first.cid)[0] : undefined;
                    setUpgradeFrom(first?.cid || '');
                    set({ bookingType: 'installment', paymentType: 'course', courseId: track ? `bundle:${track.id}` : '', amount: '', customExpected: '', discountPct: '' });
                    return;
                  }
                  setUpgradeFrom(null);
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
                className={`flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-base font-extrabold border-2 transition ${(opt.v === 'upgrade' ? upgrading : !upgrading && d.bookingType === opt.v) ? 'bg-red-600 border-red-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-600 hover:border-red-400 hover:text-red-600'}`}
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
                onClick={() => { setUpgradeFrom(null); set({ paymentType: opt.v as PaymentItemType, courseId: '', certReqId: '', certType: '' }); }}
                className={`flex items-center gap-0.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition ${d.paymentType === opt.v ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-300 hover:text-red-600'}`}
              >
                {opt.ic} {opt.lb}
              </button>
            ))}
          </div>

          {/* ── 3: Course / item selection ── */}
          {upgrading ? (
            <div className="space-y-2 rounded-xl border-2 border-red-200 bg-red-50/40 p-3">
              <label className="block text-xs font-bold text-gray-600">الكورس اللي عند العميل
                <select value={upgradeFrom || ''} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                  onChange={e => {
                    const track = tracksHolding(e.target.value)[0];
                    setUpgradeFrom(e.target.value);
                    set({ courseId: track ? `bundle:${track.id}` : '', customExpected: '', discountPct: '' });
                  }}>
                  {upgradeCandidates.map(opt => <option key={opt.cid} value={opt.cid}>🎓 {opt.label}</option>)}
                </select>
              </label>
              <label className="block text-xs font-bold text-gray-600">يتكمل للمسار
                <select value={d.courseId} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                  onChange={e => set({ courseId: e.target.value, customExpected: '', discountPct: '' })}>
                  {tracksHolding(upgradeFrom || '').map(b => <option key={b.id} value={`bundle:${b.id}`}>📌 {b.title}</option>)}
                </select>
              </label>
              {upgradeSource && (
                <p className="rounded-lg bg-white px-3 py-2 text-[11px] leading-5 text-gray-600">
                  المدفوع في «{upgradeSource.label}» ({upgradeSource.paid.toLocaleString('ar-EG-u-nu-latn')} {d.currency}) بيتحسب على المسار
                  {_effPx > 0 && <> — المتبقي بعد التكملة: <b className="text-amber-700">{Math.max(0, _effPx - upgradeSource.paid).toLocaleString('ar-EG-u-nu-latn')} {d.currency}</b></>}.
                  الكورس اللي عنده بيفضل مفتوح، وباقي كورسات المسار بتتفتح بالدفع زي أي قسط.
                </p>
              )}
            </div>
          ) : isConsultation ? (
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
                                <span className="text-green-700 font-semibold">مدفوع: {opt.paid.toLocaleString('ar-EG-u-nu-latn')}</span>
                                {' · '}<span className="font-semibold">إجمالي: {opt.px.toLocaleString('ar-EG-u-nu-latn')}</span>
                                {' · '}{(opt.remaining ?? 0) > 0
                                  ? <span className="text-amber-600 font-bold">متبقي: {opt.remaining!.toLocaleString('ar-EG-u-nu-latn')}</span>
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
                        onClick={() => {
                          // Re-apply the type's base price: this reset
                          // customExpected unconditionally, so choosing the
                          // course after the certificate type wiped the price
                          // that had just been filled in.
                          const base = d.certType ? certBasePrice(d.certType, d.currency) : 0;
                          set({ courseId: opt.cid, certReqId: '', customExpected: base > 0 ? String(base) : '', discountPct: '' });
                        }}
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
                    onChange={e => (tierBooking ? pickCourse(e.target.value) : set({ courseId: e.target.value, customExpected: '', discountPct: '' }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-red-400"
                  >
                    <option value="">— اختر الكورس أو المسار —</option>
                    {bundles.length > 0 && <optgroup label="📌 المسارات">{bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}</optgroup>}
                    <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>
                  </select>
                )}
                {/* «يختار الكورس وبعدها يختار الفرع وقتها يظهر السعر … بالعمله بتاعته ويظهر اوبشنز الخصم» */}
                {tierBooking && d.courseId && (
                  <div className="mt-3 rounded-xl border-2 border-gray-200 bg-white p-3">
                    <p className="mb-2 text-xs font-extrabold text-gray-700">الفرع <span className="text-red-500">*</span> <span className="font-normal text-gray-400">— السعر بيظهر بعملة الفرع</span></p>
                    {!catalogPricing && !pricingError && <p className="text-xs text-gray-400">بنحمّل أسعار الفروع…</p>}
                    {pricingError && <p className="text-xs font-bold text-red-600">{pricingError}</p>}
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                      {tierOptions.map(tier => {
                        const selected = d.priceTier === tier.key;
                        const priced = tier.price != null;
                        return (
                          <button key={tier.key} type="button" disabled={!priced}
                            onClick={() => chooseTier(tier)}
                            className={`rounded-xl border-2 px-2.5 py-2 text-right transition ${selected ? 'border-red-500 bg-red-50' : priced ? 'border-gray-200 hover:border-red-300' : 'border-dashed border-gray-200 opacity-50 cursor-not-allowed'}`}>
                            <span className={`block text-xs font-bold ${selected ? 'text-red-800' : 'text-gray-700'}`}>{tier.label}</span>
                            <span className="block text-sm font-extrabold tabular-nums text-gray-900">{priced ? formatMoney(tier.price, tier.currency) : 'مش متسعّر'}</span>
                            {tier.discountPrice != null && <span className="block text-[10px] font-bold text-emerald-700">فيه سعر خصم</span>}
                          </button>
                        );
                      })}
                    </div>
                    {chosenTier && tierPx != null && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                        <span className="text-xs font-bold text-gray-500">سعر الكورس:</span>
                        {d.useDiscount && chosenTier.discountPrice != null ? (
                          <>
                            <span className="text-xs text-gray-400 line-through tabular-nums">{formatMoney(chosenTier.price, chosenTier.currency)}</span>
                            <span className="text-base font-extrabold text-emerald-700 tabular-nums">{formatMoney(chosenTier.discountPrice, chosenTier.currency)}</span>
                          </>
                        ) : (
                          <span className="text-base font-extrabold text-gray-900 tabular-nums">{formatMoney(chosenTier.price, chosenTier.currency)}</span>
                        )}
                        {chosenTier.discountPrice != null && !lockPrice && (
                          <button type="button" onClick={() => set({ useDiscount: !d.useDiscount })}
                            className={`mr-auto rounded-lg border px-3 py-1 text-xs font-extrabold transition ${d.useDiscount ? 'border-gray-300 bg-white text-gray-600' : 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}>
                            {d.useDiscount ? 'رجّع السعر الأساسي' : '🏷️ اعرض سعر الخصم'}
                          </button>
                        )}
                      </div>
                    )}
                    {tierProblem && <p className="mt-2 text-xs font-bold text-amber-700">{tierProblem}</p>}
                  </div>
                )}
                {/* Certificate type selector */}
                {isCert && (
                  <div className="mt-2">
                    <label className="block text-xs font-bold text-gray-500 mb-1">نوع الشهادة</label>
                    {certRequests.filter(r => !d.courseId || r.courseId === d.courseId).length > 0 ? (
                      <div className="space-y-1">
                        {certRequests.filter(r => !d.courseId || r.courseId === d.courseId).map(r => {
                          const isSel = d.certReqId === r.id;
                          const certLabel = certCatalog.label(r.type, r.customName);
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
                                      <span className="text-green-700 font-semibold">مدفوع: {certPaid.toLocaleString('ar-EG-u-nu-latn')}</span>
                                      {' · '}<span className="font-semibold">إجمالي: {certPx.toLocaleString('ar-EG-u-nu-latn')}</span>
                                      {' · '}<span className="text-amber-600 font-bold">متبقي: {Math.max(0, certPx - certPaid).toLocaleString('ar-EG-u-nu-latn')}</span>
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
                      <>
                        <select
                          value={d.certType}
                          onChange={e => {
                            const type = e.target.value;
                            const base = certBasePrice(type, d.currency);
                            // Selecting a type fills the expected total from the
                            // price list, so the remaining amount is computed
                            // rather than remembered. An explicit override the
                            // user already typed is left alone.
                            const upd: Partial<PaymentDraft> = { certType: type };
                            if (base > 0 && !d.customExpected) upd.customExpected = String(base);
                            set(upd);
                          }}
                          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-red-400"
                        >
                          <option value="">— نوع الشهادة —</option>
                          {certCatalog.types.map(({ key: v, label: lb }) => {
                            const base = certBasePrice(v, d.currency);
                            return <option key={v} value={v}>{lb}{base > 0 ? ` — ${base.toLocaleString('ar-EG-u-nu-latn')} ${d.currency}` : ''}</option>;
                          })}
                        </select>
                        {d.certType && (
                          certBasePrice(d.certType, d.currency) > 0 ? (
                            <p className="mt-1 text-[11px] text-gray-600">
                              <span className="font-semibold">السعر الأساسي: </span>
                              {certBasePrice(d.certType, d.currency).toLocaleString('ar-EG-u-nu-latn')} {d.currency}
                              {Number(_amtPaid) > 0 && (
                                <> {' · '}
                                  <span className="text-green-700 font-semibold">تدفع الآن: {Number(_amtPaid).toLocaleString('ar-EG-u-nu-latn')}</span>
                                  {' · '}
                                  <span className="text-amber-600 font-bold">
                                    متبقٍ: {Math.max(0, certBasePrice(d.certType, d.currency) - Number(_amtPaid)).toLocaleString('ar-EG-u-nu-latn')}
                                  </span>
                                </>
                              )}
                            </p>
                          ) : (
                            <p className="mt-1 text-[11px] text-amber-600">
                              لم يُضبط سعر أساسي لهذا النوع — أدخله من الإعدادات ← تسعير الشهادات.
                            </p>
                          )
                        )}
                      </>
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
            {isCert && d.courseId && lockPrice && _effPx > 0 && (
              <span className="text-xs font-bold text-gray-500 whitespace-nowrap">السعر المتفق عليه: {_effPx.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span>
            )}
            {/* «نلغي زر سعر مختلف»: a course is charged its branch's price or
                its discount price (the picker above); an instalment, the price
                already agreed; a certificate, its price list (تسعير الشهادات). */}
            {isCourse && d.courseId && !tierBooking && _effPx > 0 && (
              <span className="text-xs font-bold text-gray-500 whitespace-nowrap">السعر المتفق عليه: {_effPx.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span>
            )}
            {isCert && d.courseId && !lockPrice && _effPx > 0 && (
              <span className="text-xs font-bold text-gray-500 whitespace-nowrap">سعر الشهادة: {_effPx.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span>
            )}
            {/* ⚡ Quick "all remaining" for installment */}
            {d.bookingType === 'installment' && d.courseId && (() => {
              const alreadyPaid = (coursePayMap[d.courseId]?.paid ?? 0) + (Number(subject.priorPaid?.[d.courseId]) || 0);
              // Against the price agreed. It used the catalogue, so «كل
              // المتبقي» asked a client booked at a discount for list price.
              const bal = _effPx > 0 ? Math.max(0, _effPx - alreadyPaid) : 0;
              if (bal > 0) return (
                <button
                  type="button"
                  onClick={() => set({ amount: String(bal) })}
                  className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-lg hover:bg-amber-100 transition whitespace-nowrap"
                >
                  ⚡ كل المتبقي ({bal.toLocaleString('ar-EG-u-nu-latn')})
                </button>
              );
              if (alreadyPaid > 0 && bal === 0) return <span className="text-[10px] font-bold text-green-600">✅ مكتمل الدفع</span>;
              return null;
            })()}
            {d.bookingType === 'new_booking' && _remaining > 0 && (
              <span className="text-[10px] text-amber-600 font-medium whitespace-nowrap">متبقي: <span className="font-bold">{_remaining.toLocaleString('ar-EG-u-nu-latn')}</span></span>
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
                الإجمالي: <span className="text-red-600 font-extrabold">{_grandTotal.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span>
              </span>
            )}
          </div>

          {/* ── 6: Extra items list ── */}
          {(d.extraItems || []).length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-extrabold text-gray-500 uppercase tracking-wide">➕ الإضافات</p>
              {d.extraItems.map((item, idx) => {
                const isExtraCourse = item.type === 'course';
                // In a tier-priced booking an added course is priced at the same branch.
                const eiTier = tierBooking && isExtraCourse && item.courseId && catalogPricing && d.priceTier
                  ? (item.courseId.startsWith('bundle:')
                    ? catalogPricing.items.bundle[item.courseId.replace('bundle:', '')]
                    : catalogPricing.items.course[item.courseId])?.tiers.find(tier => tier.key === d.priceTier)
                  : undefined;
                const eiTierPx = eiTier?.price != null
                  ? (item.useDiscount && eiTier.discountPrice != null ? eiTier.discountPrice : eiTier.price)
                  : null;
                const eiSysPx = isExtraCourse && item.courseId ? sysPrice(item.courseId) : 0;
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
                          {item.courseId && tierBooking && (
                            eiTier && eiTierPx != null ? (
                              <>
                                <span className="text-gray-300 select-none">|</span>
                                <span className="text-xs font-bold text-gray-600 whitespace-nowrap tabular-nums">
                                  {item.useDiscount && eiTier.discountPrice != null
                                    ? <><span className="text-gray-400 line-through mr-1">{formatMoney(eiTier.price, eiTier.currency)}</span>→ {formatMoney(eiTier.discountPrice, eiTier.currency)}</>
                                    : formatMoney(eiTier.price, eiTier.currency)}
                                </span>
                                {eiTier.discountPrice != null && !lockPrice && (
                                  <button type="button" onClick={() => updateItem({ useDiscount: !item.useDiscount })}
                                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                                    {item.useDiscount ? 'السعر الأساسي' : '🏷️ سعر الخصم'}
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="text-xs font-bold text-amber-700">{d.priceTier ? 'الكورس ده مش متسعّر للفرع ده' : 'اختار الفرع للكورس الأساسي الأول'}</span>
                            )
                          )}
                          {item.courseId && !tierBooking && eiSysPx > 0 && (
                            <span className="text-xs font-bold text-gray-500 whitespace-nowrap">{eiSysPx.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── 0: who is this for, when the screen did not start from them ── */}
          {subjectOptions && (
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1.5">العميل <span className="text-red-500">*</span></label>
              <select
                value={subject.id}
                onChange={e => onSubjectChange?.(e.target.value)}
                className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!subject.id ? 'border-red-400 bg-red-50 text-red-700' : 'border-gray-200 bg-white'}`}
              >
                <option value="">— اختر العميل —</option>
                {subjectOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.clientCode ? `${o.clientCode} — ${o.name}` : o.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* ── 7: new-customer identity ── */}
          {mode === 'new' && (
            <div className="space-y-3 border border-indigo-100 bg-indigo-50/40 rounded-xl p-3">
              <p className="text-[11px] font-bold text-indigo-700">بيانات العميل الجديد</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">{tierBooking ? 'الاسم بالعربي (ثلاثي)' : 'الاسم'} <span className="text-red-500">*</span></label>
                  <input
                    type="text" value={d.name || ''}
                    // In a course booking this is the real Arabic name the server records.
                    onChange={e => set({ name: e.target.value, nameAr: e.target.value })}
                    className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-semibold ${!(d.name || '').trim() ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5">الهاتف <span className="text-red-500">*</span></label>
                  <input
                    type="tel" dir="ltr" value={d.phone || ''}
                    onChange={e => set({ phone: latinDigits(e.target.value) })}
                    className={`w-full border-2 rounded-xl px-3 py-2 text-sm font-mono ${!(d.phone || '').trim() ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white'}`}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">البريد الإلكتروني <span className="text-gray-400 font-normal">(اختياري)</span></label>
                  <input
                    type="email" dir="ltr" placeholder="email@example.com"
                    value={d.email || ''}
                    onChange={e => set({ email: e.target.value })}
                    className={`w-full border rounded-xl px-3 py-2 text-sm font-mono ${d.email && !d.email.includes('@') ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                  />
                </div>
                {branchOptions.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1.5">الفرع</label>
                    <select
                      value={d.branch || ''}
                      onChange={e => set({ branch: e.target.value })}
                      className="w-full border-2 border-gray-200 bg-white rounded-xl px-3 py-2 text-sm font-semibold"
                    >
                      <option value="">— اختر الفرع —</option>
                      {branchOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── 7b: Lead-only: branch selector ── */}
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

          {/* ── 7a: «اسم العميل الحقيقي عربي ثلاثي وايضا اسمه بالانجليزي، وتاكيد علي
                رقم التليفون والرقم القومي» — with every new course booking. ── */}
          {tierBooking && d.courseId && (
            <div className="space-y-3 rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-3">
              <p className="text-xs font-extrabold text-emerald-800">بيانات العميل الحقيقية</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mode !== 'new' && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-bold text-gray-700">الاسم بالعربي (ثلاثي) <span className="text-red-500">*</span></span>
                    <input type="text" value={d.nameAr || ''} placeholder="مثال: أحمد محمد علي"
                      onChange={e => set({ nameAr: e.target.value })}
                      className={`w-full rounded-xl border-2 px-3 py-2 text-sm font-semibold ${arabicNameProblem(d.nameAr) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} />
                    {d.nameAr && arabicNameProblem(d.nameAr) && <span className="mt-1 block text-[11px] text-red-600">{arabicNameProblem(d.nameAr)}</span>}
                  </label>
                )}
                {mode === 'new' && d.name && arabicNameProblem(d.nameAr || d.name) && (
                  <p className="text-[11px] text-red-600 sm:col-span-2">{arabicNameProblem(d.nameAr || d.name)}</p>
                )}
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-700">الاسم بالإنجليزي</span>
                  <input type="text" dir="ltr" value={d.nameEn || ''} placeholder="Ahmed Mohamed Ali"
                    onChange={e => set({ nameEn: e.target.value })}
                    className={`w-full rounded-xl border px-3 py-2 text-sm ${englishNameProblem(d.nameEn) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} />
                  {englishNameProblem(d.nameEn) && <span className="mt-1 block text-[11px] text-red-600">{englishNameProblem(d.nameEn)}</span>}
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-700">{egyptianId ? 'الرقم القومي' : 'رقم الهوية / الجواز'}</span>
                  <input type="text" dir="ltr" inputMode={egyptianId ? 'numeric' : 'text'} value={d.nationalId || ''}
                    placeholder={egyptianId ? '14 رقم' : 'اختياري'}
                    onChange={e => set({ nationalId: latinDigits(e.target.value) })}
                    className={`w-full rounded-xl border px-3 py-2 text-sm font-mono ${nationalIdProblem(d.nationalId, egyptianId) ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`} />
                  {nationalIdProblem(d.nationalId, egyptianId) && <span className="mt-1 block text-[11px] text-red-600">{nationalIdProblem(d.nationalId, egyptianId)}</span>}
                </label>
                <label className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2 ${d.phoneConfirmed ? 'border-emerald-300 bg-white' : 'border-amber-300 bg-amber-50'}`}>
                  <input type="checkbox" checked={Boolean(d.phoneConfirmed)} onChange={e => set({ phoneConfirmed: e.target.checked })} className="h-4 w-4" />
                  <span className="text-xs font-bold text-gray-700">
                    أكّدت رقم التليفون مع العميل
                    <span dir="ltr" className="mr-1 font-mono text-gray-900">{personPhone || '—'}</span>
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* ── 7c: Dokki: seat the client in a round with the booking ── */}
          {canHouse && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3 py-2">
              <button
                type="button"
                onClick={() => setHousingOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100"
              >
                <Home size={13} /> تسكين في روند
              </button>
              {housingRound ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-indigo-900" title={roundLabel(housingRound, courses)}>{roundLabel(housingRound, courses)}</span>
                  <button type="button" onClick={() => set({ daqqiRoundId: '' })} className="text-xs font-bold text-red-500 hover:text-red-700" title="إلغاء التسكين">✕</button>
                </>
              ) : (
                <span className="text-xs text-indigo-700/80">اختياري — العميل بيتسكّن في الروند أول ما الحجز يتسجّل.</span>
              )}
            </div>
          )}
          {housingOpen && (
            <Modal open onClose={() => setHousingOpen(false)} layer="over" size="md" title="تسكين في روند" subtitle={personName || undefined} icon={<Home size={18} className="text-indigo-600" />}>
              <DaqqiRoundPicker
                rounds={daqqiRounds || []}
                courses={courses}
                selectedId={d.daqqiRoundId || ''}
                onSelect={roundId => { set({ daqqiRoundId: roundId }); setHousingOpen(false); }}
                clientCourseIds={(d.courseId?.startsWith('bundle:')
                  ? (bundles.find(b => b.id === d.courseId.replace('bundle:', ''))?.courses || []).map(c => c.id)
                  : d.courseId ? [d.courseId] : [])}
              />
            </Modal>
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
              {!tierBooking && <div>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">الرقم القومي <span className="text-gray-400 font-normal">(اختياري)</span></label>
                <input
                  type="text" dir="ltr" placeholder="14 رقم"
                  value={d.nationalId || ''}
                  onChange={e => set({ nationalId: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
                />
              </div>}
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
                  {_effPx > 0 && <><span className="text-gray-500">السعر:</span><span className="font-semibold">{_effPx.toLocaleString('ar-EG-u-nu-latn')} {d.currency}{_hasDiscount ? ' (بعد الخصم)' : ''}</span></>}
                  <span className="text-gray-500">المدفوع الآن:</span><span className="font-bold text-green-700">{_amtPaid.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span>
                  {_extraTotal > 0 && <><span className="text-gray-500">إضافات:</span><span className="font-semibold">+{_extraTotal.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
                  {_grandTotal > 0 && _extraTotal > 0 && <><span className="text-gray-500">الإجمالي:</span><span className="font-extrabold text-red-700">{_grandTotal.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
                  {_remaining > 0 && d.bookingType === 'new_booking' && <><span className="text-gray-500">المتبقي:</span><span className="font-bold text-amber-600">{_remaining.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
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
              <CreditCard size={16} /> {submitting ? 'جارٍ الحفظ...' : (mode === 'new' && _amtPaid === 0 ? 'إضافة العميل' : 'تسجيل الدفعة')}
            </button>
            <button
              onClick={() => { void handleSubmit(true); }}
              disabled={!isValid || submitting || _amtPaid === 0}
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
    </Modal>
  );
};

export default PaymentModal;
