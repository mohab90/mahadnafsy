// The payment dialog's state and everything worked out from it: the draft and its setter, the catalogue prices and
// the branch tier, what the client holds and has paid, the totals, the photos, the housing, and the submit handler.
// PaymentModal.tsx draws it; the sections beside this file (PaymentItemSection, PaymentExtrasSection,
// PaymentPersonSection) draw their parts of it from the same model.
import { useEffect, useState } from 'react';
import { arabicReason } from '../../lib/apiErrorText';
import { attachPhotosToNextPayment, fetchClientPhotoLinks, photoNeeds, uploadClientPhoto, useDriveConfigured, type PhotoKind, type PhotoLinks } from '../../lib/drivePhotos';
import { useCrmData, useStaticData } from '../../context/siteDataSlices';
import { useEnsureSiteLists } from '../../context/SiteDataContext';
import { useCertificateCatalog } from '../../lib/certificateCatalog';
import { agreedPriceFor } from '../../lib/agreedPrice';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { attributeNextPayment } from '../../lib/paymentAttribution';
import { forgetReceipts, takeReceiptLabel } from '../../lib/lastReceipt';
import type { DaqqiRound } from '../../types';
import { usePaymentBoxes } from '../../lib/paymentMethods';
import { confirmDialog } from '../../../shared/ui/confirmDialog';
import { hasPermission, type PermissionKey, type RoleKey } from '../../constants/permissions';
import { getCatalogPricing, tierForBranch, type CatalogPricing, type TierPrice } from '../../lib/catalogPricing';
import { arabicNameProblem, englishNameProblem, nationalIdProblem } from '../../lib/bookingIdentity';
import { priceIn, useExtraItemsCatalog } from '../../lib/extraItemsCatalog';
import type { ExtraPayItem, PaymentDraft } from './paymentDraft';
import { type PrintData } from './PrintReceiptModal';
import { clientHoldings } from './clientHoldings';
import type { PaymentModalProps } from './paymentModalTypes';

