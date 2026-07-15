import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CreditCard, Loader2 } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

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

  const numericAmount = Number(amount);
  const canPay = useMemo(
    () => numericAmount > 0 && purpose.trim().length >= 3 && name.trim().length >= 2 && emailLooksValid(email) && cleanPhone(phone).length >= 8,
    [numericAmount, purpose, name, email, phone],
  );

  useEffect(() => {
    document.title = 'الدفع السريع | معهد الدراسات النفسية';
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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-6 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            <CreditCard size={22} />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900">الدفع السريع</h1>
          <p className="mt-1 text-sm text-gray-500">رابط مخصص لتحصيل أي مبلغ خارج صفحات الاشتراك العادية.</p>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handlePay} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">المبلغ بالجنيه المصري</label>
            <input
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="مثال: 1500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">سبب الدفع</label>
            <input
              type="text"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="مثال: رسوم استشارة أو شهادة إضافية"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">اسم العميل</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="الاسم الكامل"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">البريد الإلكتروني</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="name@example.com"
              dir="ltr"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-gray-700">رقم الهاتف</label>
            <input
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100"
              placeholder="01000000000"
              dir="ltr"
            />
          </div>

          <button
            type="submit"
            disabled={status !== 'idle'}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-bold text-white shadow-lg shadow-primary-600/20 transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status !== 'idle' && <Loader2 size={18} className="animate-spin" />}
            {status === 'reserving' ? 'جاري تجهيز الطلب...' : status === 'redirecting' ? 'جاري التحويل لبوابة الدفع...' : 'المتابعة للدفع الإلكتروني'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default StandalonePayment;
