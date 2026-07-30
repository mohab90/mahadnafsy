import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Check, AlertCircle, LogIn, MessageCircle, Banknote, Loader2 } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { getTherapistSessionPrice } from '../lib/consultations';
import { cdnImg } from '../lib/img';

const Checkout: React.FC = () => {
  useEffect(() => { document.title = 'إتمام الاشتراك | معهد الدراسات النفسية'; }, []);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { courses, bundles, therapists, content, currency, authUser, subscribers } = useSiteData();
  const paymentLinkToken = searchParams.get('paymentToken') || searchParams.get('token');
  const [paymentLink, setPaymentLink] = useState<{
    item_type: string; item_id: string; amount: number; currency: 'EGP' | 'SAR' | 'USD';
    description?: string | null; item?: { title?: string; title_ar?: string } | null;
  } | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(Boolean(paymentLinkToken));
  const [paymentLinkError, setPaymentLinkError] = useState('');
  const type = paymentLink?.item_type || searchParams.get('type');
  const id = paymentLink?.item_id || searchParams.get('id');
  const subtype = searchParams.get('subtype'); // For consultations

  // Every payment proof must belong to an authenticated customer and order.
  const requiresLogin = ['course', 'bundle', 'consultation', 'certificate'].includes(type || '');

  useEffect(() => {
    if (!paymentLinkToken) return;
    setPaymentLinkLoading(true);
    fetch(`/api/payment-links/${encodeURIComponent(paymentLinkToken)}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.pl) throw new Error(data.error || 'رابط الدفع غير صالح');
        setPaymentLink({ ...data.pl, item: data.item || null });
      })
      .catch((error) => setPaymentLinkError(error instanceof Error ? error.message : 'رابط الدفع غير صالح'))
      .finally(() => setPaymentLinkLoading(false));
  }, [paymentLinkToken]);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [orderSent, setOrderSent] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [serverAmount, setServerAmount] = useState<number | null>(null);
  const [serverCurrency, setServerCurrency] = useState<'EGP' | 'SAR' | 'USD' | null>(null);
  // Self-service receipt upload (after order is placed)
  const [proofImage, setProofImage] = useState('');
  const [proofMethod, setProofMethod] = useState('انستا باي');
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofDone, setProofDone] = useState(false);
  const [proofError, setProofError] = useState('');

  // Auto-fill name & email from logged-in user
  useEffect(() => {
    if (authUser) {
      setCustomerName(authUser.displayName || authUser.email?.split('@')[0] || '');
      setCustomerEmail(authUser.email || '');
      // Pre-fill phone from existing subscriber record, else from the auth profile (lead phone).
      const sub = subscribers.find(
        s => s.email.toLowerCase().trim() === (authUser.email || '').toLowerCase().trim()
      );
      const phone = sub?.phone || (authUser as { phone?: string }).phone || '';
      if (phone) setCustomerPhone(phone);
    }
  }, [authUser, subscribers]);

  // Determine Item details
  let itemTitle = '';
  let itemPrice = 0;
  let itemImage = '';
  let itemFound = false;

  if (type === 'course') {
      const course = courses.find(c => c.id === id);
      if (course) {
          itemTitle = course.title;
          itemPrice = course.price?.[currency] ?? 0;
          itemImage = course.thumbnail;
          itemFound = true;
      }
  } else if (type === 'bundle') {
      const bundle = bundles.find(b => b.id === id);
      if (bundle) {
          itemTitle = bundle.title;
          itemPrice = bundle.price?.[currency] ?? 0;
          itemImage = bundle.courses[0]?.thumbnail ?? '';
          itemFound = true;
      }
  } else if (type === 'consultation') {
      if (subtype === 'express') {
          itemTitle = 'جلسة استشارة سريعة (Express)';
          itemPrice = Number(content[`express.price.${currency}`] || searchParams.get('price'));
          itemImage = content['consultation.expressImage'] || '';
          itemFound = true;
      } else {
          const therapistId = searchParams.get('therapistId');
          const therapist = therapists.find(t => t.id === therapistId);
          if (therapist) {
            itemTitle = `جلسة علاج نفسي مع ${therapist.name}`;
                        itemPrice = getTherapistSessionPrice(therapist, currency);
            itemImage = therapist.image;
            itemFound = true;
          }
      }
  } else if (type === 'certificate') {
      itemTitle = decodeURIComponent(searchParams.get('title') || 'شهادة إضافية');
      itemPrice = Number(searchParams.get('amount') || 0);
      itemFound = true;
  }
  if (paymentLink) {
    itemPrice = Number(paymentLink.amount) || 0;
    itemTitle = paymentLink.item?.title_ar || paymentLink.item?.title || paymentLink.description || itemTitle;
    itemFound = Boolean(paymentLink.item) && itemPrice > 0;
  }

  // Display follows verified location; the server independently recalculates it.
  const settlementCurrency = serverCurrency || paymentLink?.currency || (type === 'certificate' && ['EGP', 'SAR', 'USD'].includes(searchParams.get('currency') || '')
    ? searchParams.get('currency') as 'EGP' | 'SAR' | 'USD' : currency);
  const currencySymbol = settlementCurrency === 'SAR' ? 'ر.س' : settlementCurrency === 'USD' ? '$' : 'ج.م';
  const finalAmount = serverAmount ?? itemPrice;
  const whatsapp = (content['footer.whatsapp'] || '').replace(/\D/g, '');

  const canPay = !!customerName.trim() && customerEmail.includes('@') && !!customerPhone.trim() && itemFound && itemPrice > 0;

  const handlePay = async () => {
    if (!canPay) return;
    setPayLoading(true);
    setPayError('');
    try {
      const token = localStorage.getItem('mahad-token');
      if (!token) throw new Error('سجّل الدخول أولاً لإتمام الطلب');
      const idempotencyStorageKey = `checkout-idempotency:${type}:${id || subtype || 'item'}:${paymentLinkToken || ''}`;
      const idempotencyKey = sessionStorage.getItem(idempotencyStorageKey) || crypto.randomUUID();
      sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
      const response = await fetch('/api/public/checkout-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          itemId: id, itemType: type, itemTitle,
          ...(paymentLinkToken ? { paymentLinkToken } : {}),
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim(),
          amount: itemPrice, currency,
          ...(type === 'consultation' ? {
            therapistId: searchParams.get('therapistId') || '',
            sessionDate: searchParams.get('date') || '',
            sessionType: searchParams.get('sessionType') || 'individual',
            subtype: subtype || 'regular',
          } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.orderId) throw new Error(data.error || 'تعذّر إنشاء الطلب');
      setOrderId(String(data.orderId));
      setServerAmount(Number(data.amount));
      setServerCurrency(data.currency === 'SAR' || data.currency === 'USD' ? data.currency : 'EGP');
      setOrderSent(true);
      sessionStorage.removeItem(idempotencyStorageKey);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'حدث خطأ، حاول مرة أخرى.');
    } finally {
      setPayLoading(false);
    }
  };

  // Convert the chosen receipt file → base64 for upload.
  const onProofFile = (file?: File) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setProofError('الصورة أكبر من 4 ميجا'); return; }
    const reader = new FileReader();
    reader.onload = () => { setProofImage(String(reader.result || '')); setProofError(''); };
    reader.readAsDataURL(file);
  };

  // Self-service: submit the transfer receipt → goes to admin review → on approval
  // the payment is recorded, access enrolled, and the lifecycle receipt fires.
  const submitProof = async () => {
    if (!proofImage) { setProofError('ارفع صورة الإيصال أولاً'); return; }
    if (!orderId) { setProofError('الطلب غير مكتمل؛ أعد إنشاء الطلب'); return; }
    setProofSubmitting(true); setProofError('');
    try {
      const token = localStorage.getItem('mahad-token');
      const intentRes = await fetch('/api/me/payment-intents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ order_id: orderId, provider: 'manual', idempotency_key: `checkout:${orderId}` }),
      });
      const intent = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok || !intent.id) throw new Error(intent.error || 'تعذّر تجهيز عملية الدفع');
      const res = await fetch('/api/me/payment-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          order_id: orderId,
          payment_intent_id: intent.id,
          payment_method: proofMethod, proof_image: proofImage,
          note: `طلب ذاتي: ${itemTitle}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذّر إرسال الإيصال');
      setProofDone(true);
    } catch (e) { setProofError(e instanceof Error ? e.message : 'تعذّر إرسال الإيصال'); }
    finally { setProofSubmitting(false); }
  };

  // Require login before any payable customer workflow.
  if (paymentLinkLoading) {
    return <div className="min-h-screen bg-gray-50 grid place-items-center text-gray-500" dir="rtl"><Loader2 className="animate-spin" /> جاري التحقق من رابط الدفع...</div>;
  }
  if (paymentLinkError) {
    return <div className="min-h-screen bg-gray-50 grid place-items-center p-4" dir="rtl"><div className="rounded-2xl border border-red-200 bg-white p-8 text-center text-red-700">{paymentLinkError}</div></div>;
  }
  if (requiresLogin && authUser === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-xl p-10 text-center border border-gray-100">
          <div className="w-20 h-20 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <LogIn size={36} className="text-primary-600" />
          </div>
          <h2 className="text-2xl font-extrabold text-gray-900 mb-3">يرجى تسجيل الدخول أولاً</h2>
          <p className="text-gray-500 mb-8">لإتمام الشراء وضمان وصولك للكورس، يجب تسجيل الدخول أو إنشاء حساب جديد أولاً.</p>
          <div className="flex flex-col gap-3">
            <Link
              to={`/auth?redirect=${encodeURIComponent(window.location.hash.slice(1))}`}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition"
            >
              تسجيل الدخول / إنشاء حساب
            </Link>
            <button onClick={() => navigate(-1)} className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl transition">
              رجوع
            </button>
          </div>
        </div>
      </div>
    );
  }

    if (!itemFound) {
        return (
            <div className="bg-gray-50 min-h-screen py-10">
                <div className="container mx-auto px-4 max-w-3xl">
                    <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm">
                        <h1 className="text-2xl font-extrabold text-gray-900 mb-3">الطلب غير صالح</h1>
                        <p className="text-gray-600 mb-6">لم نتمكن من العثور على المنتج المطلوب. من فضلك ارجع للصفحة السابقة وأعد المحاولة.</p>
                        <button
                            onClick={() => navigate(-1)}
                            className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-6 py-3 rounded-xl transition"
                        >
                            رجوع
                        </button>
                    </div>
                </div>
            </div>
        );
    }

  return (
    <div className="bg-gray-50 min-h-screen py-10" dir="rtl">
        <div className="container mx-auto px-4 max-w-4xl">
            <h1 className="text-2xl font-bold mb-8 text-gray-900">إتمام الشراء</h1>

            {/* Payment-gateway suspended notice */}
            <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 mb-6 flex items-start gap-3">
              <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-amber-800 text-sm">
                <strong>الدفع الإلكتروني متوقف مؤقتاً.</strong> يُرجى إتمام الدفع عبر التحويل البنكي أو واتساب وسيتواصل معك فريقنا لتأكيد التسجيل.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Contact / payment form */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 order-2 md:order-1">
                  {orderSent ? (
                    proofDone ? (
                    <div className="text-center py-4">
                      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Check size={32} className="text-green-600" />
                      </div>
                      <h3 className="text-lg font-extrabold text-gray-900 mb-2">تم استلام إيصالك ✅</h3>
                      <p className="text-gray-500 text-sm mb-6">هنراجع الإيصال ونفعّل وصولك للكورس خلال وقت قصير — وهيوصلك تأكيد على بريدك وواتساب.</p>
                      <Link to="/my-account" className="inline-block w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition text-sm">الذهاب لحسابي</Link>
                    </div>
                    ) : (
                    <div className="py-2">
                      <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Check size={28} className="text-green-600" />
                      </div>
                      <h3 className="text-base font-extrabold text-gray-900 mb-1 text-center">تم استلام طلبك! 🎉</h3>
                      <p className="text-gray-500 text-xs mb-4 text-center">حوّل المبلغ ({finalAmount} {currencySymbol}) ثم ارفع صورة الإيصال هنا لتفعيل وصولك فوراً بعد المراجعة.</p>

                      {/* Payment instructions (configurable from admin content) */}
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 text-xs text-blue-900 whitespace-pre-line leading-6">
                        <p className="font-bold flex items-center gap-1 mb-1"><Banknote size={14}/> تعليمات التحويل</p>
                        {content['finance.payment_instructions'] || 'إنستاباي / فودافون كاش / تحويل بنكي — راسلنا واتساب لطلب رقم الحساب إن لم يظهر هنا.'}
                      </div>

                      {/* Receipt upload */}
                      <label className="block text-xs font-semibold text-gray-600 mb-1">طريقة الدفع</label>
                      <select value={proofMethod} onChange={e => setProofMethod(e.target.value)}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3">
                        {['انستا باي', 'فودافون كاش', 'تحويل بنكي', 'اخرى'].map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">صورة الإيصال</label>
                      <input type="file" accept="image/*" onChange={e => onProofFile(e.target.files?.[0])}
                        className="w-full text-xs mb-2 file:ml-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary-50 file:text-primary-700" />
                      {proofImage && <img loading="lazy" decoding="async" src={proofImage} alt="receipt" className="max-h-36 rounded-lg border border-gray-100 mb-3 mx-auto object-contain" />}

                      {proofError && <p className="text-red-600 text-xs mb-2">{proofError}</p>}
                      <button onClick={submitProof} disabled={proofSubmitting || !proofImage}
                        className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition text-sm mb-3">
                        {proofSubmitting ? <><Loader2 size={16} className="animate-spin" /> جارٍ الإرسال...</> : 'إرسال الإيصال وتفعيل الوصول'}
                      </button>

                      {whatsapp && (
                        <a
                          href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`مرحباً، حوّلت لاشتراك: ${itemTitle} (${finalAmount} ${currencySymbol})\nالاسم: ${customerName}\nالهاتف: ${customerPhone}`)}`}
                          target="_blank" rel="noreferrer"
                          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition text-sm"
                        >
                          <MessageCircle size={17} /> أرسل الإيصال عبر واتساب بدلاً من ذلك
                        </a>
                      )}
                      <button onClick={() => setOrderSent(false)} className="block w-full text-center mt-3 text-xs text-gray-400 underline">تعديل البيانات</button>
                    </div>
                    )
                  ) : (
                    <>
                      <h2 className="text-lg font-bold mb-4 text-gray-900">بياناتك</h2>
                      <div className="space-y-3 mb-5">
                        <div>
                          <label htmlFor="checkout-customer-name" className="block text-xs font-semibold text-gray-600 mb-1">الاسم الكامل</label>
                          <input
                            id="checkout-customer-name"
                            type="text"
                            value={customerName}
                            onChange={e => setCustomerName(e.target.value)}
                            placeholder="أدخل اسمك الكامل"
                            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                          />
                        </div>
                        <div>
                          <label htmlFor="checkout-customer-email" className="block text-xs font-semibold text-gray-600 mb-1">البريد الإلكتروني</label>
                          <input
                            id="checkout-customer-email"
                            type="email"
                            value={customerEmail}
                            onChange={e => setCustomerEmail(e.target.value)}
                            placeholder="example@email.com"
                            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                          />
                        </div>
                        <div>
                          <label htmlFor="checkout-customer-phone" className="block text-xs font-semibold text-gray-600 mb-1">رقم الهاتف (واتساب)</label>
                          <input
                            id="checkout-customer-phone"
                            type="tel"
                            value={customerPhone}
                            onChange={e => setCustomerPhone(e.target.value)}
                            placeholder="01xxxxxxxxx"
                            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
                          />
                        </div>
                      </div>

                      {/* Payment methods info */}
                      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 text-sm text-blue-800 space-y-1">
                        <p className="font-bold flex items-center gap-1"><Banknote size={15}/> طرق الدفع المتاحة:</p>
                        <p>• تحويل بنكي / إنستاباي / فودافون كاش</p>
                        <p>• بعد إرسال الطلب سنرسل لك تفاصيل الحساب</p>
                      </div>

                      {payError && (
                        <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                          <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
                          <p className="text-red-700 text-xs">{payError}</p>
                        </div>
                      )}

                      <button
                        onClick={handlePay}
                        disabled={payLoading || !canPay}
                        className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition shadow-lg mb-3 text-sm"
                      >
                        {payLoading
                          ? <><Loader2 size={17} className="animate-spin" /> جارٍ الإرسال...</>
                          : <>أرسل طلب الاشتراك — {finalAmount} {currencySymbol}</>
                        }
                      </button>

                      {whatsapp && (
                        <>
                          <div className="flex items-center gap-2 my-3">
                            <div className="flex-1 h-px bg-gray-200" />
                            <span className="text-xs text-gray-400">أو تواصل مباشرة</span>
                            <div className="flex-1 h-px bg-gray-200" />
                          </div>
                          <a
                            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`مرحباً، أريد الاشتراك في: ${itemTitle} — ${finalAmount} ${currencySymbol}`)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition text-sm"
                          >
                            <MessageCircle size={17} />
                            تواصل عبر واتساب
                          </a>
                        </>
                      )}

                      <button
                        onClick={() => navigate(-1)}
                        className="w-full mt-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-3 rounded-xl transition text-sm"
                      >
                        رجوع
                      </button>
                    </>
                  )}
                </div>

                {/* Order Summary */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 h-fit order-1 md:order-2">
                    <h2 className="text-lg font-bold mb-4">ملخص الطلب</h2>
                    <div className="flex gap-4 mb-4 pb-4 border-b">
                        {itemImage
                          ? <img loading="lazy" decoding="async" src={cdnImg(itemImage, 120)} className="w-16 h-16 rounded-lg object-cover bg-gray-100 flex-shrink-0" alt="" />
                          : <div className="w-16 h-16 rounded-lg bg-gray-100 flex-shrink-0" />
                        }
                        <div>
                            <h3 className="font-bold text-sm text-gray-800 line-clamp-2">{itemTitle}</h3>
                            <p className="text-primary-600 font-bold mt-1">{itemPrice} {currencySymbol}</p>
                        </div>
                    </div>
                    
                    <div className="space-y-2 text-sm text-gray-600 mb-4">
                        <div className="flex justify-between">
                            <span>السعر الأساسي</span>
                            <span>{itemPrice} {currencySymbol}</span>
                        </div>
                    </div>

                    <div className="flex justify-between font-bold text-lg pt-4 border-t">
                        <span>صافي الدفع</span>
                        <span className="text-primary-600">{finalAmount} {currencySymbol}</span>
                    </div>

                    <div className="bg-gray-50 p-3 rounded-lg mt-4 text-xs text-gray-500 flex items-start gap-2">
                        <Check className="text-green-500 mt-0.5" size={14} />
                        سيتم تفعيل حسابك فور تأكيد الدفع من فريقنا.
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

export default Checkout;
