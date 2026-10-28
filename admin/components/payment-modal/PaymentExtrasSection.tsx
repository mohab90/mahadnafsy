// «5» and «6»: the other items paid with this one — more courses, certificates, carnets or books — and the split of
// an instalment across the client's own courses.
import type { PaymentItemType } from '../../types';
import { formatMoney } from '../../lib/catalogPricing';
import type { ExtraPayItem } from './paymentDraft';
import type { PaymentModalModel } from './usePaymentModalModel';

export function PaymentExtrasSection({ m }: { m: PaymentModalModel }) {
  const {
    lockPrice, courses, bundles, certCatalog, extraItems, d, set, catalogPricing, sysPrice, tierBooking, _grandTotal,
    enrolledOptions, heldCids,
  } = m;
  return (
    <>
      {/* ── 5: Add extra items ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => set({ extraItems: [...(d.extraItems || []), { type: 'course', label: '', amount: '', courseId: '', discountPct: '', customExpected: '' }] })}
          className="text-xs text-blue-700 hover:text-blue-900 font-bold border border-blue-300 hover:border-blue-500 px-3 py-1.5 rounded-lg transition bg-blue-50 hover:bg-blue-100"
        >{d.bookingType === 'installment' ? '+ قسط على كورس تاني' : '+ إضافة كورس آخر'}</button>
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
                {item.type === 'certificate' && (
                  <select
                    value={item.certType || ''}
                    onChange={e => updateItem({ certType: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"
                  >
                    <option value="">— نوع الشهادة —</option>
                    {certCatalog.types.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
                  </select>
                )}
                {isExtraCourse && (
                  <>
                    <select
                      value={item.courseId || ''}
                      onChange={e => updateItem({
                        courseId: e.target.value, discountPct: '', customExpected: '',
                        // In an instalment, a course the client does not hold is a new booking.
                        newBooking: d.bookingType === 'installment' && !!e.target.value && !heldCids.has(e.target.value),
                      })}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-400"
                    >
                      <option value="">— اختر الكورس —</option>
                      {/* A split instalment is paid on the client's own courses, with what each still owes —
                          and any other course is booked new: «لازم يختار باقي الكورسات». */}
                      {d.bookingType === 'installment' && enrolledOptions.length > 0 ? (<>
                        <optgroup label="💳 قسط على كورسات العميل">
                          {enrolledOptions.filter(opt => opt.cid !== d.courseId).map(opt => (
                            <option key={opt.cid} value={opt.cid}>
                              {opt.isBnd ? '📌 ' : ''}{opt.label}{opt.remaining != null ? ` — متبقي ${opt.remaining.toLocaleString('ar-EG-u-nu-latn')}` : ''}
                            </option>
                          ))}
                        </optgroup>
                        {bundles.some(b => !heldCids.has(`bundle:${b.id}`)) && (
                          <optgroup label="🆕 حجز مسار جديد">
                            {bundles.filter(b => !heldCids.has(`bundle:${b.id}`)).map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="🆕 حجز كورس جديد">
                          {courses.filter(c => !heldCids.has(c.id)).map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}
                        </optgroup>
                      </>) : (<>
                        {bundles.length > 0 && <optgroup label="📌 المسارات">{bundles.map(b => <option key={`bundle:${b.id}`} value={`bundle:${b.id}`}>📌 {b.title}</option>)}</optgroup>}
                        <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>
                      </>)}
                    </select>
                    <div className="flex flex-wrap items-center gap-2 bg-red-50 border-2 border-red-200 rounded-xl px-3 py-2.5">
                      <span className="text-xs font-extrabold text-red-700 whitespace-nowrap">{d.bookingType === 'installment' && !item.newBooking ? '💳 مبلغ القسط' : '💰 المقدم'}<span className="text-red-500">*</span></span>
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
                      {item.courseId && item.newBooking && (
                        <>
                          <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-extrabold whitespace-nowrap">🆕 حجز جديد</span>
                          <label className="flex items-center gap-1 text-[11px] font-bold text-gray-600 whitespace-nowrap">
                            السعر المتفق عليه
                            <input
                              type="number" min="0" placeholder={eiSysPx > 0 ? String(eiSysPx) : 'اكتب السعر'} value={item.customExpected || ''}
                              onChange={e => updateItem({ customExpected: e.target.value })}
                              className="w-24 border border-gray-300 bg-white rounded-lg px-2 py-1 text-xs font-bold text-center"
                            />
                          </label>
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
    </>
  );
}
