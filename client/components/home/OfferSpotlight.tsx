import React, { useState } from 'react';
import { CheckCircle2, Lock, Send, Timer } from 'lucide-react';
import type { Course, Currency, LeadItem } from '../../types';
import { cdnImg } from '../../lib/img';
import { offerDiscountPercent, offerPrices } from '../../../shared/siteOffers';

type Content = Record<string, string | undefined>;
type Clock = { h: number; m: number; s: number } | null;

const two = (n: number) => String(n).padStart(2, '0');

/**
 * The timed offer (التسويق ← الخصومات): the course, its old and new price, the
 * countdown marketing started, and a short form that drops the visitor into
 * العملاء المحتملون. Every line is a content key; nothing here is a price of its own.
 */
const OfferSpotlight: React.FC<{
  content: Content;
  courses: Course[];
  currency: Currency;
  timer: Clock;
  addPublicLead: (lead: Omit<LeadItem, 'clientCode'> & { clientCode?: string }) => Promise<void>;
}> = ({ content, courses, currency, timer, addPublicLead }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [branch, setBranch] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [sending, setSending] = useState(false);

  const offerCid = content['offer.courseId'];
  const offerCourse = offerCid ? courses.find(c => c.id === offerCid) || null : null;
  const sym = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  // The offer's own price (typed by marketing) or the course's, in the visitor's currency.
  const prices = offerPrices(content, offerCourse, currency);
  const oldPrice = prices ? `${prices.oldPrice} ${sym}` : content[`home.offer.oldPrice.${currency}`] || content['home.offer.oldPrice'] || `4500 ${sym}`;
  const newPrice = prices ? `${prices.newPrice} ${sym}` : content[`home.offer.newPrice.${currency}`] || content['home.offer.newPrice'] || `2500 ${sym}`;
  const pct = offerDiscountPercent(content);

  let branches: { id: string; label: string; internal_only?: boolean }[] = [];
  try { branches = JSON.parse(content['institute.branches'] || '[]'); } catch { /* the defaults below */ }
  branches = branches.filter(b => !b.internal_only);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setNotice({ ok: false, text: 'يرجى إدخال الاسم ورقم الهاتف.' });
      return;
    }
    setSending(true);
    try {
      await addPublicLead({
        id: `l-${Date.now()}`,
        name: name.trim(),
        email: `${phone.replace(/\D/g, '') || Date.now()}@lead.local`,
        phone: phone.trim(),
        source: 'عرض 24 ساعة',
        status: 'new',
        leadType: 'course',
        enrolledCourseId: content['offer.courseId'] || '',
        branch: branch as LeadItem['branch'],
        createdAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      });
      setName(''); setPhone(''); setBranch('');
      setNotice({ ok: true, text: 'تم تسجيل طلبك، وفريقنا هيتواصل معاك قريب جداً لتأكيد الحجز.' });
    } catch {
      setNotice({ ok: false, text: 'تعذر تسجيل الطلب حاليًا. من فضلك حاول مرة أخرى أو تواصل معنا على واتساب.' });
    } finally {
      setSending(false);
    }
  };

  const field = 'w-full min-h-[50px] rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-[#b3a39c] focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';

  return (
    <section id="offer" className="scroll-mt-24 bg-white px-4 py-6 sm:py-10">
      <div className="container mx-auto">
        <div className="relative overflow-hidden rounded-[36px] bg-gradient-to-br from-[#2a0b14] via-[#4c0519] to-primary-800 p-5 text-white shadow-[0_50px_90px_-40px_rgba(76,5,25,.9)] sm:p-10 lg:p-12">
          <div aria-hidden="true" className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgba(227,182,90,.28),transparent)]" />
          <div aria-hidden="true" className="absolute inset-0 opacity-[.12]" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,.6) 1px, transparent 1px)', backgroundSize: '22px 22px' }} />

          <div className="relative grid items-center gap-8 lg:grid-cols-[1.1fr_.9fr] lg:gap-12">
            <div className="text-center lg:text-right">
              <span className="inline-flex items-center gap-2 rounded-full bg-gold-light px-4 py-1.5 text-sm font-black text-[#2a0b14]">
                <Timer size={16} />
                {content['home.offer.badge'] || 'عرض لمدة 24 ساعة فقط'}
              </span>
              <h2 className="mt-4 text-[28px] font-black leading-tight sm:text-4xl lg:text-[44px]">{content['home.offer.title'] || 'دبلومة العلاج السلوكي الجدلي (DBT)'}</h2>
              <p className="mx-auto mt-3 line-clamp-3 max-w-xl text-base leading-[1.9] text-white/75 lg:mx-0">
                {(content['home.offer.description'] || 'احصل على الدبلومة الأكثر طلباً في سوق العمل بسعر لا يصدق.').replace(/<[^>]*>/g, '').trim()}
              </p>

              <div className="mt-6 flex flex-wrap items-end justify-center gap-x-5 gap-y-2 lg:justify-start">
                <span className="text-5xl font-black leading-none tabular-nums text-white sm:text-6xl">{newPrice}</span>
                <span className="pb-1 text-right leading-tight">
                  <s className="block text-lg text-white/50 tabular-nums">{oldPrice}</s>
                  <span className="text-sm font-extrabold text-gold-pale">{content['home.offer.discount'] || `خصم ${pct}%`}</span>
                </span>
              </div>

              {timer && (
                <div className="mt-7 flex justify-center gap-2.5 lg:justify-start" dir="ltr">
                  {[{ v: timer.h, l: 'ساعة' }, { v: timer.m, l: 'دقيقة' }, { v: timer.s, l: 'ثانية' }].map((t, i) => (
                    <div key={i} className="w-[76px] rounded-2xl border border-white/15 bg-white/10 py-2.5 text-center backdrop-blur sm:w-[86px]">
                      <span className="block text-3xl font-black tabular-nums">{two(t.v)}</span>
                      <span className="text-xs font-bold text-white/60">{t.l}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-sm text-white/55">{content['home.offer.validUntil'] || 'ساري حتى منتصف الليل'}</p>
            </div>

            <form onSubmit={submit} className="relative rounded-[28px] bg-white p-5 text-ink shadow-2xl sm:p-7">
              {offerCourse?.thumbnail && (
                <div className="mb-5 flex items-center gap-3 rounded-2xl bg-paper p-2.5 ring-1 ring-line">
                  <img src={cdnImg(offerCourse.thumbnail, 160)} alt="" loading="lazy" className="h-14 w-20 flex-none rounded-xl object-cover" />
                  <span className="min-w-0 text-right">
                    <span className="block text-xs font-bold text-muted">أنت بتحجز:</span>
                    <b className="block truncate text-[15px] text-primary-700">{content['home.offer.registerFor'] || offerCourse.title}</b>
                  </span>
                </div>
              )}
              <h3 className="mb-4 text-xl font-black">{content['home.offer.formBadge'] || 'سجل الآن واضمن السعر'}</h3>
              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1 block text-[13px] font-bold text-muted-strong">{content['home.offer.formNameLabel'] || 'الاسم الكامل'}</span>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="name" className={field} placeholder={content['home.offer.formNamePlaceholder'] || 'الاسم الثلاثي'} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-bold text-muted-strong">{content['home.offer.formPhoneLabel'] || 'رقم الهاتف (واتساب)'}</span>
                  <input type="tel" dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" className={`${field} text-right`} placeholder={content['home.offer.formPhonePlaceholder'] || '01xxxxxxxxx'} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[13px] font-bold text-muted-strong">{content['home.offer.formBranchLabel'] || 'الفرع الأقرب'}</span>
                  <select value={branch} onChange={e => setBranch(e.target.value)} className={field}>
                    <option value="">{content['home.offer.formBranchPlaceholder'] || 'اختر الفرع الأقرب إليك'}</option>
                    {branches.length > 0
                      ? branches.map(b => <option key={b.id} value={b.id}>{b.label}</option>)
                      : (<>
                          <option value="daqqi">{content['home.offer.formBranchGiza'] || 'فرع الدقي'}</option>
                          <option value="tagamoa">{content['home.offer.formBranchCairo'] || 'فرع التجمع'}</option>
                          <option value="online-egypt">{content['home.offer.formBranchOnline'] || 'أونلاين محلي (مصر)'}</option>
                          <option value="online-saudi">{content['home.offer.formBranchSaudi'] || 'أونلاين سعودي'}</option>
                          <option value="online-abroad">{content['home.offer.formBranchAbroad'] || 'أونلاين دولي'}</option>
                          <option value="other">{content['home.offer.formBranchOther'] || 'أخرى'}</option>
                        </>)}
                  </select>
                </label>
              </div>

              {notice && (
                <p role="status" className={`mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${notice.ok ? 'bg-green-50 text-green-800 ring-1 ring-green-200' : 'bg-primary-50 text-primary-800 ring-1 ring-primary-200'}`}>
                  {notice.ok && <CheckCircle2 size={18} className="mt-0.5 flex-none" />}
                  {notice.text}
                </p>
              )}

              <button type="submit" disabled={sending} className="mt-5 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 text-lg font-black text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800 disabled:opacity-60">
                <Send size={18} />
                {content['home.offer.registerButton'] || 'حجز العرض الآن'}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-soft">
                <Lock size={12} />
                {content['home.offer.registerNote'] || 'سيقوم فريق المبيعات بالتواصل معك لتأكيد الحجز والدفع'}
              </p>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

export default OfferSpotlight;
