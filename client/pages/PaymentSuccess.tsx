import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Home, MessageCircle, Upload, Clock, LayoutDashboard, Receipt } from 'lucide-react';

/**
 * PaymentSuccess — shown after a user submits a payment request.
 * Paymob online payments are currently suspended, so this turns the post-request
 * moment into an actionable onboarding step: what happens next + upload the
 * transfer receipt to speed up activation.
 */
const STEPS = [
  { icon: CheckCircle, title: 'استلمنا طلبك', desc: 'وصلنا طلب الاشتراك بنجاح', done: true },
  { icon: Receipt, title: 'ارفع إيصال التحويل', desc: 'من حسابك — يسرّع التفعيل كثيراً' },
  { icon: Clock, title: 'مراجعة وتأكيد', desc: 'فريقنا يراجع ويأكّد الدفع' },
  { icon: LayoutDashboard, title: 'ابدأ التعلّم', desc: 'يُفتح المحتوى في حسابك فوراً بعد التأكيد' },
];

const PaymentSuccess: React.FC = () => {
  useEffect(() => { document.title = 'تم استلام طلبك | معهد الدراسات النفسية'; }, []);
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-xl p-8 sm:p-10 border border-gray-100">
        <div className="text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={44} className="text-green-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">تم استلام طلبك! 🎉</h1>
          <p className="text-gray-500 mb-6">
            خطوة واحدة بسيطة تفصلك عن بدء رحلتك — ارفع إيصال التحويل وفريقنا هيأكّد ويفعّل حسابك بسرعة.
          </p>
        </div>

        {/* Next-steps timeline */}
        <ol className="space-y-3 mb-6">
          {STEPS.map((s, i) => {
            const Ic = s.icon;
            return (
              <li key={i} className={`flex items-start gap-3 rounded-2xl border p-3 ${s.done ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100'}`}>
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
            <Upload size={20} />
            ارفع إيصال التحويل الآن
          </Link>
          <a
            href="https://wa.me/201096203090"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition"
          >
            <MessageCircle size={20} />
            تواصل معنا عبر واتساب
          </a>
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
