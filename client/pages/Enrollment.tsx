import React, { FormEvent, useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { BookOpen, Check, CheckCircle, Banknote, CalendarClock, Plus, Loader2, Shield, ChevronDown, Trash2, Zap, Award, MessageCircle, AlertCircle, CreditCard, Layers } from 'lucide-react';
import { mysqlAuth, mysqlForms } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';
import { usePaymentAvailability } from '../lib/usePaymentAvailability';
import { cdnImg } from '../lib/img';
import PageHeader from '../components/PageHeader';
import { instituteWhatsApp } from '../lib/whatsappLink';
// The cash / instalment rates live in shared/enrollmentPricing so the server
// applies exactly the same ones. They used to be defined here only, which is
// how a customer could be shown a discount the server had never heard of.
import { amountDueNow, enrollmentRates, installmentTotal, percentLabel } from '../../shared/enrollmentPricing';
import { useSeo } from '../lib/useSeo';
import { trackLead } from '../lib/tracking';
import { effectivePrice, usePriceList } from '../lib/usePrices';

// ── Payment type ──────────────────────────────────────────────────────────────
type PayType = 'cash' | 'installment';


// ── Arabic error messages ────────────────────────────────────────────
const authAr: Record<string, string> = {
  'Email already registered': 'هذا البريد الإلكتروني مستخدم بالفعل، يرجى تسجيل الدخول.',
  'Invalid credentials': 'كلمة المرور غير صحيحة.',
  'Password must be at least 8 characters': 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.',
};

// ── Component ─────────────────────────────────────────────────────────────────
const Enrollment: React.FC = () => {
  useSeo({ title: 'التسجيل في الكورس | معهد الدراسات النفسية', path: '/enroll' });
  const { courses, bundles, currency, content, authUser } = useSiteData();
  const priceList = usePriceList();
  // The two discounts marketing sets (التسويق ← الخصومات); the server prices with the same ones.
  const rates = enrollmentRates(content);
  const cashPct = percentLabel(rates.cash);
  const installPct = percentLabel(rates.install);
  const firstPct = percentLabel(rates.first);
  const cashText = rates.cash > 0 ? `خصم ${cashPct}%` : 'بدون خصم';
  const installText = rates.install > 0 ? `خصم ${installPct}%` : 'بدون خصم';
  const onlinePayEnabled = usePaymentAvailability();

  // Available courses with a price
  const availableCourses = useMemo(
    () => courses.filter(c => c.price && (c.price.EGP > 0 || c.price.SAR > 0 || c.price.USD > 0)),
    [courses]
  );
  // Available bundles/paths with a price
  const availableBundles = useMemo(
    () => bundles.filter(b => b.price && (b.price.EGP > 0 || b.price.SAR > 0 || b.price.USD > 0)),
    [bundles]
  );

  // Unified selectable item type: bundles (key="bundle:ID") then courses (key="course:ID")
  type SelItem = { key: string; kind: 'bundle' | 'course'; title: string; price: { EGP: number; SAR: number; USD: number }; courseIds: string[]; thumbnail?: string; instructor?: string };
  const allOptions = useMemo<SelItem[]>(() => [
    ...availableBundles.map(b => ({ key: `bundle:${b.id}`, kind: 'bundle' as const, title: b.title, price: b.price, courseIds: b.courses.map(c => c.id) })),
    ...availableCourses.map(c => ({ key: `course:${c.id}`, kind: 'course' as const, title: c.title, price: c.price, courseIds: [c.id], thumbnail: c.thumbnail, instructor: c.instructor })),
  ], [availableBundles, availableCourses]);

  const [searchParams] = useSearchParams();

  // Selected item keys (multi-select via dropdowns). Seeded from ?course=/?bundle=
  // once, at mount: keys resolve against the catalogue whenever it arrives. It
  // was re-seeded each time the catalogue refreshed (it does on tab refocus),
  // which threw away whatever the visitor had since picked in the form.
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const courseId = searchParams.get('course');
    const bundleId = searchParams.get('bundle');
    if (courseId) return [`course:${courseId}`];
    if (bundleId) return [`bundle:${bundleId}`];
    return [''];  // start with one empty slot
  });
  const [payType, setPayType] = useState<PayType>('cash');
  const [branch, setBranch] = useState('');

  // Form fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [registeredWhatsapp, setRegisteredWhatsapp] = useState('');

  // A signed-in customer was still asked to invent an email and a password
  // on a page they had already authenticated for — and picking an address
  // that differed from their account created a second, disconnected record.
  const isSignedIn = Boolean(authUser);
  useEffect(() => {
    if (!authUser) return;
    setFullName(prev => prev || authUser.displayName || authUser.email?.split('@')[0] || '');
    setEmail(prev => prev || authUser.email || '');
    setPhone(prev => prev || (authUser as { phone?: string }).phone || '');
  }, [authUser]);

  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const whatsappNumber = instituteWhatsApp(content);

  const getItem = (key: string) => allOptions.find(x => x.key === key) ?? null;
  // Never fall back to Egypt pricing for a Saudi/international visitor.
  // The server independently resolves and validates the same location currency.
  // The list price checkout starts from: the catalogue price less the discount
  // running on the item (lib/usePrices) — the rates below go on top of it there.
  const getBasePrice = (item: SelItem) =>
    effectivePrice(priceList, item.kind, item.key.replace(/^(course|bundle):/, ''), currency, Number(item.price[currency]) || 0).price;
  // Both from shared/enrollmentPricing, which exists so a rate change cannot
  // apply to one side and not the other — this page had re-derived the same two
  // formulas from the raw constants, which is a second copy of the rule under a
  // different name and the exact thing that module was extracted to prevent.
  const getInstallPrice = (item: SelItem) => installmentTotal(getBasePrice(item), rates);
  const getCharged = (item: SelItem) => amountDueNow(getBasePrice(item), payType, rates);

  // Deduplicated chosen items (ignore empty slots)
  const chosenCourses = useMemo(
    () => [...new Map(
      selectedIds.filter(Boolean).map(key => [key, getItem(key)]).filter(([, c]) => c !== null) as [string, SelItem][]
    ).values()],
    // getItem is a lookup closure over allOptions, rebuilt every render, so the
    // memo depends on allOptions itself — the only thing that can change what
    // getItem returns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, allOptions]
  );

  const totalOriginal    = chosenCourses.reduce((s, c) => s + getBasePrice(c), 0);
  const totalFinal       = chosenCourses.reduce((s, c) => s + getCharged(c), 0);
  const totalInstallTotal = payType === 'installment' ? chosenCourses.reduce((s, c) => s + getInstallPrice(c), 0) : 0;
  const totalSaving      = payType === 'cash' ? totalOriginal - totalFinal : Math.round(totalOriginal * rates.install);
  const pricesAvailable = chosenCourses.every(item => getBasePrice(item) > 0);

  // Keys already chosen (to prevent duplicates in dropdowns)
  const chosenIds = new Set(selectedIds.filter(Boolean));

  const setSlot = (idx: number, id: string) => {
    setSelectedIds(prev => prev.map((v, i) => i === idx ? id : v));
  };

  const removeSlot = (idx: number) => {
    setSelectedIds(prev => prev.length === 1 ? [''] : prev.filter((_, i) => i !== idx));
  };

  const addSlot = () => {
    setSelectedIds(prev => [...prev, '']);
  };

  const handlePay = async (e: FormEvent) => {
    e.preventDefault();
    if (chosenCourses.length === 0) return;
    if (!pricesAvailable) {
      setError('السعر غير متاح في دولتك حاليًا. تواصل مع الدعم لتجهيز السعر قبل التسجيل.');
      return;
    }
    setError('');
    setLoading(true);

    try {
      // Create or sign in to MySQL account
      let uid = '';
      // Already authenticated: there is no account to create, and trying to
      // register again would fail on the existing email.
      if (isSignedIn) uid = authUser?.uid || 'signed-in';
      if (!isSignedIn) try {
        const result = await mysqlAuth.register({
          email: email.trim(),
          password,
          name: fullName.trim(),
          phone: phone.trim(),
          interest: chosenCourses.map(item => item.title).join('، '),
        });
        uid = result.user.uid;
      } catch (authErr) {
        const msg = authErr instanceof Error ? authErr.message : '';
        if (msg === 'Email already registered') {
          try {
            const result = await mysqlAuth.login(email.trim(), password);
            if (!result.user) throw new Error('تعذر إنشاء جلسة المستخدم.');
            uid = result.user.uid;
          } catch {
            throw new Error('البريد الإلكتروني مسجل بكلمة مرور مختلفة. أدخل نفس كلمة المرور التي استخدمتها من قبل، أو سجّل الدخول من صفحة الدخول.');
          }
        } else {
          // The server words some refusals for the customer already — a number
          // that has an account is told to sign in by WhatsApp code — and those
          // were replaced here by «تعذر إنشاء الحساب».
          throw new Error(authAr[msg] || (/[ء-ي]/.test(msg) ? msg : 'تعذر إنشاء الحساب، حاول مرة أخرى.'));
        }
      }

      // Persist the selected products and sales context on the same CRM lead.
      // This is a registration request only; no payment or enrollment is claimed
      // until the normal manual-payment workflow creates and settles an order.
      await mysqlForms.submitRegistration({
        name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        source: 'صفحة التسجيل في البرامج',
        branch: branch || 'ONLINE_EGYPT',
        interestedCourseIds: [...new Set(chosenCourses.flatMap(item => item.courseIds))],
        selectedItems: chosenCourses.map(item => ({
          id: item.key.replace(/^(course|bundle):/, ''),
          type: item.kind,
          title: item.title,
        })),
        preferredPaymentType: payType,
        notes: `طلب تسجيل: ${chosenCourses.map(item => item.title).join('، ')}. طريقة السداد المفضلة: ${payType === 'cash' ? 'كامل' : 'تقسيط'}.`,
      });
      trackLead({ source: 'صفحة التسجيل في البرامج', contentName: chosenCourses.map(item => item.title).join('، ') });

      // Build WhatsApp message with order details
      const firstItem = chosenCourses[0];
      const itemTitles = chosenCourses.map(c => c.title).join('، ');
      const waMsg = `مرحباً، أريد الاشتراك في:\n${itemTitles}\n\nالإجمالي: ${totalFinal.toLocaleString('ar-EG-u-nu-latn')} ${currencySymbol} (${payType === 'cash' ? `كاش - ${cashText}` : `أول قسط ${firstPct}%`})\nالاسم: ${fullName.trim()}\nالهاتف: ${phone.trim()}\nالبريد: ${email.trim()}`;
      setRegisteredWhatsapp(encodeURIComponent(waMsg));
      void uid; void firstItem;
      // Straight to payment for what they chose. The confirmation screen is
      // still there for anyone the gateway cannot serve — it is just no
      // longer a stop on the way for everyone else.
      if (onlinePayEnabled && chosenCourses.length === 1) {
        const item = chosenCourses[0];
        const itemId = item.key.replace(/^(course|bundle):/, '');
        window.location.assign(
          `/checkout?type=${item.kind}&id=${encodeURIComponent(itemId)}&payMode=${payType}`);
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ، حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  // A signed-in customer has already given all of this; asking again and
  // then disabling the button until they retype a password they do not have
  // is what made "سجّل وادفع الآن" impossible to press.
  const canPay = chosenCourses.length > 0 && pricesAvailable && (
    isSignedIn
      ? true
      : Boolean(fullName.trim() && phone.trim() && email.trim() && password.length >= 8)
  );

  const field = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const label = 'mb-1 block text-[13px] font-bold text-muted-strong';
  const money = (n: number) => n.toLocaleString('ar-EG-u-nu-latn');

  // The numbered heading of each step on the page.
  const stepTitle = (n: number, text: React.ReactNode) => (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-ink text-sm font-black text-gold-pale">{n}</span>
      <h2 className="text-lg font-black text-ink">{text}</h2>
    </div>
  );

  // Cash or instalments, as two cards like the home page's calculator.
  const payToggle = (id: PayType, title: string, sub: React.ReactNode, Icon: typeof Banknote) => {
    const on = payType === id;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setPayType(id)}
        className={`flex min-h-[72px] items-center gap-3 rounded-2xl border-2 px-3 text-right transition sm:px-4 ${on ? 'border-primary-700 bg-primary-50/60' : 'border-line bg-white hover:border-line-deep'}`}
      >
        <span className={`hidden h-10 w-10 flex-none items-center justify-center rounded-xl sm:flex ${on ? 'bg-primary-700 text-white' : 'bg-paper text-muted'}`}><Icon size={20} /></span>
        <span className="min-w-0 flex-1">
          <b className="block text-base leading-tight text-ink">{title}</b>
          <span className={`text-[13px] font-extrabold ${on ? 'text-primary-700' : 'text-muted-soft'}`}>{sub}</span>
        </span>
        <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${on ? 'border-primary-700 bg-primary-700 text-white' : 'border-line-deep bg-white'}`}>
          {on && <Check size={12} strokeWidth={3} />}
        </span>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-paper" dir="rtl">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-1.5"><Zap size={14} />سجّل الآن — كاش أو قسط</span>}
        title="اشتراك مباشر في الكورسات"
        subtitle={<>
          اختار الكورسات أو المسارات وادفع بطريقتك — <strong className="font-extrabold text-primary-700">كاش {rates.cash > 0 ? `بخصم ${cashPct}%` : ''} ووصول كامل</strong> أو <strong className="font-extrabold text-ink">قسط {rates.install > 0 ? `بخصم ${installPct}% و` : 'بـ'}أول دفعة {firstPct}% فقط</strong>.
          سيُنشأ حسابك تلقائياً لحظة الدفع.
        </>}
      />

      {/* ── Steps + order summary ─────────────────────────────────────── */}
      <div className="container mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr]">

          {/* ── Steps 1 and 2: what, and how to pay ── */}
          <div className="min-w-0 rounded-[28px] bg-white p-5 ring-1 ring-line sm:p-7 lg:col-start-1 lg:row-start-1">
            {stepTitle(1, 'الكورسات المختارة')}

            <div className="space-y-3">
              {selectedIds.map((slotId, idx) => {
                const item = getItem(slotId);
                return (
                  <div key={idx} className="space-y-2">
                    {/* Dropdown row */}
                    <div className="flex items-center gap-2">
                      <div className="relative min-w-0 flex-1">
                        <select
                          value={slotId}
                          onChange={e => setSlot(idx, e.target.value)}
                          className={`${field} appearance-none pe-11 font-bold`}
                        >
                          <option value="">— اختر مسارًا أو كورسًا —</option>
                          {availableBundles.length > 0 && (
                            <optgroup label="📌 المسارات والباقات">
                              {availableBundles.map(b => {
                                const key = `bundle:${b.id}`;
                                return (
                                  <option key={b.id} value={key} disabled={chosenIds.has(key) && key !== slotId}>
                                    {b.title}
                                  </option>
                                );
                              })}
                            </optgroup>
                          )}
                          <optgroup label="🎓 الكورسات الفردية">
                            {availableCourses.map(c => {
                              const key = `course:${c.id}`;
                              return (
                                <option key={c.id} value={key} disabled={chosenIds.has(key) && key !== slotId}>
                                  {c.title}
                                </option>
                              );
                            })}
                          </optgroup>
                        </select>
                        <ChevronDown size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                      </div>
                      {selectedIds.length > 1 && (
                        <button
                          type="button"
                          aria-label="حذف"
                          onClick={() => removeSlot(idx)}
                          className="flex h-[50px] w-[50px] flex-none items-center justify-center rounded-xl text-red-600 ring-1 ring-line transition hover:bg-red-50"
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>

                    {/* Item preview card */}
                    {item && (
                      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-3 py-3 sm:px-4">
                        {item.kind === 'bundle' ? (
                          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-ink text-gold-pale">
                            <Award size={20} />
                          </span>
                        ) : item.thumbnail ? (
                          <img loading="lazy" decoding="async" src={cdnImg(item.thumbnail, 120)} width={48} height={48} alt={item.title} className="h-12 w-12 flex-none rounded-xl bg-sand object-cover" />
                        ) : (
                          <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">
                            <BookOpen size={20} />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-[15px] font-black leading-snug text-ink">{item.title}</p>
                          {item.kind === 'bundle'
                            ? <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-gold-deep"><Layers size={12} /> مسار — {item.courseIds.length} كورسات</p>
                            : item.instructor && <p className="mt-0.5 truncate text-xs text-muted">{item.instructor}</p>
                          }
                        </div>
                        <div className="flex-none text-left">
                          <p className="text-[15px] font-black tabular-nums text-ink">{money(getCharged(item))} <span className="text-xs font-bold text-muted">{currencySymbol}</span></p>
                          {getBasePrice(item) > getCharged(item) && <s className="block text-[11px] text-muted-faint tabular-nums">{money(getBasePrice(item))}</s>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add another course button */}
            {chosenCourses.length > 0 && selectedIds.every(id => id !== '') && (
              <button
                type="button"
                onClick={addSlot}
                className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line-deep text-sm font-extrabold text-primary-700 transition hover:border-primary-600 hover:bg-primary-50"
              >
                <Plus size={16} />
                أضف كورس آخر
              </button>
            )}

            <div className="mt-7 border-t border-line pt-6">
              {stepTitle(2, 'طريقة الدفع')}
              <div className="grid grid-cols-2 gap-2.5">
                {payToggle('cash', 'كاش', rates.cash > 0 ? `خصم ${cashPct}%` : 'بدون خصم', Banknote)}
                {payToggle('installment', 'قسط', <>{rates.install > 0 ? `خصم ${installPct}% + ` : ''}أول قسط {firstPct}%</>, CreditCard)}
              </div>
            </div>
          </div>

          {/* ── Order summary (beside the steps on a wide screen) ── */}
          <aside className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <div className="space-y-4 lg:sticky lg:top-24">
              {chosenCourses.length > 0 && (
                <div className="rounded-[28px] bg-ink p-5 text-white shadow-[0_40px_80px_-40px_rgba(26,15,18,.7)] sm:p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <p className="text-base font-black">ملخص الطلب</p>
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold-light px-2.5 py-1 text-[11px] font-black text-ink">
                      {payType === 'cash' ? <><CheckCircle size={12} /> وصول كامل</> : <><CalendarClock size={12} /> القسط الأول فقط</>}
                    </span>
                  </div>

                  {/* Per-course rows */}
                  <div className="divide-y divide-dashed divide-white/15">
                    {chosenCourses.map(c => {
                      const base = getBasePrice(c);
                      const installTotal = payType === 'installment' ? getInstallPrice(c) : 0;
                      const first = getCharged(c);
                      return (
                        <div key={c.key} className="py-3 first:pt-0">
                          <p className="mb-1.5 line-clamp-2 text-sm font-bold leading-snug">{c.title}</p>
                          {payType === 'cash' ? (
                            <div className="flex justify-between gap-3 text-[13px] tabular-nums">
                              <s className="text-white/40">{money(base)} {currencySymbol}</s>
                              <span className="font-black text-gold-pale">{money(first)} {currencySymbol}</span>
                            </div>
                          ) : (
                            <div className="space-y-1 text-[13px] tabular-nums">
                              <div className="flex justify-between gap-3 text-white/40">
                                <s>السعر الكامل</s>
                                <s className="font-bold">{money(base)} {currencySymbol}</s>
                              </div>
                              <div className="flex justify-between gap-3 text-white/75">
                                <span>{rates.install > 0 ? `بعد خصم ${installPct}%` : 'سعر الأقساط'} <span className="rounded bg-white/10 px-1.5 text-[11px]">سعر الأقساط</span></span>
                                <span className="font-bold">{money(installTotal)} {currencySymbol}</span>
                              </div>
                              <div className="flex justify-between gap-3 text-gold-pale">
                                <span>الدفعة الأولى <span className="rounded bg-white/10 px-1.5 text-[11px]">{firstPct}%</span></span>
                                <span className="font-black">{money(first)} {currencySymbol}</span>
                              </div>
                              <div className="flex justify-between gap-3 text-white/50">
                                <span>الباقي (أقساط لاحقة)</span>
                                <span className="font-bold">{money(installTotal - first)} {currencySymbol}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Cash / installment saving */}
                  {totalSaving > 0 && (
                    <div className="mt-1 flex justify-between gap-3 border-t border-white/15 pt-3 text-[13px] font-bold text-gold-light tabular-nums">
                      <span>{payType === 'cash' ? 'إجمالي الوفورات' : `وفورات خصم ${installPct}%`}</span>
                      <span>-{money(totalSaving)} {currencySymbol}</span>
                    </div>
                  )}

                  {/* Installment warning */}
                  {payType === 'installment' && (
                    <div className="mt-3 flex items-start gap-2 rounded-2xl bg-white/5 p-3 text-xs leading-relaxed text-white/75 ring-1 ring-white/10">
                      <AlertCircle size={14} className="mt-0.5 flex-none text-gold-light" />
                      <p>
                        <strong className="text-white">تنبيه:</strong> سعر الأقساط {rates.install > 0 ? `بعد خصم ${installPct}%` : ''} = <strong className="text-white">{money(totalInstallTotal)} {currencySymbol}</strong>.
                        المبلغ المطلوب الآن هو <strong className="text-white">القسط الأول ({firstPct}%)</strong> فقط. تفاصيل الأقساط المتبقية ستُرسل إليك بعد التسجيل.
                      </p>
                    </div>
                  )}

                  {/* Grand total */}
                  <div className="mt-4 rounded-[20px] bg-white/5 p-4 ring-1 ring-white/10">
                    <span className="block text-sm text-white/65">
                      {payType === 'installment' ? 'الدفعة الأولى المطلوبة الآن' : 'الإجمالي'}
                    </span>
                    <span className="mt-1 block text-[36px] font-black leading-none tabular-nums text-gold-pale">
                      {money(totalFinal)} <span className="text-base font-bold text-white/65">{currencySymbol}</span>
                    </span>
                    {payType === 'installment' && (
                      <p className="mt-2 text-[11px] leading-relaxed text-white/45">
                        السعر قبل الخصم: {money(totalOriginal)} {currencySymbol} · بعد خصم {installPct}%: {money(totalInstallTotal)} {currencySymbol}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* What the visitor can count on */}
              <ul className="grid gap-2.5 rounded-[24px] bg-white p-4 ring-1 ring-line sm:grid-cols-2 sm:p-5 lg:grid-cols-1">
                {[
                  { icon: Shield, text: 'حساب آمن محمي' },
                  { icon: Award, text: 'حساب تلقائي لحظة التسجيل' },
                  { icon: CheckCircle, text: 'كاش وصول كامل' },
                  { icon: Banknote, text: `قسط — ${rates.install > 0 ? `خصم ${installPct}% + ` : ''}أول دفعة ${firstPct}%` },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2.5 text-sm font-bold text-muted-strong">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-primary-50 text-primary-700"><Icon size={16} /></span>
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* ── Step 3: the account, or what happens next ── */}
          <div className="min-w-0 rounded-[28px] bg-white p-5 ring-1 ring-line sm:p-7 lg:col-start-1 lg:row-start-2 lg:self-start">
            {/* ── Payment iframe or registration form ── */}
            {submitted ? (
              <div className="space-y-4 py-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-50 ring-1 ring-green-200">
                  <CheckCircle size={32} className="text-green-600" />
                </div>
                <h3 className="text-xl font-black text-ink">تم إنشاء حسابك!</h3>
                <p className="mx-auto max-w-md text-[15px] leading-relaxed text-muted-body">
                  {onlinePayEnabled
                    ? 'حسابك جاهز. ادفع الآن — محفظة أو بطاقة أو فوري ويتفعّل وصولك فوراً، أو راسلنا واتساب.'
                    : 'حسابك جاهز. أرسل لنا واتساب لإتمام الدفع وتفعيل الكورسات.'}
                </p>

                {/* The page used to end at a WhatsApp link: the customer had an
                    account, a chosen course and a price, and still had to open
                    another app and type a message to hand over money. Checkout
                    prices the order on the server and hands it to the gateway,
                    so each chosen item gets a direct route there. */}
                {onlinePayEnabled && chosenCourses.map(item => (
                  <Link
                    key={item.key}
                    to={`/checkout?type=${item.kind}&id=${encodeURIComponent(item.key.replace(/^(course|bundle):/, ''))}&payMode=${payType}`}
                    className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-4 text-[15px] font-black text-white transition hover:bg-primary-800"
                  >
                    <CreditCard size={18} className="flex-none" />
                    {chosenCourses.length > 1
                      ? <>ادفع بالبطاقة — {item.title}</>
                      : <>ادفع الآن — محفظة أو بطاقة أو فوري — {money(totalFinal)} {currencySymbol}</>}
                  </Link>
                ))}
                {onlinePayEnabled && chosenCourses.length > 1 && (
                  <p className="text-xs text-muted-soft">كل برنامج له طلب دفع مستقل — ادفعهم واحداً تلو الآخر.</p>
                )}

                <a
                  href={`https://wa.me/${whatsappNumber}?text=${registeredWhatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-extrabold transition ${
                    onlinePayEnabled
                      ? 'border-[1.5px] border-green-600 text-green-700 hover:bg-green-50'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  <MessageCircle size={18} />
                  {onlinePayEnabled ? 'أو تواصل معنا عبر واتساب' : 'تواصل معنا عبر واتساب لإتمام الدفع'}
                </a>
                {/* Only claim card payment is suspended when it actually is —
                    this used to be stated unconditionally. */}
                {onlinePayEnabled === false && (
                  <div className="flex items-start gap-2 rounded-xl bg-paper p-3 text-right text-xs leading-relaxed text-muted-strong ring-1 ring-line">
                    <AlertCircle size={14} className="mt-0.5 flex-none text-primary-700" />
                    الدفع الإلكتروني متوقف مؤقتاً — سيتواصل معك فريقنا لتفعيل حسابك فور تأكيد الدفع.
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handlePay} className="space-y-4">
                {stepTitle(3, isSignedIn ? 'تأكيد الطلب' : 'بيانات الحساب الجديد')}
                {isSignedIn && (
                  <div className="flex items-center gap-2 rounded-xl bg-green-50 p-3 text-sm text-green-800 ring-1 ring-green-200">
                    <CheckCircle size={16} className="flex-none" />
                    <span>أنت مسجّل الدخول باسم <b>{authUser?.displayName || authUser?.email}</b> — هنكمل على حسابك.</span>
                  </div>
                )}
                {!isSignedIn && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={label}>الاسم الكامل *</label>
                      <input
                        required value={fullName} onChange={e => setFullName(e.target.value)}
                        placeholder="الاسم الرباعي" autoComplete="name"
                        className={field}
                      />
                    </div>
                    <div>
                      <label className={label}>رقم الهاتف (واتساب) *</label>
                      <input
                        required value={phone} onChange={e => setPhone(e.target.value)}
                        placeholder="01xxxxxxxxx" type="tel" dir="ltr" autoComplete="tel"
                        className={`${field} text-right`}
                      />
                    </div>
                    <div>
                      <label className={label}>البريد الإلكتروني *</label>
                      <input
                        required value={email} onChange={e => setEmail(e.target.value)}
                        placeholder="example@email.com" type="email" dir="ltr" autoComplete="email"
                        className={field}
                      />
                    </div>
                    <div>
                      <label className={label}>كلمة المرور *</label>
                      <input
                        required value={password} onChange={e => setPassword(e.target.value)}
                        placeholder="8 أحرف على الأقل" type="password" autoComplete="new-password" minLength={8}
                        aria-describedby="enroll-password-rule"
                        className={field}
                      />
                      {/* The rule said «6» while the server and the button wanted 8: the
                          button stayed off with nothing saying why. Said before submit now. */}
                      <p id="enroll-password-rule" className={`mt-1 text-xs font-bold ${password.length >= 8 ? 'text-green-700' : 'text-muted'}`}>
                        {password.length >= 8 ? 'كلمة المرور تمام ✓' : `كلمة المرور لازم تكون 8 حروف أو أرقام على الأقل${password ? ` — فاضل ${8 - password.length}` : ''}`}
                      </p>
                    </div>
                  </div>
                )}
                <div>
                  <label className={label}>تحضر فين؟ <span className="font-normal text-muted-soft">(اختياري)</span></label>
                  <select
                    value={branch} onChange={e => setBranch(e.target.value)}
                    className={field}
                  >
                    <option value="">— اختر الفرع —</option>
                    <option value="daqqi">فرع الدقي</option>
                    <option value="tagamoa">فرع التجمع</option>
                    <option value="online-egypt">أونلاين محلي (مصر)</option>
                    <option value="online-saudi">أونلاين سعودي</option>
                    <option value="online-abroad">أونلاين دولي</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>

                {error && (
                  <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700 ring-1 ring-red-200">
                    <AlertCircle size={16} className="mt-0.5 flex-none" />
                    {error}
                  </div>
                )}

                {!isSignedIn && (
                  <div className="flex items-start gap-2 rounded-xl bg-paper p-3 text-[13px] leading-relaxed text-muted ring-1 ring-line">
                    <Shield size={15} className="mt-0.5 flex-none text-primary-700" />
                    هتكمّل التسجيل والدفع في الخطوة الجاية، وحسابك هيتفتح أول ما الدفع يتم.
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !canPay}
                  className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-4 text-base font-black text-white shadow-[0_16px_30px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  {/* The account has to exist before there is anything to pay
                      for, so this step stays — but when cards are live the next
                      screen is a payment page, and promising a phone call
                      instead sent people looking for WhatsApp. */}
                  {loading
                    ? <><Loader2 size={18} className="animate-spin" /> جاري التجهيز...</>
                    : onlinePayEnabled
                      ? <><CreditCard size={18} /> سجّل وادفع الآن — {totalFinal.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</>
                      : <><MessageCircle size={18} /> سجّل وتواصل معنا — {totalFinal.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</>
                  }
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Enrollment;
