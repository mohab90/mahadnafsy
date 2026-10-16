import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CreditCard, Loader2, Lock, MessageCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { usePaymentAvailability } from '../lib/usePaymentAvailability';
import { useSiteData } from '../context/SiteDataContext';
import { instituteWhatsApp } from '../lib/whatsappLink';
import { setCanonical } from '../lib/useSeo';

type PayStatus = 'idle' | 'reserving' | 'redirecting';

const emailLooksValid = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
const cleanPhone = (value: string) => value.replace(/[^\d+]/g, '').slice(0, 20);

const StandalonePayment: React.FC = () => {
  const [searchParams] = useSearchParams();
  const initialAmount = searchParams.get('amount') || '';
  const initialPurpose = searchParams.get('title') || searchParams.get('purpose') || '';

  const [amount, setAmount] = useState(initialAmount);
  const [purpose, setPurpose] = useState(initialPurpose);
  const [name, setName] = useState(searchParams.get('name') || '');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [phone, setPhone] = useState(searchParams.get('phone') || '');
  const [status, setStatus] = useState<PayStatus>('idle');
  const [error, setError] = useState('');
  // This page has only one way to pay, and POST /api/orders/reserve refuses
  // outright when the gateway is off. Asking first means a customer is told
  // before they fill five fields, and is given the number to call instead of a
  // dead button — the same thing every other payment surface does.
  const onlinePayEnabled = usePaymentAvailability();
  const { content } = useSiteData();
  const whatsapp = instituteWhatsApp(content);

  const numericAmount = Number(amount);
  const canPay = useMemo(
    () => numericAmount > 0 && purpose.trim().length >= 3 && name.trim().length >= 2 && emailLooksValid(email) && cleanPhone(phone).length >= 8,
    [numericAmount, purpose, name, email, phone],
  );

  useEffect(() => {
    document.title = 'الدفع السريع | معهد الدراسات النفسية';
    // Without this the canonical stays on whichever page loaded first.
    setCanonical('/pay');
  }, []);

  const handlePay = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canPay) {
      setError('راجع البيانات: المبلغ، سبب الدفع، الاسم، البريد، ورقم الهاتف مطلوبة بشكل صحيح.');
      return;
    }

    const orderId = `STND-${Date.now()}`;
    const payload = {
      orderId,
      type: 'standalone_payment',
      itemId: 'standalone',
      itemTitle: purpose.trim(),
      amount: numericAmount,
      currency: 'EGP',
      paymentMethod: 'paymob',
      customerName: name.trim(),
      customerEmail: email.trim(),
      customerPhone: cleanPhone(phone),
    };

    setError('');
    setStatus('reserving');
    try {
      const reserveRes = await fetch('/api/orders/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const reserveData = await reserveRes.json().catch(() => ({}));
      if (!reserveRes.ok || reserveData.ok === false) {
        throw new Error(reserveData.error || 'تعذر حجز طلب الدفع.');
      }

      setStatus('redirecting');
      const paymobRes = await fetch('/api/payments/paymob-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const paymobData = await paymobRes.json().catch(() => ({}));
      if (!paymobRes.ok || !paymobData.ok || !paymobData.iframeUrl) {
        throw new Error(paymobData.error || 'تعذر بدء الدفع الإلكتروني.');
      }

      window.location.assign(paymobData.iframeUrl);
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع أثناء تجهيز الدفع.');
    }
  };

  const fieldClass = 'min-h-[50px] w-full rounded-xl border border-line-strong bg-paper px-4 text-[15px] text-ink outline-none transition placeholder:text-muted-faint focus:border-primary-600 focus:bg-white focus:ring-4 focus:ring-primary-600/10';
  const labelClass = 'mb-1 block text-[13px] font-bold text-muted-strong';

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10" dir="rtl">
      <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-[0_40px_80px_-45px_rgba(26,15,18,.5)] ring-1 ring-line sm:p-8">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            <CreditCard size={24} />
          </div>
          <h1 className="text-3xl font-black text-ink">الدفع السريع</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-body">رابط مخصص لتحصيل أي مبلغ خارج صفحات الاشتراك العادية.</p>
        </div>

        {onlinePayEnabled === false && (
          <div className="mb-4 rounded-2xl border border-gold/30 bg-paper px-4 py-3 text-sm text-muted-strong">
            <p className="flex items-start gap-2">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-gold-deep" />
              <span><strong className="text-ink">الدفع الإلكتروني متوقف مؤقتاً.</strong> تواصل معنا وهنبعتلك تفاصيل التحويل ونسجّل دفعتك.</span>
            </p>
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`مرحباً، أريد سداد ${purpose.trim() || 'مبلغ'}${numericAmount > 0 ? ` بمبلغ ${numericAmount} ج.م` : ''}`)}`}
                target="_blank" rel="noreferrer"
                className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-ink/15 bg-white text-sm font-extrabold text-ink transition hover:border-ink/40"
              >
                <MessageCircle size={17} className="text-green-600" />
                تواصل معنا عبر واتساب
              </a>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handlePay} className="space-y-4">
          <div>
            <label className={labelClass}>المبلغ بالجنيه المصري</label>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={`${fieldClass} text-lg font-black tabular-nums`}
              placeholder="مثال: 1500"
            />
          </div>

          <div>
            <label className={labelClass}>سبب الدفع</label>
            <input
              type="text"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              className={fieldClass}
              placeholder="مثال: رسوم استشارة أو شهادة إضافية"
            />
          </div>

          <div>
            <label className={labelClass}>اسم العميل</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={fieldClass}
              placeholder="الاسم الكامل"
            />
          </div>

          <div>
            <label className={labelClass}>البريد الإلكتروني</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={fieldClass}
              placeholder="name@example.com"
              dir="ltr"
            />
          </div>

          <div>
            <label className={labelClass}>رقم الهاتف</label>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className={fieldClass}
              placeholder="01000000000"
              dir="ltr"
            />
          </div>

          {numericAmount > 0 && (
            <div className="flex items-end justify-between gap-3 rounded-[22px] bg-ink p-5 text-white">
              <span className="text-sm font-bold text-white/70">المبلغ</span>
              <span className="text-[30px] font-black leading-none tabular-nums text-gold-pale">{numericAmount} <span className="text-base text-white/80">ج.م</span></span>
            </div>
          )}

          <button
            type="submit"
            disabled={status !== 'idle' || onlinePayEnabled === false}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary-700 px-7 font-black text-white shadow-[0_16px_30px_-14px_rgba(159,18,57,.8)] transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status !== 'idle' && <Loader2 size={18} className="animate-spin" />}
            {status === 'reserving' ? 'جاري تجهيز الطلب...' : status === 'redirecting' ? 'جاري التحويل لبوابة الدفع...' : 'المتابعة للدفع الإلكتروني'}
          </button>
          <p className="flex items-center justify-center gap-1 text-center text-xs text-muted-soft"><Lock size={12} /> دفع آمن عبر بوابة Paymob</p>
        </form>
      </div>
    </div>
  );
};

export default StandalonePayment;
