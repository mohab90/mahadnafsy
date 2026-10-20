import React, { useEffect, useMemo, useState } from 'react';
import { Banknote, Clock, Eye, Megaphone, Save, Tag, Timer } from 'lucide-react';
import { uploadImage } from '../../../../lib/uploadImage';
import { useSiteData } from '../../../../context/SiteDataContext';
import {
  CASH_DISCOUNT, INSTALL_DISCOUNT, INSTALL_FIRST_PCT, MAX_DISCOUNT_PERCENT, enrollmentRates, percentLabel,
} from '../../../../../shared/enrollmentPricing';
import {
  OFFER_DEFAULT_HOURS, offerEnabled, offerHours, offerIsOver, offerRemainingMs, popupHasContent, popupImage, popupIsLive, popupVideo, POPUP_THEMES,
  type PopupFrequency, type PopupTheme,
} from '../../../../../shared/siteOffers';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const FREQUENCY_LABEL: Record<PopupFrequency, string> = {
  daily: 'مرة كل يوم لكل زائر',
  once: 'مرة واحدة فقط لكل زائر',
  session: 'مرة في كل زيارة',
  always: 'مع كل فتح للصفحة',
};
const THEME_LABEL: Record<PopupTheme, { name: string; swatch: string }> = {
  royal: { name: 'ملكي بنفسجي', swatch: 'linear-gradient(135deg,#1e1b4b,#7c3aed)' },
  sunset: { name: 'غروب أحمر', swatch: 'linear-gradient(135deg,#7f1d1d,#f59e0b)' },
  emerald: { name: 'زمردي أخضر', swatch: 'linear-gradient(135deg,#064e3b,#14b8a6)' },
};

