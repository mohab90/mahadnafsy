import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { Check, AlertCircle, LogIn, MessageCircle, Banknote, Loader2, CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { usePaymentAvailability, useManualPaymentMethods } from '../lib/usePaymentAvailability';
import { paymentMethodLabel } from '../../shared/paymentMethods';
import { compressImage } from '../../shared/imageCompress';
import { expressPrice, getTherapistSessionPrice } from '../lib/consultations';
import { cdnImg } from '../lib/img';
import { instituteWhatsApp } from '../lib/whatsappLink';
import { amountDueNow, enrollmentRates, installmentTotal, percentLabel, type PayMode } from '../../shared/enrollmentPricing';
import { useSeo } from '../lib/useSeo';
import { effectivePrice, usePriceList } from '../lib/usePrices';
import { rememberCheckoutOrder, trackInitiateCheckout } from '../lib/tracking';

const Checkout: React.FC = () => {
  useSeo({ title: 'إتمام الاشتراك | معهد الدراسات النفسية', path: '/checkout' });
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { courses, bundles, therapists, content, currency, authUser, subscribers, mySubscriberId } = useSiteData();
  const priceList = usePriceList();
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
  // Whether cards can actually be taken right now, asked of the server rather
  // than assumed. Null while unknown, so neither claim is made until it lands.
  const onlinePayEnabled = usePaymentAvailability();
  // The channels the institute actually takes, from الإعدادات ← وسائل الدفع.
  // This list was four hardcoded Arabic strings, so an admin could tick a
  // channel off and the customer would still be offered it — and the value it
  // sent was that Arabic label, while /my-account sent a code for the same
  // channel. One vocabulary now: the code travels, Arabic is the label.
  const manualMethods = useManualPaymentMethods();
  const [cardRedirecting, setCardRedirecting] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [payError, setPayError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [serverAmount, setServerAmount] = useState<number | null>(null);
  const [serverCurrency, setServerCurrency] = useState<'EGP' | 'SAR' | 'USD' | null>(null);
  // What the server decided and on what basis, so the page can show the
  // instalment plan rather than silently charging a number nobody explained.
  const [, setServerPayMode] = useState<'cash' | 'installment'>('cash');
  const [serverPlanTotal, setServerPlanTotal] = useState<number | null>(null);
  // A promo code — the pop-up's, a coupon from التسويق ← الخصومات — checked and
  // priced by the server (POST /api/public/price-quote); checkout-intent applies
  // it again by the same rule, so what is shown here is what is charged.
  const [promoInput, setPromoInput] = useState(() => (searchParams.get('promo') || '').toUpperCase());
  const [promo, setPromo] = useState<{ code: string; price: number; label: string } | null>(null);
  const [promoMsg, setPromoMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  // Self-service receipt upload (after order is placed)
  const [proofImage, setProofImage] = useState('');
  const [proofMethod, setProofMethod] = useState('');
  const [proofSubmitting, setProofSubmitting] = useState(false);
  const [proofDone, setProofDone] = useState(false);
  const [proofError, setProofError] = useState('');

  // Auto-fill name & email from logged-in user
  useEffect(() => {
    if (authUser) {
      setCustomerName(authUser.displayName || authUser.email?.split('@')[0] || '');
      setCustomerEmail(authUser.email || '');
      // Pre-fill phone from existing subscriber record, else from the auth profile (lead phone).
      // Prefer the id the server resolved for this account. Re-deriving it by
      // matching on email finds nothing for a client who signed in by WhatsApp
      // number and has no email — and, because subscribers.email is nullable,
      // the unguarded .toLowerCase() it used to do crashed this whole page for
      // exactly those customers.
      const email = (authUser.email || '').toLowerCase().trim();
      const sub = subscribers.find(s => s.id === mySubscriberId)
        ?? (email ? subscribers.find(s => (s.email || '').toLowerCase().trim() === email) : undefined);
      const phone = sub?.phone || (authUser as { phone?: string }).phone || '';
      if (phone) setCustomerPhone(phone);
    }
  }, [authUser, subscribers, mySubscriberId]);

  // Determine Item details
  let itemTitle = '';
  let itemPrice = 0;
  // The catalogue price, before the discount running on the item (itemPrice is after it).
  let itemBase = 0;
  let itemImage = '';
  let itemFound = false;

  if (type === 'course') {
      const course = courses.find(c => c.id === id);
      if (course) {
          itemTitle = course.title;
          // The price checkout charges, discount included (lib/usePrices).
          const effective = effectivePrice(priceList, 'course', course.id, currency, course.price?.[currency] ?? 0);
          itemPrice = effective.price;
          itemBase = effective.base;
          itemImage = course.thumbnail;
          itemFound = true;
      }
  } else if (type === 'bundle') {
      const bundle = bundles.find(b => b.id === id);
      if (bundle) {
          itemTitle = bundle.title;
          const effective = effectivePrice(priceList, 'bundle', bundle.id, currency, bundle.price?.[currency] ?? 0);
          itemPrice = effective.price;
          itemBase = effective.base;
          itemImage = bundle.courses[0]?.thumbnail ?? '';
          itemFound = true;
      }
  } else if (type === 'consultation') {
      if (subtype === 'express') {
          itemTitle = 'جلسة استشارة سريعة (Express)';
          itemPrice = expressPrice(content, currency);
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
    itemBase = 0;
    itemTitle = paymentLink.item?.title_ar || paymentLink.item?.title || paymentLink.description || itemTitle;
    itemFound = Boolean(paymentLink.item) && itemPrice > 0;
  }

  // Display follows verified location; the server independently recalculates it.
  const settlementCurrency = serverCurrency || paymentLink?.currency || (type === 'certificate' && ['EGP', 'SAR', 'USD'].includes(searchParams.get('currency') || '')
    ? searchParams.get('currency') as 'EGP' | 'SAR' | 'USD' : currency);
  const currencySymbol = settlementCurrency === 'SAR' ? 'ر.س' : settlementCurrency === 'USD' ? '$' : 'ج.م';
  const payMode: PayMode = searchParams.get('payMode') === 'installment' ? 'installment' : 'cash';
  // Show the number the server is going to charge, not the catalogue price.
  // finalAmount fell back to the full price for the whole time the customer
  // is reading the page and deciding — so picking قسط looked like it had been
  // thrown away. It had not; the page simply never applied the discount.
  const discountable = itemPrice > 0 && !paymentLink && type !== 'certificate';
  const rates = enrollmentRates(content);
  // The price before the pay mode: the code's when one was accepted, else the running one.
  const listPrice = promo && discountable ? promo.price : itemPrice;
  const basePrice = Math.max(itemBase, itemPrice);
  const displayAmount = discountable ? amountDueNow(listPrice, payMode, rates) : itemPrice;
  const finalAmount = serverAmount ?? displayAmount;
  const planTotal = serverPlanTotal ?? (discountable && payMode === 'installment' ? installmentTotal(listPrice, rates) : null);
  const promoAllowed = discountable && (type === 'course' || type === 'bundle') && !orderId;

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code || !promoAllowed) return;
    setPromoLoading(true);
    setPromoMsg(null);
    try {
      const res = await fetch('/api/public/price-quote', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: type, itemId: id, payMode, promoCode: code, currency }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر التحقق من الكود');
      if (data.discount?.code) {
        setPromo({ code: data.discount.code, price: Number(data.price) || itemPrice, label: data.discount.label || '' });
        setPromoMsg({ ok: true, text: `تم تطبيق الكود ${data.discount.code}` });
      } else {
        setPromo(null);
        setPromoMsg({ ok: data.promoError?.code === 'PROMO_NOT_BETTER', text: data.promoError?.message || 'الكود غير صالح أو منتهي الصلاحية' });
      }
    } catch (err) {
      setPromo(null);
      setPromoMsg({ ok: false, text: err instanceof Error ? err.message : 'تعذر التحقق من الكود' });
    } finally {
      setPromoLoading(false);
    }
  };
  const clearPromo = () => { setPromo(null); setPromoMsg(null); setPromoInput(''); };
  const whatsapp = instituteWhatsApp(content);

  // InitiateCheckout once the page shows something payable to someone who can
  // pay for it — once per item, not on every re-render (lib/tracking.ts).
  const checkoutTracked = useRef('');
  const checkoutReady = itemFound && itemPrice > 0 && !(requiresLogin && authUser === null) && !paymentLinkLoading;
  useEffect(() => {
    const key = `${type}:${id || subtype || ''}`;
    if (!checkoutReady || checkoutTracked.current === key) return;
    checkoutTracked.current = key;
    trackInitiateCheckout({ id: String(id || subtype || type || ''), type: String(type || ''), title: itemTitle, value: displayAmount, currency: settlementCurrency });
  }, [checkoutReady, type, id, subtype, itemTitle, displayAmount, settlementCurrency]);

  // An email when one is typed must be one; a customer who signed up by
  // WhatsApp has none, and the server takes the account as the identity — the
  // page still demanded an «@», so they could not buy at all. The phone is the
  // number the institute reaches them on (the server checks it is real).
  const emailOk = customerEmail.trim() ? customerEmail.includes('@') : !authUser?.email;
  const canPay = !!customerName.trim() && emailOk && customerPhone.replace(/\D/g, '').length >= 9 && itemFound && itemPrice > 0;

  // Hand the order the server just priced to the gateway. Deliberately runs
  // after the intent exists rather than instead of it: if the gateway refuses,
  // the order is already recorded and the customer still has the transfer route
  // below, so a gateway problem costs the sale nothing.
  // Takes the id explicitly so it can be called in the same tick the order is
  // created, before setOrderId has re-rendered anything.
  const payByCard = async (useOrderId?: string): Promise<boolean> => {
    const activeOrderId = useOrderId || orderId;
    if (!activeOrderId) return false;
    setCardRedirecting(true);
    setPayError('');
    const payload = {
      orderId: activeOrderId,
      amount: finalAmount,
      currency: settlementCurrency,
      itemTitle,
      paymentMethod: 'paymob',
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim(),
      customerPhone: customerPhone.trim(),
    };
    try {
      const res = await fetch('/api/payments/paymob-init', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok || !data.iframeUrl) throw new Error(data.error || 'تعذر بدء الدفع الإلكتروني.');
      window.location.assign(data.iframeUrl);
      return true;
    } catch (err) {
      setCardRedirecting(false);
      setPayError(err instanceof Error ? err.message : 'تعذر بدء الدفع الإلكتروني — يمكنك إتمام الدفع بالتحويل بالأسفل.');
      return false;
    }
  };

  // Returns the new order id so the caller can hand it straight to the gateway.
  const handlePay = async (skipConfirmation = false): Promise<string> => {
    if (!canPay) return '';
    setPayLoading(true);
    setPayError('');
    try {
      // The session is the httpOnly cookie, which fetch sends on its own for a
      // same-origin /api call. Requiring a localStorage token here blocked
      // every checkout once the cookie migration stopped writing one — the
      // signed-in gate is `authUser` above, and the route runs requireAuth.
      // A legacy token is still forwarded when one happens to be present.
      const token = localStorage.getItem('mahad-token');
      const idempotencyStorageKey = `checkout-idempotency:${type}:${id || subtype || 'item'}:${paymentLinkToken || ''}`;
      const idempotencyKey = sessionStorage.getItem(idempotencyStorageKey) || crypto.randomUUID();
      sessionStorage.setItem(idempotencyStorageKey, idempotencyKey);
      const response = await fetch('/api/public/checkout-intent', {
        method: 'POST',
        credentials: 'include',
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
          payMode: searchParams.get('payMode') === 'installment' ? 'installment' : 'cash',
          ...(promo ? { promoCode: promo.code } : {}),
          ...(type === 'consultation' ? {
            therapistId: searchParams.get('therapistId') || '',
            sessionDate: searchParams.get('date') || '',
            // Both booking pages put the chosen slot in the URL and this never
            // read it, so only the bare date was sent. consultations.session_date
            // is a DATETIME, so every booking landed at 00:00: a customer who
            // picked «الأحد • 18:00 - 19:00» got a card reading 00:00 and the
            // desk had no record of the hour they had agreed to.
            slotId: searchParams.get('slotId') || '',
            sessionType: searchParams.get('sessionType') || 'individual',
            subtype: subtype || 'regular',
          } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.orderId) throw new Error(data.error || 'تعذّر إنشاء الطلب');
      setOrderId(String(data.orderId));
      // For the Purchase /success fires if this ends in a card payment.
      rememberCheckoutOrder({
        orderId: String(data.orderId), value: Number(data.amount) || 0,
        currency: data.currency === 'SAR' || data.currency === 'USD' ? data.currency : 'EGP',
        itemId: String(id || ''), title: itemTitle,
      });
      setServerAmount(Number(data.amount));
      setServerCurrency(data.currency === 'SAR' || data.currency === 'USD' ? data.currency : 'EGP');
      setServerPayMode(data.payMode === 'installment' ? 'installment' : 'cash');
      setServerPlanTotal(Number(data.planTotal) || null);
      if (!skipConfirmation) setOrderSent(true);
      sessionStorage.removeItem(idempotencyStorageKey);
      return String(data.orderId);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : 'حدث خطأ، حاول مرة أخرى.');
      return '';
    } finally {
      setPayLoading(false);
    }
  };

  // One button, two calls. The order still has to exist before the gateway can
  // be handed anything, but making the customer click twice — once to "send a
  // request", again to pay — read as two separate errands and left people who
  // meant to pay by card sitting on a confirmation screen. If the gateway
  // refuses, the order is already recorded and the transfer route below is
  // untouched, so nothing is lost.
  const payNowByCard = async () => {
    const newOrderId = await handlePay(true);
    if (!newOrderId) return;
    const handedOver = await payByCard(newOrderId);
    // The gateway refused. Show the confirmation screen so the transfer
    // route is still there instead of leaving the customer on a dead button.
    if (!handedOver) setOrderSent(true);
  };

  // The receipt, compressed to what stays readable (shared/imageCompress.ts).
  const onProofFile = async (file?: File) => {
    if (!file) return;
    try { setProofImage(await compressImage(file, 'receipt')); setProofError(''); }
    catch { setProofError('تعذّر قراءة الصورة — جرّب صورة تانية'); }
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
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ order_id: orderId, provider: 'manual', idempotency_key: `checkout:${orderId}` }),
      });
      const intent = await intentRes.json().catch(() => ({}));
      if (!intentRes.ok || !intent.id) throw new Error(intent.error || 'تعذّر تجهيز عملية الدفع');
      const res = await fetch('/api/me/payment-proof', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          order_id: orderId,
          payment_intent_id: intent.id,
          // Matches the select's own fallback, so the value sent is the one the
          // customer was looking at rather than an empty string.
          payment_method: proofMethod || manualMethods[0] || 'other',
          proof_image: proofImage,
          note: `طلب ذاتي: ${itemTitle}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذّر إرسال الإيصال');
      setProofDone(true);
    } catch (e) { setProofError(e instanceof Error ? e.message : 'تعذّر إرسال الإيصال'); }
    finally { setProofSubmitting(false); }
  };

  const fieldClass = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const labelClass = 'mb-1 block text-[13px] font-bold text-muted-strong';
  const primaryBtn = 'flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-5 text-[15px] font-black text-white transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50';
  const secondaryBtn = 'flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white px-5 text-sm font-extrabold text-ink transition hover:border-ink/40 disabled:cursor-not-allowed disabled:opacity-50';

  // Require login before any payable customer workflow.
  if (paymentLinkLoading) {
    return <div className="grid min-h-screen place-items-center bg-paper text-muted" dir="rtl"><span className="flex items-center gap-2 font-bold"><Loader2 className="animate-spin text-primary-700" /> جاري التحقق من رابط الدفع...</span></div>;
  }
  if (paymentLinkError) {
    return <div className="grid min-h-screen place-items-center bg-paper p-4" dir="rtl"><div className="w-full max-w-md rounded-[24px] border border-red-200 bg-white p-8 text-center font-bold text-red-700">{paymentLinkError}</div></div>;
  }
  if (requiresLogin && authUser === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4" dir="rtl">
        <div className="w-full max-w-md rounded-[28px] bg-white p-7 text-center shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line sm:p-10">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
            <LogIn size={34} className="text-primary-700" />
          </div>
          <h2 className="mb-3 text-2xl font-black text-ink">يرجى تسجيل الدخول أولاً</h2>
          <p className="mb-8 leading-relaxed text-muted-body">لإتمام الشراء وضمان وصولك للكورس، يجب تسجيل الدخول أو إنشاء حساب جديد أولاً.</p>
          <div className="flex flex-col gap-3">
            <Link
              // This read window.location.hash, left over from a HashRouter the
              // app no longer uses: under BrowserRouter the hash is always ''
              // so the redirect was always empty and a customer who signed in
              // to buy never came back to their order.
              to={`/auth?redirect=${encodeURIComponent(location.pathname + location.search)}`}
              className={primaryBtn}
            >
              تسجيل الدخول / إنشاء حساب
            </Link>
            <button onClick={() => navigate(-1)} className={secondaryBtn}>
              رجوع
            </button>
          </div>
        </div>
      </div>
    );
  }

    if (!itemFound) {
        return (
            <div className="min-h-screen bg-paper py-10 sm:py-16">
                <div className="container mx-auto max-w-3xl px-4">
                    <div className="rounded-[28px] border border-line bg-white p-7 text-center sm:p-10">
                        <h1 className="mb-3 text-2xl font-black text-ink sm:text-3xl">الطلب غير صالح</h1>
                        <p className="mb-6 leading-relaxed text-muted-body">لم نتمكن من العثور على المنتج المطلوب. من فضلك ارجع للصفحة السابقة وأعد المحاولة.</p>
                        <button
                            onClick={() => navigate(-1)}
                            className="inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-primary-700 px-7 font-black text-white transition hover:bg-primary-800"
                        >
                            رجوع
                        </button>
                    </div>
                </div>
            </div>
        );
    }

  return (
    <div className="min-h-screen bg-paper py-8 sm:py-12" dir="rtl">
        <div className="container mx-auto max-w-5xl px-4">
            <div className="mb-6 text-center sm:mb-8 lg:text-right">
              <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-gold-deep"><ShieldCheck size={16} /> دفع آمن</span>
              <h1 className="mt-1 text-3xl font-black leading-tight text-ink sm:text-4xl">إتمام الشراء</h1>
            </div>

            {/* This notice used to be hardcoded, so it told every customer that
                card payment was off even when the gateway was fully live and
                ready to take the money. It now reflects what the server says. */}
            {onlinePayEnabled === false && (
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-gold/30 bg-white p-4">
                <AlertCircle size={18} className="mt-0.5 shrink-0 text-gold-deep" />
                <p className="text-sm leading-relaxed text-muted-strong">
                  <strong className="text-ink">الدفع الإلكتروني متوقف مؤقتاً.</strong> يُرجى إتمام الدفع عبر التحويل البنكي أو واتساب وسيتواصل معك فريقنا لتأكيد التسجيل.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 lg:grid-cols-[1fr_minmax(0,400px)] lg:gap-8">
                {/* Contact / payment form */}
                <div className="order-2 min-w-0 rounded-[28px] border border-line bg-white p-5 sm:p-7 md:order-1">
                  {orderSent ? (
                    proofDone ? (
                    <div className="py-4 text-center">
                      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-50 ring-1 ring-green-100">
                        <Check size={32} className="text-green-600" />
                      </div>
                      <h3 className="mb-2 text-xl font-black text-ink">تم استلام إيصالك ✅</h3>
                      <p className="mb-6 text-sm leading-relaxed text-muted-body">هنراجع الإيصال ونفعّل وصولك للكورس خلال وقت قصير — وهيوصلك تأكيد على بريدك وواتساب.</p>
                      <Link to="/my-account" className={primaryBtn}>الذهاب لحسابي</Link>
                    </div>
                    ) : (
                    <div className="py-1">
                      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-50 ring-1 ring-green-100">
                        <Check size={28} className="text-green-600" />
                      </div>
                      <h3 className="mb-4 text-center text-xl font-black text-ink">تم استلام طلبك! 🎉</h3>

                      {/* When cards are live this is the fast path: the order is
                          already priced by the server, so it only has to be
                          handed to the gateway. The transfer route stays below
                          for anyone who prefers it, or if the gateway refuses. */}
                      {onlinePayEnabled && (
                        <div className="mb-5">
                          <button onClick={() => payByCard()} disabled={cardRedirecting}
                            className={primaryBtn}>
                            {cardRedirecting
                              ? <><Loader2 size={16} className="animate-spin" /> جارٍ تحويلك لصفحة الدفع...</>
                              : <><CreditCard size={16} /> ادفع الآن — محفظة أو بطاقة أو فوري ({finalAmount} {currencySymbol})</>}
                          </button>
                          <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-muted-soft"><Lock size={12} /> دفع آمن عبر بوابة Paymob — أو أكمل بالتحويل البنكي بالأسفل</p>
                          {settlementCurrency !== 'EGP' && (
                            <p className="mt-1 text-center text-xs font-bold text-gold-deep">صفحة الدفع هتطلب المبلغ بالجنيه المصري بسعر الصرف النهارده.</p>
                          )}
                        </div>
                      )}

                      <p className="mb-4 text-center text-sm leading-relaxed text-muted-body">حوّل المبلغ (<b className="tabular-nums text-ink">{finalAmount} {currencySymbol}</b>) ثم ارفع صورة الإيصال هنا لتفعيل وصولك فوراً بعد المراجعة.</p>

                      {/* Payment instructions (configurable from admin content) */}
                      <div className="mb-5 whitespace-pre-line break-words rounded-2xl bg-paper p-4 text-sm leading-7 text-muted-strong ring-1 ring-line">
                        <p className="mb-1 flex items-center gap-1.5 font-black text-ink"><Banknote size={16} className="text-primary-700" /> تعليمات التحويل</p>
                        {content['finance.payment_instructions'] || 'إنستاباي / فودافون كاش / تحويل بنكي — راسلنا واتساب لطلب رقم الحساب إن لم يظهر هنا.'}
                      </div>

                      {/* Receipt upload */}
                      <label className={labelClass}>طريقة الدفع</label>
                      <select value={proofMethod || manualMethods[0] || ''} onChange={e => setProofMethod(e.target.value)}
                        className={`${fieldClass} mb-3`}>
                        {manualMethods.map(m => <option key={m} value={m}>{paymentMethodLabel(m)}</option>)}
                        <option value="other">{paymentMethodLabel('other')}</option>
                      </select>
                      <label className={labelClass}>صورة الإيصال</label>
                      <input type="file" accept="image/*" onChange={e => { void onProofFile(e.target.files?.[0]); }}
                        className="mb-3 w-full rounded-xl border border-dashed border-line-deep bg-paper p-2.5 text-xs text-muted file:ml-3 file:min-h-[38px] file:rounded-lg file:border-0 file:bg-primary-50 file:px-3 file:font-extrabold file:text-primary-700" />
                      {proofImage && <img loading="lazy" decoding="async" src={proofImage} alt="receipt" className="mx-auto mb-3 max-h-36 rounded-xl border border-line object-contain" />}

                      {proofError && <p className="mb-2 text-sm font-bold text-red-600">{proofError}</p>}
                      <button onClick={submitProof} disabled={proofSubmitting || !proofImage}
                        className={`${primaryBtn} mb-3`}>
                        {/* The button used to say "وتفعيل الوصول". Sending a
                            receipt does not activate anything — it creates a
                            PENDING payment proof for the accounts team, which
                            is what the confirmation below correctly says. */}
                        {proofSubmitting ? <><Loader2 size={16} className="animate-spin" /> جارٍ الإرسال...</> : 'إرسال الإيصال للمراجعة'}
                      </button>

                      {whatsapp && (
                        <a
                          href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`مرحباً، حوّلت لاشتراك: ${itemTitle} (${finalAmount} ${currencySymbol})\nالاسم: ${customerName}\nالهاتف: ${customerPhone}`)}`}
                          target="_blank" rel="noreferrer"
                          className={secondaryBtn}
                        >
                          <MessageCircle size={17} className="text-green-600" /> أرسل الإيصال عبر واتساب بدلاً من ذلك
                        </a>
                      )}
                      <button onClick={() => setOrderSent(false)} className="mt-3 block min-h-[44px] w-full text-center text-sm font-bold text-muted underline underline-offset-4 hover:text-ink">تعديل البيانات</button>
                    </div>
                    )
                  ) : (
                    <>
                      <h2 className="mb-4 text-xl font-black text-ink">بياناتك</h2>
                      <div className="mb-5 space-y-3.5">
                        <div>
                          <label htmlFor="checkout-customer-name" className={labelClass}>الاسم الكامل</label>
                          <input
                            id="checkout-customer-name"
                            type="text"
                            value={customerName}
                            onChange={e => setCustomerName(e.target.value)}
                            placeholder="أدخل اسمك الكامل"
                            className={fieldClass}
                          />
                        </div>
                        <div>
                          <label htmlFor="checkout-customer-email" className={labelClass}>البريد الإلكتروني</label>
                          <input
                            id="checkout-customer-email"
                            type="email"
                            value={customerEmail}
                            onChange={e => setCustomerEmail(e.target.value)}
                            placeholder="example@email.com"
                            className={fieldClass}
                          />
                        </div>
                        <div>
                          <label htmlFor="checkout-customer-phone" className={labelClass}>رقم الهاتف (واتساب)</label>
                          <input
                            id="checkout-customer-phone"
                            type="tel"
                            value={customerPhone}
                            onChange={e => setCustomerPhone(e.target.value)}
                            placeholder="01xxxxxxxxx"
                            className={fieldClass}
                          />
                        </div>
                      </div>

                      {/* Payment methods info */}
                      <div className="mb-5 space-y-1 rounded-2xl bg-paper p-4 text-sm leading-relaxed text-muted-strong ring-1 ring-line">
                        <p className="mb-1 flex items-center gap-1.5 font-black text-ink"><Banknote size={16} className="text-primary-700" /> طرق الدفع المتاحة:</p>
                        {onlinePayEnabled && <p>• بطاقة بنكية أو محفظة إلكترونية — الوصول يُفعَّل فوراً</p>}
                        {/* Listed what the institute takes regardless of what it
                            had been configured to take. Same source as the
                            receipt picker below, so the two cannot disagree. */}
                        <p>• {manualMethods.map(m => paymentMethodLabel(m)).join(' / ')}</p>
                        <p>• بعد إرسال الطلب سنرسل لك تفاصيل الحساب</p>
                      </div>

                      {payError && (
                        <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3">
                          <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
                          <p className="text-sm font-bold text-red-700">{payError}</p>
                        </div>
                      )}

                      {onlinePayEnabled ? (
                        <>
                          <button
                            onClick={payNowByCard}
                            disabled={payLoading || cardRedirecting || !canPay}
                            className={`${primaryBtn} mb-2 shadow-[0_16px_30px_-14px_rgba(159,18,57,.8)]`}
                          >
                            {payLoading || cardRedirecting
                              ? <><Loader2 size={17} className="animate-spin" /> جارٍ تحويلك لصفحة الدفع...</>
                              : <><CreditCard size={17} /> ادفع الآن — محفظة أو بطاقة أو فوري — {finalAmount} {currencySymbol}</>
                            }
                          </button>
                          {settlementCurrency !== 'EGP' && (
                            <p className="mb-2 text-center text-xs font-bold text-gold-deep">صفحة الدفع هتطلب المبلغ بالجنيه المصري بسعر الصرف النهارده.</p>
                          )}
                          {/* The transfer route is still a first-class option, not
                              a fallback nobody can find: this creates the same
                              order and stops on the receipt-upload panel. */}
                          <button
                            onClick={() => handlePay()}
                            disabled={payLoading || cardRedirecting || !canPay}
                            className={`${secondaryBtn} mb-3`}
                          >
                            <Banknote size={16} className="text-primary-700" /> أو ادفع انستا باي وابعتلنا صورة التحويل من هنا
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handlePay()}
                          disabled={payLoading || !canPay}
                          className={`${primaryBtn} mb-3 shadow-[0_16px_30px_-14px_rgba(159,18,57,.8)]`}
                        >
                          {payLoading
                            ? <><Loader2 size={17} className="animate-spin" /> جارٍ الإرسال...</>
                            : <>أرسل طلب الاشتراك — {finalAmount} {currencySymbol}</>
                          }
                        </button>
                      )}

                      {whatsapp && (
                        <>
                          <div className="my-4 flex items-center gap-3">
                            <div className="h-px flex-1 bg-line" />
                            <span className="text-xs font-bold text-muted-soft">أو تواصل مباشرة</span>
                            <div className="h-px flex-1 bg-line" />
                          </div>
                          <a
                            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`مرحباً، أريد الاشتراك في: ${itemTitle} — ${finalAmount} ${currencySymbol}`)}`}
                            target="_blank"
                            rel="noreferrer"
                            className={secondaryBtn}
                          >
                            <MessageCircle size={17} className="text-green-600" />
                            تواصل عبر واتساب
                          </a>
                        </>
                      )}

                      <button
                        onClick={() => navigate(-1)}
                        className="mt-3 flex min-h-[46px] w-full items-center justify-center rounded-2xl text-sm font-extrabold text-muted transition hover:bg-paper hover:text-ink"
                      >
                        رجوع
                      </button>
                    </>
                  )}
                </div>

                {/* Order Summary */}
                <div className="order-1 h-fit min-w-0 rounded-[28px] bg-white p-5 shadow-[0_40px_80px_-45px_rgba(26,15,18,.45)] ring-1 ring-line sm:p-6 md:order-2 md:sticky md:top-24">
                    <h2 className="mb-4 text-lg font-black text-ink">ملخص الطلب</h2>
                    <div className="mb-4 flex gap-4 border-b border-line pb-4">
                        {itemImage
                          ? <img loading="lazy" decoding="async" width={64} height={64} src={cdnImg(itemImage, 120)} className="h-16 w-16 flex-shrink-0 rounded-2xl bg-sand object-cover" alt="" />
                          : <div className="h-16 w-16 flex-shrink-0 rounded-2xl bg-sand" />
                        }
                        <div className="min-w-0">
                            <h3 className="line-clamp-2 text-[15px] font-black leading-snug text-ink">{itemTitle}</h3>
                            <p className="mt-1 font-extrabold tabular-nums text-primary-700">{listPrice} {currencySymbol}</p>
                        </div>
                    </div>

                    <div className="mb-4 space-y-2.5 text-sm text-muted-body">
                    {/* Show the arithmetic. "3,300 → 767" with nothing in between
                        reads as an error: the customer cannot tell a discount from a
                        deposit, and only one of those leaves a balance owing. */}
                        <div className="flex justify-between gap-3">
                            <span>السعر الأساسي</span>
                            <span className="tabular-nums text-ink">{discountable ? basePrice : itemPrice} {currencySymbol}</span>
                        </div>
                        {discountable && basePrice > listPrice && (
                          <div className="flex justify-between gap-3 font-bold text-green-700">
                            <span>{promo ? `كود الخصم ${promo.code}` : 'خصم العرض'}</span>
                            <span className="tabular-nums">− {basePrice - listPrice} {currencySymbol}</span>
                          </div>
                        )}
                        {discountable && payMode === 'cash' && listPrice > finalAmount && (
                          <div className="flex justify-between gap-3 font-bold text-green-700">
                            <span>خصم الدفع الكامل ({percentLabel(rates.cash)}%)</span>
                            <span className="tabular-nums">− {listPrice - finalAmount} {currencySymbol}</span>
                          </div>
                        )}
                        {discountable && payMode === 'installment' && planTotal && (
                          <>
                            <div className="flex justify-between gap-3 font-bold text-green-700">
                              <span>خصم التقسيط ({percentLabel(rates.install)}%)</span>
                              <span className="tabular-nums">− {listPrice - planTotal} {currencySymbol}</span>
                            </div>
                            <div className="flex justify-between gap-3 font-extrabold text-ink">
                              <span>إجمالي الكورس بعد الخصم</span>
                              <span className="tabular-nums">{planTotal} {currencySymbol}</span>
                            </div>
                            <div className="flex justify-between gap-3 font-bold text-gold-deep">
                              <span>الباقي على أقساط</span>
                              <span className="tabular-nums">{planTotal - finalAmount} {currencySymbol}</span>
                            </div>
                          </>
                        )}
                    </div>

                    {promoAllowed && (
                      <div className="mb-4">
                        <label htmlFor="promo-code" className="mb-1 block text-[13px] font-bold text-muted-strong">عندك كود خصم؟</label>
                        <div className="flex gap-2">
                          <input id="promo-code" value={promoInput} dir="ltr"
                            onChange={e => { setPromoInput(e.target.value.toUpperCase()); if (promo) { setPromo(null); setPromoMsg(null); } }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void applyPromo(); } }}
                            placeholder="CODE" maxLength={50}
                            className="min-h-[46px] min-w-0 flex-1 rounded-xl border border-line-strong bg-paper px-3 font-mono text-[15px] uppercase text-ink outline-none focus:border-primary-600 focus:bg-white" />
                          {promo ? (
                            <button type="button" onClick={clearPromo} className="min-h-[46px] flex-none rounded-xl px-4 text-sm font-extrabold text-muted ring-1 ring-line hover:bg-paper">إلغاء</button>
                          ) : (
                            <button type="button" onClick={() => void applyPromo()} disabled={!promoInput.trim() || promoLoading}
                              className="min-h-[46px] flex-none rounded-xl bg-ink px-4 text-sm font-extrabold text-white disabled:opacity-50">
                              {promoLoading ? <Loader2 size={16} className="animate-spin" /> : 'تطبيق'}
                            </button>
                          )}
                        </div>
                        {promoMsg && <p role="status" className={`mt-1.5 text-xs font-bold ${promoMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{promoMsg.text}</p>}
                      </div>
                    )}

                    <div className="flex items-end justify-between gap-3 rounded-[22px] bg-ink p-5 text-white">
                        <span className="text-sm font-bold text-white/70">{payMode === 'installment' ? 'المقدم المطلوب الآن' : 'صافي الدفع'}</span>
                        <span className="text-[30px] font-black leading-none tabular-nums text-gold-pale">{finalAmount} <span className="text-base text-white/80">{currencySymbol}</span></span>
                    </div>
                    {payMode === 'installment' && planTotal && (
                      <p className="mt-3 rounded-2xl bg-paper p-3 text-xs leading-relaxed text-muted-strong ring-1 ring-line">
                        دي أول دفعة ({percentLabel(rates.first)}% من إجمالي الكورس بعد الخصم). الباقي {planTotal - finalAmount} {currencySymbol}
                        بيتقسّط، وفريقنا هيتواصل معاك بمواعيده.
                      </p>
                    )}

                    <div className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
                        <Check className="mt-0.5 flex-none text-green-600" size={14} />
                        سيتم تفعيل حسابك فور تأكيد الدفع من فريقنا.
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

export default Checkout;
