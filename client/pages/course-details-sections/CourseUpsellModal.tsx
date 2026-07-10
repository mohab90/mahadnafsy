import React from 'react';
import { Link } from 'react-router-dom';
import { X, Gift } from 'lucide-react';
import type { Bundle, Currency } from '../../types';
import { cdnImg } from '../../lib/img';

interface CourseUpsellModalProps {
  courseTitle: string;
  completionCert: string | null;
  relatedBundles: Bundle[];
  currency: Currency;
  onClose: () => void;
}

export const CourseUpsellModal: React.FC<CourseUpsellModalProps> = ({ courseTitle, completionCert, relatedBundles, currency, onClose }) => {
  return (
    <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-green-500 to-emerald-600 p-6 text-white text-center relative">
          <button onClick={onClose} className="absolute top-3 left-3 w-7 h-7 rounded-full bg-white/20 hover:bg-white/40 grid place-items-center transition"><X size={14} /></button>
          <div className="text-5xl mb-2">🎓</div>
          <h2 className="text-xl font-extrabold">مبروك! أتممت الكورس</h2>
          <p className="text-green-100 text-sm mt-1">{courseTitle}</p>
        </div>
        <div className="p-6">
          {completionCert && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-center">
              <p className="text-xs text-amber-600 font-semibold mb-1">كود شهادتك الرقمية</p>
              <p className="font-mono font-extrabold text-amber-800 text-lg tracking-wider">{completionCert}</p>
              <p className="text-xs text-gray-400 mt-1">احتفظ بهذا الكود للتحقق من الشهادة</p>
            </div>
          )}
          {relatedBundles.length > 0 ? (
            <>
              <p className="text-gray-700 font-semibold mb-3 flex items-center gap-2"><Gift size={16} className="text-primary-600" /> ارتقِ بمهاراتك — باقات تشمل هذا الكورس:</p>
              <div className="space-y-3">
                {relatedBundles.slice(0, 2).map(b => (
                  <div key={b.id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3 hover:border-primary-300 transition">
                    <img loading="lazy" decoding="async" src={cdnImg(b.thumbnail, 160)} alt="" className="w-14 h-12 object-cover rounded-lg flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 text-sm line-clamp-1">{b.title}</p>
                      <p className="text-primary-600 font-extrabold text-sm">{b.price?.[currency]} {currency === 'EGP' ? 'ج.م' : currency === 'SAR' ? 'ر.س' : '$'}</p>
                    </div>
                    <Link to={`/bundle/${b.id}`} onClick={onClose} className="bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition flex-shrink-0">
                      عرض
                    </Link>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-center text-gray-500 text-sm py-2">استمر في تعلمك وتطوير مهاراتك!</p>
          )}
          <button onClick={onClose} className="w-full mt-4 border-2 border-gray-200 text-gray-600 hover:bg-gray-50 font-bold py-2.5 rounded-xl transition text-sm">
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};
