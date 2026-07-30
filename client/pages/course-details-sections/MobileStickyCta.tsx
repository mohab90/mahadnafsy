import React from 'react';
import { Check, Send } from 'lucide-react';

interface MobileStickyCtaProps {
  currentPrice: number;
  oldPrice: number;
  discountedPrice: number | null;
  currencySymbol: string;
  isSubscribed: boolean;
  onBuyNow: () => void;
  onRegisterClick: () => void;
}

export const MobileStickyCta: React.FC<MobileStickyCtaProps> = ({
  currentPrice,
  oldPrice,
  discountedPrice,
  currencySymbol,
  isSubscribed,
  onBuyNow,
  onRegisterClick,
}) => {
  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 z-50 shadow-[0_-4px_20px_rgba(0,0,0,0.1)] pb-8 md:pb-4">
       <div className="flex gap-2 items-center max-w-lg mx-auto">
           <div className="flex-shrink-0">
               {currentPrice > 0 ? (
                 <>
                   <p className="text-xs text-gray-500 line-through">{discountedPrice !== null ? currentPrice : oldPrice} {currencySymbol}</p>
                   <p className="text-lg font-bold text-primary-700">{discountedPrice !== null ? discountedPrice : currentPrice} {currencySymbol}</p>
                 </>
               ) : <p className="text-xs font-bold text-amber-700">السعر غير متاح</p>}
           </div>
           {isSubscribed ? (
             <div className="bg-green-50 border-2 border-green-500 text-green-700 px-4 py-3 rounded-xl font-bold flex-1 text-sm flex justify-center items-center gap-1">
               <Check size={16} /> أنت مشترك
             </div>
           ) : currentPrice > 0 ? (
             <button onClick={onBuyNow} className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-xl font-bold flex-1 shadow-lg shadow-primary-500/30 transition text-sm flex justify-center items-center gap-1">
               <Check size={16} />
               احجز الآن واستفد بخصم
             </button>
           ) : (
             <div className="bg-amber-50 border border-amber-300 text-amber-800 px-3 py-3 rounded-xl font-bold flex-1 text-xs text-center">
               تواصل لتجهيز السعر
             </div>
           )}
           <button
             onClick={onRegisterClick}
             className="bg-white border-2 border-primary-600 text-primary-700 px-4 py-3 rounded-xl font-bold flex-1 transition text-sm flex justify-center items-center gap-1"
           >
             <Send size={14} /> سجل بياناتك
           </button>
       </div>
    </div>
  );
};
