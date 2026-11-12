import React from 'react';
import { percentLabel, type enrollmentRates } from '../../../shared/enrollmentPricing';

type Rates = ReturnType<typeof enrollmentRates>;

interface Props {
  discountable: boolean;
  /** The price the page shows before any discount (for the Egypt site's two prices, the non-Egyptian one). */
  basePrice: number;
  itemPrice: number;
  /** The price before the pay mode: the code's, the Egyptian's, or the running one. */
  listPrice: number;
  finalAmount: number;
  payMode: 'cash' | 'installment';
  planTotal: number | null;
  promoCode: string | null;
  rates: Rates;
  currencySymbol: string;
  /** The Egypt site's «خصم المصريين» (api/lib/egyptianPricing.js): what an Egyptian's price takes off the shown one. Absent — the default — the rows are what they always were. */
  egyptian?: { discount: number } | null;
}

/**
 * The order summary's arithmetic. "3,300 → 767" with nothing in between reads as an error: the customer cannot
 * tell a discount from a deposit, and only one of those leaves a balance owing.
 */
const PriceRows: React.FC<Props> = ({ discountable, basePrice, itemPrice, listPrice, finalAmount, payMode, planTotal, promoCode, rates, currencySymbol, egyptian = null }) => {
  const egyptianDiscount = egyptian ? egyptian.discount : 0;
  return (
  <div className="mb-4 space-y-2.5 text-sm text-muted-body">
    <div className="flex justify-between gap-3">
      <span>السعر الأساسي</span>
      <span className={egyptian ? 'tabular-nums text-muted line-through' : 'tabular-nums text-ink'}>{discountable ? basePrice : itemPrice} {currencySymbol}</span>
    </div>
    {discountable && egyptian && (
      <>
        <div className="flex justify-between gap-3 font-bold text-green-700">
          <span>خصم المصريين</span>
          <span className="tabular-nums">− {egyptianDiscount} {currencySymbol}</span>
        </div>
        <div className="flex justify-between gap-3 font-extrabold text-ink">
          <span>سعر المصري</span>
          <span className="tabular-nums">{basePrice - egyptianDiscount} {currencySymbol}</span>
        </div>
      </>
    )}
    {discountable && basePrice - egyptianDiscount > listPrice && (
      <div className="flex justify-between gap-3 font-bold text-green-700">
        <span>{promoCode ? `كود الخصم ${promoCode}` : 'خصم العرض'}</span>
        <span className="tabular-nums">− {basePrice - egyptianDiscount - listPrice} {currencySymbol}</span>
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
  );
};

export default PriceRows;
