import React, { FormEvent, useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, CheckCircle, Banknote, Plus, Loader2, Shield, ChevronDown, Trash2, Zap, Award, MessageCircle, AlertCircle, CreditCard } from 'lucide-react';
import { mysqlAuth } from '../lib/mysqlapi';
import { useSiteData } from '../context/SiteDataContext';
import type { Course, BranchType } from '../types';
import { cdnImg } from '../lib/img';

// ── Payment type ──────────────────────────────────────────────────────────────
type PayType = 'cash' | 'installment';

const CASH_DISCOUNT = 0.15;      // 15% off → full access
const INSTALL_FIRST_PCT = 0.25;  // first installment = 25% of discounted price
const INSTALL_DISCOUNT = 0.07;   // 7% off base price on installment payments
const INSTALL_LIMIT = 20;

// ── Arabic error messages ────────────────────────────────────────────
const authAr: Record<string, string> = {
  'Email already registered': 'هذا البريد الإلكتروني مستخدم بالفعل، يرجى تسجيل الدخول.',
  'Invalid credentials': 'كلمة المرور غير صحيحة.',
  'Password must be at least 6 characters': 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.',
};

// ── Component ─────────────────────────────────────────────────────────────────
const Enrollment: React.FC = () => {
  useEffect(() => { document.title = 'التسجيل في الكورس | معهد الدراسات النفسية'; }, []);
  const { courses, bundles, currency, content } = useSiteData();

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

  // Selected item keys (multi-select via dropdowns)
  const [selectedIds, setSelectedIds] = useState<string[]>(['']);  // start with one empty slot
  const [payType, setPayType] = useState<PayType>('cash');
  const [branch, setBranch] = useState('');

  // Pre-select from URL params: ?course=ID or ?bundle=ID
  useEffect(() => {
    const courseId = searchParams.get('course');
    const bundleId = searchParams.get('bundle');
    if (courseId) setSelectedIds([`course:${courseId}`]);
    else if (bundleId) setSelectedIds([`bundle:${bundleId}`]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allOptions]);

  // Form fields
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [registeredWhatsapp, setRegisteredWhatsapp] = useState('');

  const currencySymbol = currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$';
  const whatsappNumber = (content['footer.whatsapp'] || '201096203090').replace(/\D/g, '');

  const getItem = (key: string) => allOptions.find(x => x.key === key) ?? null;
  const getBasePrice = (item: SelItem) => item.price[currency] || item.price.EGP;
  const getInstallPrice = (item: SelItem) => Math.round(getBasePrice(item) * (1 - INSTALL_DISCOUNT));

  // cash → 15% off; installment → 7% off total, then 25% first installment
  const getCharged = (item: SelItem) =>
    payType === 'cash'
      ? Math.round(getBasePrice(item) * (1 - CASH_DISCOUNT))
      : Math.round(getInstallPrice(item) * INSTALL_FIRST_PCT);

  // Deduplicated chosen items (ignore empty slots)
  const chosenCourses = useMemo(
    () => [...new Map(
      selectedIds.filter(Boolean).map(key => [key, getItem(key)]).filter(([, c]) => c !== null) as [string, SelItem][]
    ).values()],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIds, allOptions]
  );

  const totalOriginal    = chosenCourses.reduce((s, c) => s + getBasePrice(c), 0);
  const totalFinal       = chosenCourses.reduce((s, c) => s + getCharged(c), 0);
  const totalInstallTotal = payType === 'installment' ? chosenCourses.reduce((s, c) => s + getInstallPrice(c), 0) : 0;
  const totalSaving      = payType === 'cash' ? totalOriginal - totalFinal : Math.round(totalOriginal * INSTALL_DISCOUNT);

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
    setError('');
    setLoading(true);

    try {
      // Create or sign in to MySQL account
      let uid = '';
      try {
        const result = await mysqlAuth.register({ email: email.trim(), password, name: fullName.trim() });
        uid = result.user.uid;
      } catch (authErr) {
        const msg = authErr instanceof Error ? authErr.message : '';
        if (msg === 'Email already registered') {
          try {
            const result = await mysqlAuth.login(email.trim(), password);
            uid = result.user.uid;
          } catch {
            throw new Error('البريد الإلكتروني مسجل بكلمة مرور مختلفة. أدخل نفس كلمة المرور التي استخدمتها من قبل، أو سجّل الدخول من صفحة الدخول.');
          }
        } else {
          throw new Error(authAr[msg] || 'تعذر إنشاء الحساب، حاول مرة أخرى.');
        }
      }

      // Build WhatsApp message with order details
      const firstItem = chosenCourses[0];
      const itemTitles = chosenCourses.map(c => c.title).join('، ');
      const waMsg = `مرحباً، أريد الاشتراك في:\n${itemTitles}\n\nالإجمالي: ${totalFinal.toLocaleString('ar-EG-u-nu-latn')} ${currencySymbol} (${payType === 'cash' ? 'كاش - خصم 15%' : 'أول قسط 25%'})\nالاسم: ${fullName.trim()}\nالهاتف: ${phone.trim()}\nالبريد: ${email.trim()}`;
      setRegisteredWhatsapp(encodeURIComponent(waMsg));
      void uid; void firstItem;
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ، حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  const canPay = chosenCourses.length > 0 && fullName.trim() && phone.trim() && email.trim() && password.length >= 6;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-primary-950 to-slate-900" dir="rtl">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-10 right-20 w-64 h-64 bg-primary-400 rounded-full filter blur-3xl" />
          <div className="absolute bottom-10 left-20 w-80 h-80 bg-amber-400 rounded-full filter blur-3xl" />
        </div>
        <div className="relative container mx-auto px-4 py-14 text-center text-white">
          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm font-bold mb-5">
            <Zap size={14} className="text-amber-400" />
            سجّل الآن — كاش أو قسط
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold mb-3 leading-tight">اشتراك مباشر في الكورسات</h1>
          <p className="text-white/60 text-base max-w-lg mx-auto">
            اختار الكورسات أو المسارات وادفع بطريقتك — <strong className="text-green-400">كاش بخصم 15% ووصول كامل</strong> أو <strong className="text-amber-400">قسط بخصم 7% وأول دفعة 25% فقط</strong>.
            سيُنشأ حسابك تلقائياً لحظة الدفع.
          </p>
        </div>
      </div>

      {/* ── Main card ────────────────────────────────────────────────── */}
      <div className="container mx-auto px-4 pb-20 max-w-2xl">
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">

          {/* Payment type toggle */}
          <div className="grid grid-cols-2 border-b border-gray-100">
            <button
              type="button"
              onClick={() => setPayType('cash')}
              className={`flex items-center justify-center gap-2 py-4 font-extrabold text-sm transition border-b-2 ${
                payType === 'cash'
                  ? 'border-green-500 text-green-700 bg-green-50'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <Banknote size={17} />
              كاش — خصم <span className="text-green-600 ml-0.5">15%</span>
              {payType === 'cash' && <CheckCircle size={14} className="text-green-500" />}
            </button>
            <button
              type="button"
              onClick={() => setPayType('installment')}
              className={`flex items-center justify-center gap-2 py-4 font-extrabold text-sm transition border-b-2 ${
                payType === 'installment'
                  ? 'border-amber-500 text-amber-700 bg-amber-50'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <CreditCard size={17} />
              قسط — <span className="text-amber-600 ml-0.5">خصم 7% + أول قسط 25%</span>
              {payType === 'installment' && <CheckCircle size={14} className="text-amber-500" />}
            </button>
          </div>

          <div className="p-6 space-y-6">

            {/* ── Course dropdowns ── */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">الكورسات المختارة</p>

              <div className="space-y-3">
                {selectedIds.map((slotId, idx) => {
                  const item = getItem(slotId);
                  return (
                    <div key={idx} className="space-y-2">
                      {/* Dropdown row */}
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <select
                            value={slotId}
                            onChange={e => setSlot(idx, e.target.value)}
                            className="w-full appearance-none border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:border-primary-400 pr-10 text-gray-700"
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
                          <ChevronDown size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                        {selectedIds.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSlot(idx)}
                            className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>

                      {/* Item preview card */}
                      {item && (
                        <div className="flex items-center gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                          {item.kind === 'bundle' ? (
                            <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                              <Award size={20} className="text-purple-600" />
                            </div>
                          ) : item.thumbnail ? (
                            <img loading="lazy" decoding="async" src={cdnImg(item.thumbnail, 120)} alt={item.title} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-primary-100 flex items-center justify-center shrink-0">
                              <BookOpen size={20} className="text-primary-600" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 text-sm line-clamp-1">{item.title}</p>
                            {item.kind === 'bundle'
                              ? <p className="text-xs text-purple-500 mt-0.5">📌 مسار — {item.courseIds.length} كورسات</p>
                              : item.instructor && <p className="text-xs text-gray-400 mt-0.5">{item.instructor}</p>
                            }
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-extrabold text-gray-900 text-sm">{getCharged(item).toLocaleString('ar-EG-u-nu-latn')} <span className="text-xs font-normal text-gray-400">{currencySymbol}</span></p>
                            <p className="text-[10px] text-gray-400 line-through">{getBasePrice(item).toLocaleString('ar-EG-u-nu-latn')}</p>
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
                  className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-primary-300 text-primary-600 hover:border-primary-500 hover:bg-primary-50 rounded-xl text-sm font-bold transition"
                >
                  <Plus size={16} />
                  أضف كورس آخر
                </button>
              )}
            </div>

            {/* ── Order summary ── */}
            {chosenCourses.length > 0 && (
              <div className={`rounded-2xl p-4 border ${payType === 'cash' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-gray-600">ملخص الطلب</p>
                  <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${payType === 'cash' ? 'bg-green-200 text-green-800' : 'bg-amber-200 text-amber-800'}`}>
                    {payType === 'cash' ? '✅ وصول كامل' : '⏳ القسط الأول فقط'}
                  </span>
                </div>

                {/* Per-course rows */}
                {chosenCourses.map(c => {
                  const base = getBasePrice(c);
                  const installTotal = payType === 'installment' ? getInstallPrice(c) : 0;
                  const first = getCharged(c);
                  return (
                    <div key={c.key} className="mb-3 pb-3 border-b border-dashed border-gray-200 last:border-0 last:mb-0 last:pb-0">
                      <p className="text-xs font-bold text-gray-700 line-clamp-1 mb-1.5">{c.title}</p>
                      {payType === 'cash' ? (
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-400 line-through">{base.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</span>
                          <span className="font-extrabold text-green-700">{first.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs text-gray-400">
                            <span className="line-through">السعر الكامل</span>
                            <span className="line-through font-bold">{base.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</span>
                          </div>
                          <div className="flex justify-between text-xs text-green-700">
                            <span>بعد خصم 7% <span className="text-[10px] bg-green-100 px-1 rounded">سعر الأقساط</span></span>
                            <span className="font-bold">{installTotal.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</span>
                          </div>
                          <div className="flex justify-between text-xs text-amber-700">
                            <span>الدفعة الأولى <span className="text-[10px] bg-amber-100 px-1 rounded">25%</span></span>
                            <span className="font-extrabold">{first.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</span>
                          </div>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>الباقي (أقساط لاحقة)</span>
                            <span className="font-bold">{(installTotal - first).toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Cash / installment saving */}
                {totalSaving > 0 && (
                  <div className={`flex justify-between text-xs mt-1 pt-1 border-t ${payType === 'cash' ? 'text-green-700 border-green-200' : 'text-green-700 border-gray-200'}`}>
                    <span>{payType === 'cash' ? 'إجمالي الوفورات' : 'وفورات خصم 7%'}</span>
                    <span className="font-bold">-{totalSaving.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</span>
                  </div>
                )}

                {/* Installment warning */}
                {payType === 'installment' && (
                  <div className="bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 mt-3 text-xs text-amber-800">
                    <strong>⚠️ تنبيه:</strong> سعر الأقساط بعد خصم 7% = <strong>{totalInstallTotal.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</strong>.
                    المبلغ المطلوب الآن هو <strong>القسط الأول (25%)</strong> فقط. تفاصيل الأقساط المتبقية ستُرسل إليك بعد التسجيل.
                  </div>
                )}

                {/* Grand total */}
                <div className="flex justify-between items-baseline mt-3 pt-3 border-t border-gray-300">
                  <span className="text-sm font-extrabold text-gray-800">
                    {payType === 'installment' ? 'الدفعة الأولى المطلوبة الآن' : 'الإجمالي'}
                  </span>
                  <span className="text-xl font-extrabold text-gray-900">
                    {totalFinal.toLocaleString('ar-EG-u-nu-latn')} <span className="text-sm font-normal text-gray-500">{currencySymbol}</span>
                  </span>
                </div>
                {payType === 'installment' && (
                  <p className="text-[10px] text-gray-400 text-left mt-1">
                    السعر قبل الخصم: {totalOriginal.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol} · بعد خصم 7%: {totalInstallTotal.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}
                  </p>
                )}
              </div>
            )}

            {/* ── Payment iframe or registration form ── */}
            {submitted ? (
              <div className="text-center py-6 space-y-4">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle size={32} className="text-green-600" />
                </div>
                <h3 className="text-lg font-extrabold text-gray-900">تم إنشاء حسابك!</h3>
                <p className="text-gray-500 text-sm">
                  حسابك جاهز. أرسل لنا واتساب لإتمام الدفع وتفعيل الكورسات.
                </p>
                <a
                  href={`https://wa.me/${whatsappNumber}?text=${registeredWhatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition text-sm"
                >
                  <MessageCircle size={18} />
                  تواصل معنا عبر واتساب لإتمام الدفع
                </a>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 text-right">
                  <AlertCircle size={13} className="inline ml-1" />
                  الدفع الإلكتروني متوقف مؤقتاً — سيتواصل معك فريقنا لتفعيل حسابك فور تأكيد الدفع.
                </div>
              </div>
            ) : (
              <form onSubmit={handlePay} className="space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">بيانات الحساب الجديد</p>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">الاسم الكامل *</label>
                  <input
                    required value={fullName} onChange={e => setFullName(e.target.value)}
                    placeholder="الاسم الرباعي"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">رقم الهاتف (واتساب) *</label>
                  <input
                    required value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="01xxxxxxxxx" type="tel"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">البريد الإلكتروني *</label>
                  <input
                    required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="example@email.com" type="email" dir="ltr"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">كلمة المرور *</label>
                  <input
                    required value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="6 أحرف على الأقل" type="password"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-600 mb-1 block">تحضر فين؟ <span className="text-gray-400 font-normal">(اختياري)</span></label>
                  <select
                    value={branch} onChange={e => setBranch(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400 bg-white text-gray-700"
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
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-3 py-2.5">
                    {error}
                  </div>
                )}

                <div className="flex items-start gap-2 bg-gray-50 rounded-xl p-3 text-xs text-gray-500">
                  <Shield size={14} className="text-primary-600 shrink-0 mt-0.5" />
                  سيتم إنشاء حسابك تلقائياً بعد الدفع وستجد الكورس في لوحة التحكم الخاصة بك.
                </div>

                <button
                  type="submit"
                  disabled={loading || !canPay}
                  className="w-full py-3.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white font-extrabold rounded-xl transition flex items-center justify-center gap-2 text-sm"
                >
                  {loading
                    ? <><Loader2 size={18} className="animate-spin" /> جاري التجهيز...</>
                    : <><MessageCircle size={18} /> سجّل وتواصل معنا — {totalFinal.toLocaleString('ar-EG-u-nu-latn')} {currencySymbol}</>
                  }
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Info badges below card */}
        <div className="flex flex-wrap gap-3 justify-center mt-6 text-xs text-white/50">
          <div className="flex items-center gap-1.5"><Shield size={12} className="text-blue-400" /> حساب آمن محمي</div>
          <div className="flex items-center gap-1.5"><Award size={12} className="text-purple-400" /> حساب تلقائي لحظة التسجيل</div>
          <div className="flex items-center gap-1.5"><CheckCircle size={12} className="text-green-400" /> كاش وصول كامل</div>
          <div className="flex items-center gap-1.5"><Banknote size={12} className="text-amber-400" /> قسط — خصم 7% + أول دفعة 25%</div>
        </div>
      </div>
    </div>
  );
};

export default Enrollment;