export function usePaymentModalModel({
  mode, subject, draft, setDraft, onSubmit, onClose,
  requirePaymentApproval, lockPrice = false, branchOptions = [], instituteName = 'معهد الدراسات النفسية',
  subjectOptions, subjectSearch, onSubjectChange,
  branchLabel,
}: PaymentModalProps) {
  const { courses, bundles, content, authUser, isAdmin } = useStaticData();
  const { staffMembers, daqqiRounds, currentStaff } = useCrmData();
  // The rounds a booking can join — opened from any screen, so it asks for them.
  useEnsureSiteLists(['daqqiRounds']);
  // «رجع يظهر للمديرين ولحساب هنا فقط انه يدخل سعر مختلف للعميل».
  const canSetPrice = isAdmin || hasPermission(currentStaff
    ? { role: currentStaff.role as RoleKey, permissions: currentStaff.permissions as PermissionKey[] | undefined } : null,
    'set_client_price');
  // The certificates «تسعير الشهادات» lists — its own, not eight written here.
  const certCatalog = useCertificateCatalog();
  const extraItems = useExtraItemsCatalog();
  const [printData, setPrintData] = useState<PrintData | null>(null);
  // Escape closes the dialog and focus starts inside it. The Daqqi desk had
  // this on its own copy of this modal and every other payment screen did not;
  // now they are the same screen, it belongs here. Called before the printData
  // early return below, and told whether it is live — a hook after a return
  // runs on some renders and not others.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // The pictures a certificate or a carnet asks for: to Google Drive at once, and only
  // the link is kept (lib/drivePhotos.ts). A client who already has one on file is not asked again.
  const driveOn = useDriveConfigured();
  const [photos, setPhotos] = useState<PhotoLinks>({});
  const [photoOnFile, setPhotoOnFile] = useState<{ personal: string | null; id: string | null }>({ personal: null, id: null });
  const [photoBusy, setPhotoBusy] = useState<PhotoKind | null>(null);
  const [photoError, setPhotoError] = useState('');
  useEffect(() => {
    // Never another client's links while this one's are on their way.
    setPhotoOnFile({ personal: null, id: null });
    if (mode !== 'subscriber' || !subject.id) return undefined;
    let alive = true;
    fetchClientPhotoLinks(subject.id).then(links => { if (alive) setPhotoOnFile(links); });
    return () => { alive = false; };
  }, [mode, subject.id]);
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

  // «تسكين»: a Dokki or Tagamoa booking can seat the client in a round as it is
  // recorded. The button shows once the booking's branch is one of them (see
  // bookingBranch below) and there are open rounds there.
  const [housingOpen, setHousingOpen] = useState(false);
  // «مسار»: the course picker lists the catalogue's tracks only.
  const [tracksOnly, setTracksOnly] = useState(false);
  // The dashboard loads the rounds for manage_daqqi alone; anyone else booking a
  // client there reads the booking list (api/routes/daqqi-rounds.js for-booking).
  const [bookingRounds, setBookingRounds] = useState<DaqqiRound[]>([]);

  // Who this payment is for. In 'new' mode they do not exist yet, so it is
  // whoever is being typed into the form.
  const personName = mode === 'new' ? (d.name || '').trim() : subject.name;
  // A number changed in the confirmation line (components/PhoneConfirm.tsx) holds for the rest of this booking.
  const [phoneNow, setPhoneNow] = useState<string | null>(null);
  const [phone2Now, setPhone2Now] = useState<string | null>(null);
  const personPhone = mode === 'new' ? (d.phone || '').trim() : (phoneNow ?? subject.phone);
  const personPhone2 = mode === 'new' ? (d.phone2 || '').trim() : (phone2Now ?? subject.phone2 ?? '');

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
  const tierPct = Number(d.tierDiscountPct) || 0;
  const tierPx = chosenTier?.price != null
    ? (tierPct ? Math.round(chosenTier.price * (100 - tierPct) / 100)
      : d.useDiscount && chosenTier.discountPrice != null ? chosenTier.discountPrice : chosenTier.price)
    : null;
  // The branch the booking is for: the branch price chosen, else the client's.
  // An online client booked at the Dokki price kept their own branch here, so
  // «تسكين العملاء» never appeared for them.
  const bookingBranch = String(chosenTier?.branch || (mode === 'subscriber' ? (subject.coursePlacements?.[d.courseId] || subject.branch || d.branch) : d.branch) || '')
    .toUpperCase().replace(/[-\s]/g, '_');
  const housesClients = bookingBranch === 'DAQQI' || bookingBranch === 'TAGAMOA';
  const storeHasRounds = (daqqiRounds || []).length > 0;
  useEffect(() => {
    if (!housesClients || storeHasRounds || d.bookingType !== 'new_booking') return;
    let alive = true;
    mysqlAdmin.listDaqqiRoundsForBooking(bookingBranch)
      .then(rows => { if (alive) setBookingRounds(rows as unknown as DaqqiRound[]); })
      .catch(() => { if (alive) setBookingRounds([]); });
    return () => { alive = false; };
  }, [housesClients, storeHasRounds, bookingBranch, d.bookingType]);
  const housingRounds = (storeHasRounds ? daqqiRounds || [] : bookingRounds)
    .filter(round => !round.branch || String(round.branch).toUpperCase() === bookingBranch);
  const canHouse = housesClients && d.bookingType === 'new_booking' && housingRounds.length > 0;
  const housingRound = d.daqqiRoundId ? housingRounds.find(round => round.id === d.daqqiRoundId) : undefined;
  const chooseTier = (tier: TierPrice) => set({
    priceTier: tier.key,
    useDiscount: false,
    tierDiscountPct: 0,
    customPriceOn: false,
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
      courseId, customExpected: '', discountPct: '', useDiscount: false, tierDiscountPct: 0, customPriceOn: false,
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
  const _clientPx = canSetPrice && d.customPriceOn ? Number(d.customExpected) || 0 : 0;
  const _effPx = tierBooking
    ? (_clientPx > 0 ? _clientPx : tierPx ?? 0)
    : (_customExp > 0 ? _customExp : (_discPct > 0 && _basePx > 0 ? Math.round(_basePx * (1 - _discPct / 100)) : _basePx));
  const _hasDiscount = tierBooking ? Boolean(tierPct || (d.useDiscount && chosenTier?.discountPrice != null)) : (_effPx > 0 && _sysPx > 0 && _effPx < _sysPx);
  const _amtPaid = Number(d.amount) || 0;
  const noteField = (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1.5">ملاحظة <span className="text-gray-400 font-normal">(اختياري)</span></label>
      <input
        type="text" placeholder="اختياري"
        value={d.note}
        onChange={e => set({ note: e.target.value })}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm"
      />
    </div>
  );
  const _extraTotal = (d.extraItems || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const _grandTotal = _amtPaid + _extraTotal;
  const _remaining = _effPx > 0 && _amtPaid > 0 ? Math.max(0, _effPx - _amtPaid) : 0;

  // What the client holds and has paid towards each (payment-modal/clientHoldings.ts): refunds and failed payments are
  // not money collected, and a course counts as held by its enrolment, its money, its agreed price or its housing.
  const { payHistory, coursePayMap, enrolledOptions, heldCids } = clientHoldings(subject, courses, bundles, d.currency);

  // The totals bar: every course and track they hold, at the price agreed.
  // It summed only bookings that had recorded a price — a quarter had none —
  // and counted certificate and book money as paid towards the courses.
  // «تكملة يعني العميل يحول الكورس الصغير لمسار»: a course they hold that some
  // track contains, and the tracks it can grow into.
  const tracksHolding = (courseId: string) => bundles.filter(b => (b.courses || []).some(course => course.id === courseId));
  // «إعادة»: only for a client who holds a course (not a track) — the one they take again.
  const [retakeOpen, setRetakeOpen] = useState(false);
  const retakeOptions = enrolledOptions.filter(opt => !opt.isBnd);
  const canRetake = mode === 'subscriber' && Boolean(subject.id) && retakeOptions.length > 0;
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
  //
  // In pounds the list has two prices, the Egyptian's and the resident non-Egyptian's: «سعر العميل الغير مصري مختلف ليه بيظهر
  // للموظفين كأنه مصري». A request already open carries its client's nationality, which picks between them (the server
  // reads the list the same way: api/lib/certificatePricing.js basePriceForCurrency).
  const certBasePrice = (type: string, currency: string): number => {
    const tiers = certCatalog.map[type];
    if (!tiers) return 0;
    if (currency === 'SAR') return Number(tiers.residentSAR) || 0;
    if (currency === 'USD') return Number(tiers.foreignUSD) || 0;
    const nationality = certRequests.find(request => request.id === d.certReqId)?.nationality;
    if (nationality === 'non_egyptian_egypt') return Number(tiers.residentEGP) || Number(tiers.egyptianEGP) || 0;
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
  const subjectChosen = (!subjectOptions && !subjectSearch) || !!subject.id;
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
  // A certificate is paid as one of the catalogue's types or on a request
  // already open — the main item and any extra one. Sent without either, the
  // server refused it in English: 17 times on 5–7 Oct.
  const certificatesTyped = (d.paymentType !== 'certificate' || !!d.certReqId || !!d.certType)
    && (d.extraItems || []).every(item => item.type !== 'certificate' || !(Number(item.amount) > 0) || !!item.certType);
  // «شهادة البورد لازم صورة، والكارنيه لازم صورة، واي توثيق لازم صورة الهوية» — asked for
  // only once Drive is set up, so a missing setting does not stop the desk booking.
  const photoNeed = photoNeeds(d, type => certCatalog.label(type));
  const photoMissing = driveOn === true && photoBusy === null && (
    (photoNeed.personal === 'required' && !photos.personal && !photoOnFile.personal)
    || (photoNeed.id === 'required' && !photos.id && !photoOnFile.id));
  const pickPhoto = async (kind: PhotoKind, file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(kind);
    setPhotoError('');
    try {
      const url = await uploadClientPhoto(file, kind, { clientName: personName });
      setPhotos(previous => ({ ...previous, [kind]: url }));
    } catch (error) {
      setPhotoError(arabicReason(error, 'تعذّر رفع الصورة'));
    } finally {
      setPhotoBusy(null);
    }
  };
  // «رقم العملية واسم المحوّل ورقم المحوّل مينفعش يكونوا إجباري — سيبهم اختياري لكن لما الموظف يدخلهم يظهروا في صفحة المدفوعات»
  // (20 Oct 2026): they never stop a booking; when typed, they travel with the payment to the payments page.
  const isValid = !subjectChosen || !certificatesTyped || photoMissing || photoBusy !== null ? false : tierProblem || identityProblem ? false : mode === 'new'
    ? hasIdentity && (_amtPaid === 0 || (!!d.paymentMethod && (d.paymentType !== 'course' || !!d.courseId)))
    : _amtPaid > 0 && !!d.paymentMethod && (mode === 'lead' ? !!d.branch : true)
      && (!upgrading || (!!upgradeFrom && d.courseId.startsWith('bundle:')));

  // ── Build print data ───────────────────────────────────────────────────
  const buildPrintData = (): PrintData => {
    // A carnet or a book is its own service: the receipt carries its price and its balance, not the linked course's.
    const itemService = d.paymentType === 'carneh' || d.paymentType === 'book';
    const chosenService = itemService ? extraOptions.find(option => option.label === d.itemTitle) : undefined;
    const servicePrice = itemService ? (chosenService ? priceIn(chosenService, d.currency) : 0) || _amtPaid : 0;
    const prevPaid = itemService ? 0 : payHistory.filter(p => p.currency === d.currency && (!p.courseId || p.courseId === d.courseId)).reduce((s, p) => s + Number(p.amount), 0);
    const extraTotalForPrint = (d.extraItems || []).filter(i => i.amount && Number(i.amount) > 0).reduce((s, i) => s + Number(i.amount), 0);
    const newTotal = prevPaid + _amtPaid + extraTotalForPrint;
    const remaining = itemService ? Math.max(0, servicePrice - newTotal) : (_effPx > 0 ? Math.max(0, _effPx - newTotal) : 0);
    const staffName = authUser?.displayName || authUser?.email?.split('@')[0] || 'موظف';
    const label = itemService ? (d.itemTitle || (d.paymentType === 'carneh' ? 'كارنيه' : 'كتاب')) : (courseLabel(d.courseId) || d.paymentType);
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
      courseExpected: itemService ? servicePrice : _effPx,
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
    // A carnet or a book names «الكورس المرتبط» without paying for it, so it is
    // never «over the remaining» on that course (8 Oct 2026).
    const left = d.paymentType === 'course' && chosen && _effPx > 0 ? Math.max(0, _effPx - chosen.paid) : null;
    if (!upgrading && left !== null && _amtPaid > left && !await confirmDialog({
      title: 'المبلغ أكبر من المتبقي',
      message: `${_amtPaid.toLocaleString('ar-EG-u-nu-latn')} ${d.currency} أكبر من المتبقي على «${chosen?.label}» (${left.toLocaleString('ar-EG-u-nu-latn')}). تسجّلها كده؟`,
      confirmLabel: 'سجّلها',
    })) return;
    setSubmitting(true);
    setSubmitError('');
    forgetReceipts();
    // The receipt carries the branch's number once the save has been answered with it.
    const finishWith = (payload: PrintData | null) => {
      const receiptNo = takeReceiptLabel();
      if (payload) setPrintData(receiptNo ? { ...payload, receiptNo } : payload);
      else onClose();
    };
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
      attachPhotosToNextPayment({
        personal: photoNeed.personal ? photos.personal : undefined,
        id: photoNeed.id ? photos.id : undefined,
      });
      if (upgrading && upgradeFrom) {
        // The course becomes part of the track first, its money with it; the
        // payment is then an instalment on the track, at the price set here.
        await mysqlAdmin.adminPost(`/admin/subscribers/${encodeURIComponent(subject.id)}/course-upgrade`, {
          item: upgradeFrom, toItem: d.courseId, price: changedPrice ? Number(shownPrice) : null,
        });
        await onSubmit({ ...d, bookingType: 'installment', customExpected: '' }, shouldPrint);
        finishWith(printPayload);
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
        finishWith(printPayload);
        return;
      }
      await onSubmit({
        ...d,
        customExpected: d.bookingType === 'installment'
          ? (changedPrice ? shownPrice : '')
          : (changedPrice || (_effPx > 0 && _effPx !== _sysPx) ? shownPrice : d.customExpected),
      }, shouldPrint);
      finishWith(printPayload);
    } catch (error) {
      setSubmitError(arabicReason(error, 'تعذر حفظ الدفعة'));
    } finally {
      // Never carried to a later payment, whatever happened to this one.
      attributeNextPayment(null);
      attachPhotosToNextPayment(null);
      setSubmitting(false);
    }
  };

  // ── Main modal render ──────────────────────────────────────────────────
  const isCourse = d.paymentType === 'course';
  const isCert = d.paymentType === 'certificate';
  const isConsultation = d.paymentType === 'consultation';
  const isBookOrCarneh = d.paymentType === 'book' || d.paymentType === 'carneh';
  const extraOptions = d.paymentType === 'carneh' ? extraItems.carnets : d.paymentType === 'book' ? extraItems.books : [];

  return {
    mode, subject, draft, setDraft, onSubmit, onClose, requirePaymentApproval, lockPrice, branchOptions, instituteName, subjectOptions, subjectSearch, onSubjectChange, branchLabel, courses, bundles, content, authUser, isAdmin, staffMembers, daqqiRounds, currentStaff, canSetPrice, certCatalog, extraItems, printData, setPrintData, submitting, setSubmitting, submitError, setSubmitError, driveOn, photos, setPhotos, photoOnFile, setPhotoOnFile, photoBusy, setPhotoBusy, photoError, setPhotoError, ownEmail, asksWhoBroughtIt, broughtBy, setBroughtBy, upgradeFrom, setUpgradeFrom, d, set, catalogPricing, setCatalogPricing, pricingError, setPricingError, housingOpen, setHousingOpen, tracksOnly, setTracksOnly, bookingRounds, setBookingRounds, personName, phoneNow, setPhoneNow, phone2Now, setPhone2Now, personPhone, personPhone2, sysPrice, courseLabel, tierBooking, itemPricing, tierOptions, chosenTier, tierPct, tierPx, bookingBranch, housesClients, storeHasRounds, housingRounds, canHouse, housingRound, chooseTier, extraTierPrice, pickCourse, _sysPx, _agreedPx, _basePx, _customExp, _discPct, _clientPx, _effPx, _hasDiscount, _amtPaid, noteField, _extraTotal, _grandTotal, _remaining, payHistory, coursePayMap, enrolledOptions, heldCids, tracksHolding, retakeOpen, setRetakeOpen, retakeOptions, canRetake, upgradeCandidates, upgrading, upgradeSource, payTotalExpected, payTotalPaid, payRemaining, certRequests, certBasePrice, paymentMethods, hasIdentity, subjectChosen, tierProblem, egyptianId, identityProblem, certificatesTyped, photoNeed, photoMissing, pickPhoto, isValid, buildPrintData, handleSubmit, isCourse, isCert, isConsultation, isBookOrCarneh, extraOptions,
  };
}

export type PaymentModalModel = ReturnType<typeof usePaymentModalModel>;