/** The saved values this panel edits — drafts are reset only when one of these really changes, not on every content refresh. */
const savedSignature = (content: Record<string, string | undefined>, prefixes: string[]) =>
  JSON.stringify(Object.keys(content).filter(k => prefixes.some(p => k.startsWith(p))).sort().map(k => [k, content[k]]));

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:border-primary-400 outline-none';
const Label: React.FC<{ text: string; hint?: string; className?: string; children: React.ReactNode }> = ({ text, hint, className, children }) => (
  <label className={`block ${className || ''}`}>
    <span className="block text-xs font-bold text-gray-600 mb-1">{text}</span>
    {children}
    {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
  </label>
);

/** «24 ساعة» · «يومين» · «3 أيام» — how the badge names the offer's length. */
const offerLengthLabel = (hours: number) => {
  if (hours === 24) return '24 ساعة';
  if (hours % 24 !== 0) return `${hours} ساعة`;
  const days = hours / 24;
  return days === 2 ? 'يومين' : days <= 10 ? `${days} أيام` : `${days} يوم`;
};

/** ISO instant ⇄ the value a datetime-local input wants (the browser's own clock). */
const toLocalInput = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (value: string) => {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

/**
 * التسويق ← الخصومات: the site's timed offer and its pop-up, in one place.
 *
 * The offer section on the home page had its controls in the home-page text
 * editor, away from every other discount, and could neither be switched off,
 * given a different length, nor priced on its own. Both surfaces are plain
 * site-content keys (see shared/siteOffers) so nothing here needs a new table
 * and the site picks a change up with its next content refresh.
 */
export const SiteOffersPanel: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const { content, courses, discounts, setContentValues } = useSiteData();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 30000);
    return () => clearInterval(id);
  }, []);

  // ── the enrolment page's two discounts ──────────────────────────────────
  // «محتاجين اقدر اعدل الخصم الكاش وخصم القسط»: what /enroll and checkout show, and what the server charges.
  const currentRates = enrollmentRates(content);
  const [cashPct, setCashPct] = useState(String(percentLabel(currentRates.cash)));
  const [installPct, setInstallPct] = useState(String(percentLabel(currentRates.install)));
  const ratesSig = `${content['enroll.cashDiscountPercent'] ?? ''}|${content['enroll.installDiscountPercent'] ?? ''}`;
  useEffect(() => {
    const fresh = enrollmentRates(content);
    setCashPct(String(percentLabel(fresh.cash)));
    setInstallPct(String(percentLabel(fresh.install)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratesSig]);
  const saveRates = async () => {
    const cash = Number(cashPct);
    const install = Number(installPct);
    for (const [label, value] of [['خصم الكاش', cash], ['خصم القسط', install]] as const) {
      if (!Number.isFinite(value) || value < 0 || value > MAX_DISCOUNT_PERCENT) return notify('error', `${label} لازم يكون من 0 لـ ${MAX_DISCOUNT_PERCENT}%.`);
    }
    const ok = await setContentValues({ 'enroll.cashDiscountPercent': String(cash), 'enroll.installDiscountPercent': String(install) });
    notify(ok ? 'success' : 'error', ok ? 'اتحفظ خصم الكاش والقسط — بيظهر في صفحة التسجيل والدفع وبيتحاسب بيه.' : 'تعذر الحفظ.');
  };
  const exampleBase = 10000;
  const exampleCash = Math.round(exampleBase * (1 - (Number(cashPct) || 0) / 100));
  const exampleInstallTotal = Math.round(exampleBase * (1 - (Number(installPct) || 0) / 100));
  const exampleFirst = Math.round(exampleInstallTotal * INSTALL_FIRST_PCT);

  // ── the timed offer ──────────────────────────────────────────────────────
  const [offerOn, setOfferOn] = useState(offerEnabled(content));
  const [courseId, setCourseId] = useState(content['offer.courseId'] || '');
  const [discount, setDiscount] = useState(content['home.offer.discountPercent'] || '45');
  const [hours, setHours] = useState(String(offerHours(content)));
  const [prices, setPrices] = useState({
    EGP: content['offer.price.EGP'] || '', SAR: content['offer.price.SAR'] || '', USD: content['offer.price.USD'] || '',
  });
  const offerSig = savedSignature(content, ['offer.', 'home.offer.discountPercent']);
  useEffect(() => {
    setOfferOn(offerEnabled(content));
    setCourseId(content['offer.courseId'] || '');
    setDiscount(content['home.offer.discountPercent'] || '45');
    setHours(String(offerHours(content)));
    setPrices({ EGP: content['offer.price.EGP'] || '', SAR: content['offer.price.SAR'] || '', USD: content['offer.price.USD'] || '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerSig]);

  const offerCourse = courses.find(c => c.id === (content['offer.courseId'] || ''));
  const remaining = offerRemainingMs(content, now);
  const timerLabel = remaining === null
    ? 'مفيش عداد شغال — مش ظاهر في الموقع'
    : offerIsOver(content, now)
      ? 'العداد خلص — العرض اتشال من الموقع'
      : `شغال — فاضل ${Math.floor(remaining / 3600000)} ساعة و${Math.floor((remaining % 3600000) / 60000)} دقيقة`;
  const offerState = !offerEnabled(content) ? 'مقفول' : offerIsOver(content, now) ? 'انتهى' : 'ظاهر في الموقع';

  const saveOffer = async () => {
    const pct = Number(discount);
    const len = Math.round(Number(hours));
    if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return notify('error', 'نسبة الخصم لازم تكون من 0 لـ 99.');
    if (!Number.isFinite(len) || len < 1 || len > 24 * 30) return notify('error', 'مدة العرض لازم تكون من 1 ساعة لـ 720 ساعة.');
    for (const cur of ['EGP', 'SAR', 'USD'] as const) {
      if (prices[cur] !== '' && !(Number(prices[cur]) > 0)) return notify('error', `سعر العرض (${cur}) لازم يكون رقم أكبر من صفر أو فاضي.`);
    }
    const selected = courses.find(c => c.id === courseId);
    const entries: Record<string, string> = {
      'offer.enabled': offerOn ? '1' : '0',
      'offer.courseId': courseId,
      'offer.durationHours': String(len),
      'home.offer.discountPercent': String(pct),
      'home.offer.discount': `خصم ${pct}%`,
      'home.offer.badge': `عرض لمدة ${offerLengthLabel(len)} فقط`,
      'offer.price.EGP': prices.EGP, 'offer.price.SAR': prices.SAR, 'offer.price.USD': prices.USD,
    };
    if (selected) {
      entries['home.offer.title'] = selected.title;
      entries['home.offer.description'] = (selected.shortDescription || selected.description?.slice(0, 200) || '')
        .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      entries['home.offer.registerFor'] = `${selected.title} (عرض ${len} ساعة)`;
    }
    const ok = await setContentValues(entries);
    notify(ok ? 'success' : 'error', ok ? 'اتحفظ عرض الموقع.' : 'تعذر الحفظ.');
  };

  const startTimer = async () => {
    const len = Math.round(Number(hours)) || OFFER_DEFAULT_HOURS;
    const ok = await setContentValues({ 'offer.timerStartedAt': new Date().toISOString(), 'offer.durationHours': String(len), 'offer.enabled': '1' });
    notify(ok ? 'success' : 'error', ok ? `العداد بدأ: ${len} ساعة من دلوقتي.` : 'تعذر الحفظ.');
  };
  const stopTimer = async () => {
    const ok = await setContentValues({ 'offer.timerStartedAt': '' });
    notify(ok ? 'success' : 'error', ok ? 'العداد اتقفل — العرض بيفضل ظاهر بدون عدّاد.' : 'تعذر الحفظ.');
  };

  // ── the pop-up ───────────────────────────────────────────────────────────
  const [popup, setPopup] = useState(() => ({
    enabled: content['popup.enabled'] === '1',
    title: content['popup.title'] || '',
    body: content['popup.body'] || '',
    discountPercent: content['popup.discountPercent'] || '',
    code: content['popup.code'] || '',
    courseId: content['popup.courseId'] || '',
    ctaText: content['popup.ctaText'] || '',
    ctaLink: content['popup.ctaLink'] || '',
    videoUrl: content['popup.videoUrl'] || '',
    imageUrl: content['popup.imageUrl'] || '',
    endsAt: toLocalInput(content['popup.endsAt']),
    frequency: (content['popup.frequency'] || 'daily') as PopupFrequency,
    delaySeconds: content['popup.delaySeconds'] || '3',
    theme: (content['popup.theme'] || 'royal') as PopupTheme,
  }));
  const popupSig = savedSignature(content, ['popup.']);
  useEffect(() => {
    setPopup({
      enabled: content['popup.enabled'] === '1',
      title: content['popup.title'] || '',
      body: content['popup.body'] || '',
      discountPercent: content['popup.discountPercent'] || '',
      code: content['popup.code'] || '',
      courseId: content['popup.courseId'] || '',
      ctaText: content['popup.ctaText'] || '',
      ctaLink: content['popup.ctaLink'] || '',
      videoUrl: content['popup.videoUrl'] || '',
      imageUrl: content['popup.imageUrl'] || '',
      endsAt: toLocalInput(content['popup.endsAt']),
      frequency: (content['popup.frequency'] || 'daily') as PopupFrequency,
      delaySeconds: content['popup.delaySeconds'] || '3',
      theme: (content['popup.theme'] || 'royal') as PopupTheme,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popupSig]);
  const setP = <K extends keyof typeof popup>(key: K, value: (typeof popup)[K]) => setPopup(prev => ({ ...prev, [key]: value }));

  const coupons = useMemo(
    () => discounts.filter(d => (d.code || d.promoCode) && (d.isActive ?? d.active) !== false),
    [discounts],
  );
  const pickCoupon = (code: string) => {
    const rule = coupons.find(d => (d.code || d.promoCode) === code);
    setPopup(prev => ({
      ...prev,
      code,
      discountPercent: rule && (rule.type === 'percent' || rule.discountPercent) && !prev.discountPercent
        ? String(rule.type === 'percent' ? rule.value : rule.discountPercent) : prev.discountPercent,
    }));
  };

  const savePopup = async () => {
    const pct = popup.discountPercent === '' ? 0 : Number(popup.discountPercent);
    const delay = Number(popup.delaySeconds);
    if (!Number.isFinite(pct) || pct < 0 || pct > 99) return notify('error', 'خصم البوب أب لازم يكون من 0 لـ 99.');
    if (!Number.isFinite(delay) || delay < 0 || delay > 60) return notify('error', 'التأخير قبل الظهور من 0 لـ 60 ثانية.');
    const videoUrl = popup.videoUrl.trim();
    const imageUrl = popup.imageUrl.trim();
    if (videoUrl && !popupVideo(videoUrl)) return notify('error', 'رابط الفيديو لازم يكون يوتيوب أو فيميو أو ملف فيديو مباشر (mp4 / webm) على https.');
    if (imageUrl && !popupImage(imageUrl)) return notify('error', 'رابط الصورة لازم يبدأ بـ https://.');
    if (popup.enabled && !popup.title.trim() && !pct && !videoUrl && !imageUrl) return notify('error', 'اكتب عنوان أو حط نسبة خصم أو فيديو قبل ما تشغّل البوب أب.');
    const endsMs = popup.endsAt ? new Date(fromLocalInput(popup.endsAt)).getTime() : NaN;
    if (popup.enabled && Number.isFinite(endsMs) && endsMs <= Date.now()) return notify('error', 'تاريخ الانتهاء عدّى — البوب أب مش هيظهر. غيّر التاريخ أو امسحه.');
    if (popup.ctaLink && !/^(https?:\/\/|\/)/i.test(popup.ctaLink.trim())) return notify('error', 'الرابط لازم يبدأ بـ https:// أو بـ / (صفحة داخل الموقع).');
    if (popup.endsAt && !fromLocalInput(popup.endsAt)) return notify('error', 'تاريخ الانتهاء مش مفهوم.');
    const ok = await setContentValues({
      'popup.enabled': popup.enabled ? '1' : '0',
      'popup.title': popup.title.trim(),
      'popup.body': popup.body.trim(),
      'popup.discountPercent': pct ? String(pct) : '',
      'popup.code': popup.code.trim().toUpperCase(),
      'popup.courseId': popup.courseId,
      'popup.ctaText': popup.ctaText.trim(),
      'popup.ctaLink': popup.ctaLink.trim(),
      'popup.videoUrl': videoUrl,
      'popup.imageUrl': imageUrl,
      'popup.endsAt': fromLocalInput(popup.endsAt),
      'popup.frequency': popup.frequency,
      'popup.delaySeconds': String(delay),
      'popup.theme': popup.theme,
      // A new version is shown again to visitors who closed the old one.
      'popup.version': String(Date.now()),
    });
    notify(ok ? 'success' : 'error', ok ? (popup.enabled ? 'البوب أب اتحفظ وبيظهر لكل الزوار.' : 'اتحفظ — البوب أب مقفول.') : 'تعذر الحفظ.');
  };
  const siteUrl = String(content['site.url'] || content['footer.website'] || 'https://mahadnafsy.com').replace(/\/+$/, '');
  const popupLive = popupIsLive(content, now);

  return (
    <div className="space-y-5" dir="rtl">
      {/* ── the enrolment page's discounts ── */}
      <section className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-emerald-900 flex items-center gap-2"><Banknote size={16} /> خصم صفحة التسجيل والدفع (كاش / قسط)</h3>
        <p className="text-xs text-emerald-800 leading-5">
          النسبتين دول اللي بتظهر للعميل في صفحة «سجّل الآن» وفي الدفع، وهما نفسهم اللي السيرفر بيحاسب بيهم. التغيير بيسري على الطلبات الجديدة
          (اللي اتعملت قبل كده بتفضل بسعرها). الافتراضي: كاش {percentLabel(CASH_DISCOUNT)}% — قسط {percentLabel(INSTALL_DISCOUNT)}% وأول دفعة {percentLabel(INSTALL_FIRST_PCT)}%.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Label text="خصم الدفع كاش (كامل) %" hint={`من 0 لـ ${MAX_DISCOUNT_PERCENT} — 0 = بدون خصم`}>
            <input type="number" min="0" max={MAX_DISCOUNT_PERCENT} step="0.5" value={cashPct} onChange={e => setCashPct(e.target.value)} className={inputCls} />
          </Label>
          <Label text="خصم التقسيط %" hint={`من 0 لـ ${MAX_DISCOUNT_PERCENT} — بيتخصم من إجمالي الكورس قبل التقسيط`}>
            <input type="number" min="0" max={MAX_DISCOUNT_PERCENT} step="0.5" value={installPct} onChange={e => setInstallPct(e.target.value)} className={inputCls} />
          </Label>
        </div>
        <p className="text-xs text-emerald-900 bg-white border border-emerald-200 rounded-lg px-3 py-2">
          مثال على كورس بـ {exampleBase.toLocaleString('ar-EG-u-nu-latn')}: كاش يدفع <strong>{exampleCash.toLocaleString('ar-EG-u-nu-latn')}</strong> —
          قسط إجماليه <strong>{exampleInstallTotal.toLocaleString('ar-EG-u-nu-latn')}</strong> وأول دفعة <strong>{exampleFirst.toLocaleString('ar-EG-u-nu-latn')}</strong>.
        </p>
        <button type="button" onClick={() => void saveRates()} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold"><Save size={14} /> حفظ الخصمين</button>
      </section>

      {/* ── the timed offer ── */}
      <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-amber-900 flex items-center gap-2"><Tag size={16} /> عرض الموقع بالعدّاد التنازلي (الصفحة الرئيسية)</h3>
          <label className="flex items-center gap-2 text-sm font-bold text-amber-900 cursor-pointer">
            <input type="checkbox" checked={offerOn} onChange={e => setOfferOn(e.target.checked)} className="w-4 h-4 accent-amber-600" />
            العرض شغّال
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-4 text-xs">
          <div className="rounded-lg bg-white border border-amber-200 p-3"><div className="text-amber-700 font-bold mb-1">حالته في الموقع</div><div className="font-bold text-gray-900">{offerState}</div></div>
          <div className="rounded-lg bg-white border border-amber-200 p-3"><div className="text-amber-700 font-bold mb-1">الكورس</div><div className="font-bold text-gray-900">{offerCourse?.title || 'مش مربوط بكورس'}</div></div>
          <div className="rounded-lg bg-white border border-amber-200 p-3"><div className="text-amber-700 font-bold mb-1">المدة</div><div className="font-bold text-gray-900">{offerHours(content)} ساعة</div></div>
          <div className="rounded-lg bg-white border border-amber-200 p-3"><div className="text-amber-700 font-bold mb-1 flex items-center gap-1"><Timer size={12} /> العدّاد</div><div className="font-bold text-gray-900">{timerLabel}</div></div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Label text="كورس العرض" className="md:col-span-2">
            <select value={courseId} onChange={e => setCourseId(e.target.value)} className={inputCls}>
              <option value="">— من غير كورس (الأسعار تكتبها بإيدك) —</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Label>
          <Label text="الخصم %" hint="بيحسب السعر المشطوب">
            <input type="number" min="0" max="99" value={discount} onChange={e => setDiscount(e.target.value)} className={inputCls} />
          </Label>
          <Label text="مدة العدّاد (ساعات)" hint="24 = يوم · 48 = يومين">
            <input type="number" min="1" max="720" value={hours} onChange={e => setHours(e.target.value)} className={inputCls} />
          </Label>
        </div>

        <div>
          <p className="text-xs font-bold text-gray-600 mb-1">سعر العرض نفسه <span className="font-normal text-gray-400">— سيبه فاضي ياخد سعر الكورس بعملة الزائر</span></p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Label text="بالجنيه (مصر)"><input type="number" min="0" value={prices.EGP} onChange={e => setPrices(p => ({ ...p, EGP: e.target.value }))} className={inputCls} placeholder={offerCourse ? String(offerCourse.price?.EGP || '') : ''} /></Label>
            <Label text="بالريال (السعودية)"><input type="number" min="0" value={prices.SAR} onChange={e => setPrices(p => ({ ...p, SAR: e.target.value }))} className={inputCls} placeholder={offerCourse ? String(offerCourse.price?.SAR || '') : ''} /></Label>
            <Label text="بالدولار (باقي الدول)"><input type="number" min="0" value={prices.USD} onChange={e => setPrices(p => ({ ...p, USD: e.target.value }))} className={inputCls} placeholder={offerCourse ? String(offerCourse.price?.USD || '') : ''} /></Label>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void saveOffer()} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold"><Save size={14} /> حفظ العرض</button>
          <button type="button" onClick={() => void startTimer()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-xs font-bold"><Clock size={13} /> ابدأ العدّاد دلوقتي ({hours || OFFER_DEFAULT_HOURS} ساعة)</button>
          {remaining !== null && <button type="button" onClick={() => void stopTimer()} className="px-4 py-2 rounded-lg border border-amber-300 text-amber-800 text-xs font-bold hover:bg-amber-100">إيقاف العدّاد</button>}
          <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-bold hover:bg-white"><Eye size={13} /> افتح الموقع</a>
        </div>
        <p className="text-[11px] text-amber-800 leading-5">لما العدّاد يخلص العرض بيتشال من الصفحة الرئيسية لوحده. «العرض شغّال» لو اتشال العلامة بيختفي فوراً حتى لو العدّاد شغال.</p>
      </section>

      {/* ── the pop-up ── */}
      <section className="bg-violet-50 border border-violet-200 rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-violet-900 flex items-center gap-2"><Megaphone size={16} /> بوب أب الخصم (يظهر لكل زوار الموقع)</h3>
          <label className="flex items-center gap-2 text-sm font-bold text-violet-900 cursor-pointer">
            <input type="checkbox" checked={popup.enabled} onChange={e => setP('enabled', e.target.checked)} className="w-4 h-4 accent-violet-600" />
            البوب أب شغّال
          </label>
        </div>
        <p className="text-xs text-violet-800">
          الحالة دلوقتي: <strong>{popupLive ? 'ظاهر لكل الزوار' : 'غير ظاهر'}</strong>
          {content['popup.enabled'] !== '1' && ' — البوب أب مقفول: شغّل المفتاح اللي فوق واضغط «حفظ البوب أب»'}
          {content['popup.enabled'] === '1' && !popupHasContent(content) && ' (مفيش عنوان ولا خصم ولا فيديو يتعرض)'}
          {content['popup.enabled'] === '1' && popupHasContent(content) && !popupLive && ' (تاريخ الانتهاء عدّى)'}
        </p>

        <div className="grid gap-3 md:grid-cols-4">
          <Label text="العنوان" className="md:col-span-3"><input value={popup.title} onChange={e => setP('title', e.target.value)} className={inputCls} placeholder="مثال: خصم نهاية الأسبوع على كل الدبلومات" /></Label>
          <Label text="نسبة الخصم %"><input type="number" min="0" max="99" value={popup.discountPercent} onChange={e => setP('discountPercent', e.target.value)} className={inputCls} /></Label>
          <Label text="النص" className="md:col-span-4"><textarea value={popup.body} onChange={e => setP('body', e.target.value)} rows={2} className={inputCls} placeholder="جملتين عن العرض وشروطه" /></Label>
          <Label text="فيديو (اختياري)" className="md:col-span-2" hint="رابط يوتيوب أو فيميو، أو ملف mp4 مباشر — بيظهر فوق في البوب أب">
            <input value={popup.videoUrl} onChange={e => setP('videoUrl', e.target.value)} className={inputCls} dir="ltr" placeholder="https://www.youtube.com/watch?v=…" />
            {popup.videoUrl.trim() && !popupVideo(popup.videoUrl) && <span className="block text-[11px] text-red-600 mt-1">الرابط ده مش مدعوم — يوتيوب أو فيميو أو ملف mp4/webm على https.</span>}
          </Label>
          <Label text="صورة (اختياري)" className="md:col-span-2" hint="بتظهر لو مفيش فيديو">
            <div className="flex gap-2">
              <input value={popup.imageUrl} onChange={e => setP('imageUrl', e.target.value)} className={inputCls} dir="ltr" placeholder="https://…" />
              <label className="shrink-0 px-3 py-2 rounded-lg bg-violet-100 text-violet-800 text-xs font-bold cursor-pointer">
                رفع
                <input type="file" accept="image/*" className="hidden" onChange={e => {
                  const file = e.target.files?.[0]; e.target.value = '';
                  if (file) void uploadImage(file, 'cover').then(url => setP('imageUrl', url)).catch(() => notify('error', 'تعذر رفع الصورة — جرّب صورة أصغر.'));
                }} />
              </label>
            </div>
          </Label>
          <Label text="كود الخصم (اختياري)" hint={coupons.length ? 'اختار من الكوبونات اللي عندك أو اكتب كود' : 'اكتب الكود اللي هيظهر للعميل'}>
            <input value={popup.code} onChange={e => setP('code', e.target.value)} className={`${inputCls} font-mono uppercase`} list="popup-coupons" />
            <datalist id="popup-coupons">{coupons.map(d => <option key={d.id} value={d.code || d.promoCode} />)}</datalist>
          </Label>
          <Label text="كورس معيّن (اختياري)" className="md:col-span-2" hint="لو اخترت كورس يظهر سعره بعد الخصم والزر يفتح صفحته">
            <select value={popup.courseId} onChange={e => setP('courseId', e.target.value)} className={inputCls}>
              <option value="">— كل الكورسات —</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Label>
          <div className="flex items-end">
            {popup.code && coupons.some(d => (d.code || d.promoCode) === popup.code.toUpperCase()) && (
              <button type="button" onClick={() => pickCoupon(popup.code.toUpperCase())} className="w-full px-3 py-2 rounded-lg border border-violet-300 text-violet-800 text-xs font-bold hover:bg-violet-100">خد نسبة الكوبون</button>
            )}
          </div>
          <Label text="نص الزر" hint="الافتراضي: احجز الآن بالخصم"><input value={popup.ctaText} onChange={e => setP('ctaText', e.target.value)} className={inputCls} /></Label>
          <Label text="رابط الزر (اختياري)" className="md:col-span-2" hint="/courses أو https://… — لو اخترت كورس بيفتح الكورس"><input value={popup.ctaLink} onChange={e => setP('ctaLink', e.target.value)} className={inputCls} dir="ltr" /></Label>
          <Label text="ينتهي في (اختياري)" hint="فاضي = لحد ما تقفله"><input type="datetime-local" value={popup.endsAt} onChange={e => setP('endsAt', e.target.value)} className={inputCls} /></Label>
          <Label text="بيظهر كل"><select value={popup.frequency} onChange={e => setP('frequency', e.target.value as PopupFrequency)} className={inputCls}>
            {(Object.keys(FREQUENCY_LABEL) as PopupFrequency[]).map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
          </select></Label>
          <Label text="بعد كام ثانية من فتح الموقع"><input type="number" min="0" max="60" value={popup.delaySeconds} onChange={e => setP('delaySeconds', e.target.value)} className={inputCls} /></Label>
          <div>
            <span className="block text-xs font-bold text-gray-600 mb-1">اللون</span>
            <div className="flex gap-2">
              {POPUP_THEMES.map(t => (
                <button key={t} type="button" onClick={() => setP('theme', t)} title={THEME_LABEL[t].name}
                  className={`h-9 flex-1 rounded-lg border-2 transition ${popup.theme === t ? 'border-violet-600 scale-105 shadow' : 'border-transparent opacity-80'}`}
                  style={{ background: THEME_LABEL[t].swatch }} aria-pressed={popup.theme === t} aria-label={THEME_LABEL[t].name} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void savePopup()} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold"><Save size={14} /> حفظ البوب أب</button>
          <a href={`${siteUrl}/?previewPopup=1`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-violet-300 text-violet-800 text-xs font-bold hover:bg-violet-100"><Eye size={13} /> معاينة على الموقع (بعد الحفظ)</a>
        </div>
        <p className="text-[11px] text-violet-800 leading-5">كل حفظ بيعتبر نسخة جديدة، فالزائر اللي قفل النسخة القديمة يشوف الجديدة. الموظفين والأدمن مش بيشوفوه على الموقع الحقيقي — استخدم زر المعاينة.</p>
      </section>
    </div>
  );
};
