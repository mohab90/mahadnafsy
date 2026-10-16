import React from 'react';
import { Check, Send } from 'lucide-react';
import { formatAmount, isDiscounted } from '../../../shared/priceFormat';

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
  // Strike only a price the customer is actually saving against. Most
  // courses carry no original price, so this rendered a struck-out 0 above
  // the real one on nearly every course page.
  const strikePrice = discountedPrice !== null ? currentPrice : oldPrice;
  const payPrice = discountedPrice !== null ? discountedPrice : currentPrice;
  return (
    <div data-sticky-cta="lg" className="lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-line bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-18px_40px_-24px_rgba(26,15,18,.45)]">
       <div className="mx-auto flex max-w-lg items-center gap-2">
           <div className="min-w-0 flex-shrink-0">
               {currentPrice > 0 ? (
                 <>
                   {isDiscounted(strikePrice, payPrice) && (
                     <s className="block text-xs tabular-nums text-muted-faint">{formatAmount(strikePrice)} {currencySymbol}</s>
                   )}
                   <p className="whitespace-nowrap text-lg font-black leading-tight tabular-nums text-ink">{formatAmount(payPrice)} <span className="text-sm text-primary-700">{currencySymbol}</span></p>
                 </>
               ) : <p className="text-xs font-bold text-gold-deep">السعر غير متاح</p>}
           </div>
           {isSubscribed ? (
             <div className="flex min-h-[48px] flex-1 items-center justify-center gap-1 rounded-2xl border-2 border-green-500 bg-green-50 px-3 text-sm font-bold text-green-700">
               <Check size={16} /> أنت مشترك
             </div>
           ) : currentPrice > 0 ? (
             <button onClick={onBuyNow} className="flex min-h-[48px] min-w-0 flex-1 items-center justify-center gap-1 rounded-2xl bg-primary-700 px-3 text-[13px] font-black leading-tight sm:text-sm text-white shadow-[0_12px_24px_-12px_rgba(159,18,57,.8)] transition hover:bg-primary-800">
               <Check size={16} className="flex-none" />
               احجز الآن واستفد بخصم
             </button>
           ) : (
             <div className="flex min-h-[48px] flex-1 items-center justify-center rounded-2xl bg-paper px-3 text-center text-xs font-bold text-gold-deep ring-1 ring-line">
               تواصل لتجهيز السعر
             </div>
           )}
           <button
             onClick={onRegisterClick}
             className="flex min-h-[48px] flex-none items-center justify-center gap-1 whitespace-nowrap rounded-2xl border-[1.5px] border-ink/15 bg-white px-3 text-[13px] font-extrabold text-ink transition hover:border-ink/40"
           >
             <Send size={15} /> سجل بياناتك
           </button>
       </div>
    </div>
  );
};
