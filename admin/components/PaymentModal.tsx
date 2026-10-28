/**
 * PaymentModal — unified payment/booking registration modal
 * Based on DaqqiScheduleTab design. Used in all payment locations.
 */
import type React from 'react';
import { type PhotoNeed } from '../lib/drivePhotos';
import { CreditCard } from 'lucide-react';
import type { PaymentItemType } from '../types';
import { Modal } from '../../shared/ui/Modal';
import { DISCOUNT_PERCENTS } from '../lib/catalogPricing';
import { priceIn } from '../lib/extraItemsCatalog';
import { RetakeDialog } from './RetakeDialog';
import type { PaymentDraft } from './payment-modal/paymentDraft';
import { PrintReceiptModal } from './payment-modal/PrintReceiptModal';
import { BOOKING_TONE, PAYMENT_TYPE_TILES } from './payment-modal/paymentTiles';
import { PhotoPicker } from './payment-modal/PhotoPicker';
import type { PaymentModalProps } from './payment-modal/paymentModalTypes';
import { usePaymentModalModel } from './payment-modal/usePaymentModalModel';
import { PaymentItemSection } from './payment-modal/PaymentItemSection';
import { PaymentExtrasSection } from './payment-modal/PaymentExtrasSection';
import { PaymentPersonSection } from './payment-modal/PaymentPersonSection';
// The draft, the receipt, the tiles, the pickers, the caller's types and the dialog's state (usePaymentModalModel) live
// beside this file in payment-modal/; the draft is re-exported, since every screen that opens the dialog imports it here.
export type { ExtraPayItem, PaymentDraft } from './payment-modal/paymentDraft';
export { blankPaymentDraft } from './payment-modal/paymentDraft';

