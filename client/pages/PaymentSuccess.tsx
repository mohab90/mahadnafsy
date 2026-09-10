import React, { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle, Home, MessageCircle, Upload, Clock, LayoutDashboard, Receipt, XCircle, CreditCard } from 'lucide-react';
import { instituteWhatsApp } from '../lib/whatsappLink';
import { useSiteData } from '../context/SiteDataContext';

/**
 * Where a customer lands after paying — by card or by transfer.
 *
 * /success is the Paymob redirection_url (see paymobCallbackUrls in
 * api/routes/public-orders.js), so it is the last thing a card payer sees. It
 * used to be written for one case only — "we received your request, now upload
 * your transfer receipt" — which meant a customer who had just paid by card was
 * told their payment was not done and asked to send a receipt for money that
 * had already left their account. A *declined* card was worse: same green tick,
 * same «تم استلام طلبك! 🎉».
 *
 * Paymob appends its result to the redirect, so the three cases are told apart
 * here. The redirect is only ever used to say what happened — the webhook,
 * which is HMAC-verified, is what actually records the payment, and the copy
 * below says so rather than promising access this page cannot grant.
 */
const TRANSFER_STEPS = [
  { icon: CheckCircle, title: 'استلمنا طلبك', desc: 'وصلنا طلب الاشتراك بنجاح', done: true },
  { icon: Receipt, title: 'ارفع إيصال التحويل', desc: 'من حسابك — يسرّع التفعيل كثيراً' },
  { icon: Clock, title: 'مراجعة وتأكيد', desc: 'فريقنا يراجع ويأكّد الدفع' },
  { icon: LayoutDashboard, title: 'ابدأ التعلّم', desc: 'يُفتح المحتوى في حسابك فوراً بعد التأكيد' },
];

const CARD_STEPS = [
  { icon: CreditCard, title: 'تمت عملية الدفع', desc: 'البنك وافق على العملية', done: true },
  { icon: Clock, title: 'تأكيد من بوابة الدفع', desc: 'بنستلم التأكيد وبنسجّل الدفعة — عادة خلال دقائق' },
  { icon: LayoutDashboard, title: 'ابدأ التعلّم', desc: 'يُفتح المحتوى في حسابك بعد تسجيل الدفعة' },
];

const PaymentSuccess: React.FC = () => {
  const { content } = useSiteData();
  const [searchParams] = useSearchParams();
  // Paymob sends success=true/false; arriving with neither means this is the
  // manual checkout's own confirmation, which is what the page always was.
  const paymobResult = searchParams.get('success');
  const outcome = paymobResult === null ? 'transfer' : paymobResult.toLowerCase() === 'true' ? 'card' : 'declined';

  useEffect(() => {
    document.title = outcome === 'declined'
      ? 'لم تتم عملية الدفع | معهد الدراسات النفسية'
      : 'تم استلام طلبك | معهد الدراسات النفسية';
  }, [outcome]);

  const whatsapp = instituteWhatsApp(content);

  if (outcome === 'declined') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white w-full max-w-lg rounded-3xl shadow-xl p-8 sm:p-10 border border-gray-100">
          <div className="text-center">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
              <XCircle size={44} className="text-red-600" />
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900 mb-2">لم تتم عملية الدفع</h1>
            <p className="text-gray-500 mb-6">
              البنك رفض العملية ولم يُخصم منك أي مبلغ. تقدر تجرب بطاقة تانية، أو تدفع بالتحويل ونفعّل حسابك بعد المراجعة.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Link
              to="/courses"
              className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition"
            >
              <CreditCard size={20} />
              حاول مرة أخرى
            </Link>
            <Link
              to="/my-account?section=payments"
              className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold py-3 rounded-xl transition"
            >
              <Upload size={20} />
              ادفع بالتحويل وارفع الإيصال
            </Link>
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition"
              >
                <MessageCircle size={20} />
                تواصل معنا عبر واتساب
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  const paidByCard = outcome === 'card';
  const steps = paidByCard ? CARD_STEPS : TRANSFER_STEPS;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-xl p-8 sm:p-10 border border-gray-100">
        <div className="text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={44} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">
            {paidByCard ? 'تم الدفع بنجاح! 🎉' : 'تم استلام طلبك! 🎉'}
          </h1>
          <p className="text-gray-500 mb-6">
            {paidByCard
              ? 'وصلنا تأكيد الدفع من البنك. بنسجّل الدفعة ونفتح المحتوى في حسابك — لو مافتحش خلال شوية، كلمنا واتساب ونظبطه فوراً.'
              : 'خطوة واحدة بسيطة تفصلك عن بدء رحلتك — ارفع إيصال التحويل وفريقنا هيأكّد ويفعّل حسابك بسرعة.'}
          </p>
        </div>

        {/* Next-steps timeline */}
        <ol className="space-y-3 mb-6">
          {steps.map((s, i) => {
            const Ic = s.icon;
            return (
              <li key={s.title} className={`flex items-start gap-3 rounded-2xl border p-3 ${s.done ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'}`}>
                <span className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${s.done ? 'bg-green-600 text-white' : 'bg-white text-gray-400 border border-gray-200'}`}>
                  <Ic size={17} />
                </span>
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 text-sm">{i + 1}. {s.title}</p>
                  <p className="text-xs text-gray-500">{s.desc}</p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 mb-6 flex items-center gap-2 text-amber-800 text-sm">
          <Clock size={16} className="shrink-0" />
          <span>عادةً بنرد ونفعّل خلال ساعات العمل (السبت – الخميس).</span>
        </div>

        <div className="flex flex-col gap-3">
          <Link
            to="/my-account?section=payments"
            className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition"
          >
            {paidByCard ? <><LayoutDashboard size={20} /> الذهاب لحسابي</> : <><Upload size={20} /> ارفع إيصال التحويل الآن</>}
          </Link>
          {whatsapp && (
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition"
            >
              <MessageCircle size={20} />
              تواصل معنا عبر واتساب
            </a>
          )}
          <Link
            to="/"
            className="w-full bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 font-bold py-3 rounded-xl transition flex justify-center items-center gap-2"
          >
            <Home size={20} />
            العودة للرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PaymentSuccess;
