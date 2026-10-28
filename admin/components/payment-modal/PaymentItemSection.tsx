// «3»: what the payment is for — the course, track, certificate, carnet, book or consultation, the branch price
// for a new course booking, the instalment's course, the course being completed into a track.
import { formatMoney } from '../../lib/catalogPricing';
import { priceIn } from '../../lib/extraItemsCatalog';
import type { PaymentDraft } from './paymentDraft';
import type { PaymentModalModel } from './usePaymentModalModel';

export function PaymentItemSection({ m }: { m: PaymentModalModel }) {
  const {
    courses, bundles, certCatalog, upgradeFrom, setUpgradeFrom, d, set, catalogPricing, pricingError, tracksOnly,
    tierBooking, tierOptions, chosenTier, tierPct, tierPx, chooseTier, pickCourse, _effPx, _hasDiscount, _amtPaid,
    enrolledOptions, tracksHolding, upgradeCandidates, upgrading, upgradeSource, certRequests, certBasePrice,
    tierProblem, isCourse, isCert, isConsultation, isBookOrCarneh, extraOptions,
  } = m;
  return (
    <>
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
          {/* «اقدر اضيف اكتر من كارنيه واكتر من كتاب واضيف الاسعار» — from الإعدادات ← أسعار الشهادات. */}
          {extraOptions.length > 0 && (
            <div className="mb-3">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{d.paymentType === 'carneh' ? 'الكارنيه' : 'الكتاب'}</label>
              <div className="flex flex-wrap gap-1.5">
                {extraOptions.map(item => {
                  const price = priceIn(item, d.currency);
                  return (
                    <button key={item.id} type="button" onClick={() => set({ itemTitle: item.label, ...(price > 0 ? { amount: String(price) } : {}) })}
                      className={`rounded-xl border-2 px-3 py-1.5 text-xs font-bold transition ${d.itemTitle === item.label ? 'border-red-500 bg-red-50 text-red-800' : 'border-gray-200 bg-white text-gray-700 hover:border-red-300'}`}>
                      {item.label}{price > 0 ? ` · ${price.toLocaleString('ar-EG-u-nu-latn')} ${d.currency}` : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
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
                {!(tracksOnly && isCourse) && <optgroup label="🎓 الكورسات">{courses.map(c => <option key={c.id} value={c.id}>{c.titleAr || c.title}</option>)}</optgroup>}
              </select>
            )}
            {/* «يختار الكورس وبعدها يختار الفرع وقتها يظهر السعر … بالعمله بتاعته ويظهر اوبشنز الخصم» */}
            {tierBooking && d.courseId && (
              <div className="mt-3 rounded-xl border-2 border-gray-200 bg-white p-3">
                <p className="mb-2 text-xs font-extrabold text-gray-700">الفرع <span className="text-red-500">*</span> <span className="font-normal text-gray-400">— السعر بيظهر بعملة الفرع</span></p>
                {!catalogPricing && !pricingError && <p className="text-xs text-gray-400">بنحمّل أسعار الفروع…</p>}
                {pricingError && <p className="text-xs font-bold text-red-600">{pricingError}</p>}
                {/* «مينفعش يظهر كل الاسعار دي — يظهر السعر بناءا علي الفرع اللى بيختار»:
                    the branches as a list, and only the chosen one's price. */}
                {catalogPricing && (
                  <select
                    value={d.priceTier || ''}
                    onChange={e => { const tier = tierOptions.find(t => t.key === e.target.value); if (tier) chooseTier(tier); }}
                    className={`w-full rounded-xl border-2 px-3 py-2 text-sm font-semibold ${d.priceTier ? 'border-gray-200 bg-white' : 'border-red-400 bg-red-50 text-red-700'}`}
                  >
                    <option value="">— اختار الفرع —</option>
                    {tierOptions.map(tier => (
                      <option key={tier.key} value={tier.key} disabled={tier.price == null}>
                        {tier.label}{tier.price == null ? ' (مش متسعّر)' : ''}
                      </option>
                    ))}
                  </select>
                )}
                {chosenTier && tierPx != null && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <span className="text-xs font-bold text-gray-500">سعر الكورس في {chosenTier.label}:</span>
                    {_hasDiscount ? (
                      <>
                        <span className="text-xs text-gray-400 line-through tabular-nums">{formatMoney(chosenTier.price, chosenTier.currency)}</span>
                        <span className="text-base font-extrabold text-emerald-700 tabular-nums">{formatMoney(tierPx, chosenTier.currency)}</span>
                        <span className="text-[11px] font-bold text-emerald-700">{tierPct ? `خصم ${tierPct}%` : 'سعر الخصم'}</span>
                      </>
                    ) : (
                      <span className="text-base font-extrabold text-gray-900 tabular-nums">{formatMoney(chosenTier.price, chosenTier.currency)}</span>
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
    </>
  );
}