const PaymentModal: React.FC<PaymentModalProps> = (props) => {
  const m = usePaymentModalModel(props);
  const {
    mode, subject, onClose, requirePaymentApproval, lockPrice, courses, staffMembers, canSetPrice, printData,
    setPrintData, submitting, submitError, driveOn, photos, photoOnFile, photoBusy, photoError, asksWhoBroughtIt,
    broughtBy, setBroughtBy, setUpgradeFrom, d, set, tracksOnly, setTracksOnly, personName, courseLabel, tierBooking,
    chosenTier, tierPct, bookingBranch, _effPx, _hasDiscount, _amtPaid, noteField, _extraTotal, _grandTotal,
    _remaining, coursePayMap, enrolledOptions, tracksHolding, retakeOpen, setRetakeOpen, retakeOptions, canRetake,
    upgradeCandidates, upgrading, payTotalExpected, payTotalPaid, payRemaining, paymentMethods, certificatesTyped,
    photoNeed, pickPhoto, isValid, handleSubmit, isCourse, isCert, extraOptions,
  } = m;

  // ── Show print receipt if needed ───────────────────────────────────────
  if (printData) {
    return (
      <PrintReceiptModal
        data={printData}
        onClose={() => { setPrintData(null); onClose(); }}
      />
    );
  }

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
          <div className={`grid gap-2 ${canRetake && upgradeCandidates.length ? 'grid-cols-4' : canRetake || upgradeCandidates.length ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {[
              { v: 'new_booking', ic: '🆕', lb: 'حجز جديد' }, { v: 'installment', ic: '💳', lb: 'قسط' },
              ...(canRetake ? [{ v: 'retake', ic: '🔁', lb: 'إعادة' }] : []),
              ...(upgradeCandidates.length ? [{ v: 'upgrade', ic: '⬆️', lb: 'تكملة لمسار' }] : []),
            ].map(opt => (
              <button
                key={opt.v}
                type="button"
                onClick={() => {
                  // «إعادة»: its own small dialog (RetakeDialog) — the course is the one already taken, at 50% off.
                  if (opt.v === 'retake') { setRetakeOpen(true); return; }
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
                className={`group flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-extrabold transition ${(opt.v === 'upgrade' ? upgrading : opt.v === 'retake' ? retakeOpen : !upgrading && d.bookingType === opt.v) ? `${BOOKING_TONE[opt.v].on} text-white shadow-md` : `bg-white ${BOOKING_TONE[opt.v].off}`}`}
              >
                <span className={`grid h-7 w-7 place-items-center rounded-lg text-base ${(opt.v === 'upgrade' ? upgrading : opt.v === 'retake' ? retakeOpen : !upgrading && d.bookingType === opt.v) ? 'bg-white/25' : BOOKING_TONE[opt.v].tile}`}>{opt.ic}</span>{opt.lb}
              </button>
            ))}
          </div>

          {/* ── 2: Payment type chips — one tile each, in its own colour; «مسار» is the tracks of the catalogue ── */}
          <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-gray-100 bg-gray-50 p-1.5 sm:grid-cols-7">
            {PAYMENT_TYPE_TILES.map(opt => {
              const on = opt.v === 'track' ? (d.paymentType === 'course' && tracksOnly) : (d.paymentType === opt.v && !(opt.v === 'course' && tracksOnly));
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => {
                    setUpgradeFrom(null);
                    setTracksOnly(opt.v === 'track');
                    set({ paymentType: (opt.v === 'track' ? 'course' : opt.v) as PaymentItemType, courseId: '', certReqId: '', certType: '', itemTitle: '' });
                  }}
                  className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border-2 text-[11px] font-extrabold leading-none transition ${on ? `${opt.on} text-white shadow-md` : `bg-white ${opt.off}`}`}
                >
                  <span className="text-lg leading-none">{opt.ic}</span>{opt.lb}
                </button>
              );
            })}
          </div>

          <PaymentItemSection m={m} />
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
            {/* «جمب المقدم زر الخصم 5 و10 … و50% وايضا زر الخصم اللي مرفوع من الكورسات» */}
            {tierBooking && chosenTier && !lockPrice && (
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="الخصم">
                <span className="text-[11px] font-bold text-gray-500">خصم:</span>
                {chosenTier.discountPrice != null && (
                  <button type="button" onClick={() => set({ useDiscount: !d.useDiscount, tierDiscountPct: 0, customPriceOn: false })} aria-pressed={Boolean(d.useDiscount)}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-extrabold transition ${d.useDiscount ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50'}`}>
                    🏷️ خصم الكورس
                  </button>
                )}
                {/* «خلي خصم النسب يكون في قايمه منسدله» */}
                <select value={tierPct} aria-label="نسبة الخصم"
                  onChange={e => set({ tierDiscountPct: Number(e.target.value) || 0, useDiscount: false, customPriceOn: false })}
                  className={`rounded-lg border px-2 py-1 text-[11px] font-extrabold tabular-nums ${tierPct ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-300 bg-white text-gray-700'}`}>
                  <option value={0}>نسبة خصم…</option>
                  {DISCOUNT_PERCENTS.map(pct => <option key={pct} value={pct}>خصم {pct}%</option>)}
                </select>
                {canSetPrice && (<>
                  <button type="button" aria-pressed={Boolean(d.customPriceOn)}
                    onClick={() => set({ customPriceOn: !d.customPriceOn, customExpected: '', useDiscount: false, tierDiscountPct: 0 })}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-extrabold transition ${d.customPriceOn ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-indigo-300 bg-white text-indigo-800 hover:bg-indigo-50'}`}>
                    ✏️ سعر مختلف
                  </button>
                  {d.customPriceOn && (
                    <input type="number" min="1" placeholder="سعر العميل" value={d.customExpected} aria-label="سعر العميل"
                      onChange={e => set({ customExpected: e.target.value })}
                      className="w-24 rounded-lg border-2 border-indigo-400 bg-white px-2 py-1 text-xs font-extrabold text-indigo-900" />
                  )}
                </>)}
              </div>
            )}
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

          {/* ── 4b: the pictures a certificate or a carnet asks for → Google Drive ── */}
          {(photoNeed.personal || photoNeed.id) && (
            <div className="border-2 border-sky-200 bg-sky-50/60 rounded-xl p-3 space-y-2">
              <p className="text-xs font-extrabold text-sky-800">📷 الصور المطلوبة (بتترفع على جوجل درايف)</p>
              {driveOn === false && (
                <p className="text-[11px] font-bold text-amber-700">رفع الصور على جوجل درايف لسه غير مُفعّل — الصورة مش مطلوبة دلوقتي، وهتتطلب أول ما المسئول يفعّله.</p>
              )}
              {(['personal', 'id'] as const).filter(kind => photoNeed[kind]).map(kind => (
                <PhotoPicker
                  key={kind}
                  kind={kind}
                  need={photoNeed[kind] as PhotoNeed}
                  uploaded={photos[kind]}
                  onFile={photoOnFile[kind]}
                  busy={photoBusy === kind}
                  disabled={driveOn !== true || photoBusy !== null}
                  onPick={file => pickPhoto(kind, file)}
                />
              ))}
              {photoError && <p className="text-[11px] font-bold text-red-600">{photoError}</p>}
            </div>
          )}

          <PaymentExtrasSection m={m} />
          <PaymentPersonSection m={m} />
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
          {/* The transfer: its operation number, who sent it and from which number — optional; when typed, the accounts desk
              sees them on the payments page and matches the money by them. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {([
              { key: 'transactionId', label: 'رقم العملية', dir: 'ltr', mono: true },
              { key: 'senderName', label: 'اسم المحوّل', dir: 'rtl', mono: false },
              { key: 'fromAccountNumber', label: 'تليفون / حساب المحوّل', dir: 'ltr', mono: true },
            ] as const).map(field => {
              return (
                <div key={field.key}>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5">
                    {field.label} <span className="text-gray-400 font-normal">(اختياري)</span>
                  </label>
                  <input
                    type="text" dir={field.dir} value={d[field.key]}
                    onChange={e => set({ [field.key]: e.target.value } as Partial<PaymentDraft>)}
                    className={`w-full border rounded-xl px-3 py-2 text-sm ${field.mono ? 'font-mono' : ''} border-gray-200`}
                  />
                </div>
              );
            })}
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
              {noteField}
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
          {/* «خلي مربع الملاحظات جمب البريد الالكتروني وبنفس حجمه»: beside the email
              where there is one (a lead, a new client booking a course), alone otherwise. */}
          {!(mode === 'lead' || (mode === 'new' && tierBooking)) && noteField}

          {/* ── 9: Payment summary ── */}
          {_amtPaid > 0 && (() => {
            const typeLabel: Record<string, string> = { course: 'كورس', certificate: 'شهادة', consultation: 'استشارة', book: 'كتاب', carneh: 'كارنيه', other: 'أخرى' };
            const cLabel = d.courseId ? (d.courseId.startsWith('bundle:') ? '📌 ' : '🎓 ') + courseLabel(d.courseId) : '';
            // A carnet or a book is its own service: its own price and its own balance. The course it is linked to is only
            // named — its price and what is left on it are not this payment's («ليه دخل فلوس الكارنيه في فلوس الكورس؟»).
            const isItem = d.paymentType === 'carneh' || d.paymentType === 'book';
            const chosenItem = isItem ? extraOptions.find(option => option.label === d.itemTitle) : undefined;
            const itemPrice = isItem ? (chosenItem ? priceIn(chosenItem, d.currency) : 0) || _amtPaid : 0;
            return (
              <div className="bg-gradient-to-l from-gray-50 to-blue-50/60 border border-blue-200 rounded-xl p-3 space-y-1.5">
                <p className="font-extrabold text-gray-800 text-sm">📋 ملخص الدفعة</p>
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <span className="text-gray-500">نوع الخدمة:</span><span className="font-semibold">{typeLabel[d.paymentType] || d.paymentType}{isItem && d.itemTitle ? ` — ${d.itemTitle}` : ''}</span>
                  {cLabel && <><span className="text-gray-500">{isItem ? 'مرتبط بكورس:' : 'الكورس:'}</span><span className="font-semibold">{cLabel}</span></>}
                  {isItem && <><span className="text-gray-500">السعر:</span><span className="font-semibold">{itemPrice.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
                  {!isItem && _effPx > 0 && <><span className="text-gray-500">السعر:</span><span className="font-semibold">{_effPx.toLocaleString('ar-EG-u-nu-latn')} {d.currency}{_hasDiscount ? ' (بعد الخصم)' : ''}</span></>}
                  <span className="text-gray-500">المدفوع الآن:</span><span className="font-bold text-green-700">{_amtPaid.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span>
                  {_extraTotal > 0 && <><span className="text-gray-500">إضافات:</span><span className="font-semibold">+{_extraTotal.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
                  {_grandTotal > 0 && _extraTotal > 0 && <><span className="text-gray-500">الإجمالي:</span><span className="font-extrabold text-red-700">{_grandTotal.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
                  {isItem && <><span className="text-gray-500">المتبقي:</span><span className={`font-bold ${itemPrice - _amtPaid > 0 ? 'text-amber-600' : 'text-green-700'}`}>{Math.max(0, itemPrice - _amtPaid).toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
                  {!isItem && _remaining > 0 && d.bookingType === 'new_booking' && <><span className="text-gray-500">المتبقي:</span><span className="font-bold text-amber-600">{_remaining.toLocaleString('ar-EG-u-nu-latn')} {d.currency}</span></>}
                  {requirePaymentApproval && <><span className="text-gray-500">الحالة:</span><span className="font-bold text-amber-600">⏳ بانتظار الموافقة</span></>}
                </div>
              </div>
            );
          })()}

          {/* ── 10: Submit buttons ── */}
          {!certificatesTyped && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              اختار نوع الشهادة قبل تسجيل دفعها
            </div>
          )}
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
        {retakeOpen && (
          <RetakeDialog
            subjectId={subject.id}
            subjectName={subject.name}
            options={retakeOptions.map(opt => ({ cid: opt.cid, label: opt.label, remaining: opt.remaining }))}
            courses={courses}
            currency={d.currency}
            branch={bookingBranch || undefined}
            paymentMethods={paymentMethods}
            onClose={() => setRetakeOpen(false)}
            onDone={() => { setRetakeOpen(false); onClose(); }}
          />
        )}
    </Modal>
  );
};

export default PaymentModal;
