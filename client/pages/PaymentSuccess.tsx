import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Home, MessageCircle } from 'lucide-react';

/**
 * PaymentSuccess — shown after a user submits a payment request.
 * Paymob online payments are currently suspended; this page confirms
 * the request was received and directs users to WhatsApp.
 */
const PaymentSuccess: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-xl p-10 text-center border border-gray-100">
        <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={48} className="text-green-600" />
        </div>
        <h1 className="text-2xl font-extrabold text-gray-900 mb-3">تم استلام طلبك!</h1>
        <p className="text-gray-500 mb-8">
          سيتواصل معك فريقنا في أقرب وقت لتأكيد الدفع وتفعيل حسابك.
          يمكنك أيضاً التواصل معنا مباشرةً عبر واتساب لإتمام الإجراءات بشكل أسرع.
        </p>
        <div className="flex flex-col gap-3">
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
            to="/my-account"
            className="w-full bg-primary-600 hover:bg-primary-700 text-white font-bold py-3 rounded-xl transition flex justify-center items-center gap-2"
          >
            الذهاب لحسابي
          </Link>
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