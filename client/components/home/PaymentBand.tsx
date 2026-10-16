import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, CalendarClock } from 'lucide-react';
import type { Course, Currency } from '../../types';
import { formatPrice } from '../../../shared/priceFormat';
import { amountDueNow, enrollmentRates, installmentTotal, percentLabel } from '../../../shared/enrollmentPricing';

type Content = Record<string, string | undefined>;

/**
 * «ادفع كاش وفّر أكتر، أو قسّط على راحتك» — a full-width band, kept short.
 * The two percentages are the ones marketing sets in التسويق ← الخصومات and the
 * enrol page and the server charge with, so what is promised here is what is
 * charged. With a course picked above («مش عارف تبدأ منين؟») it also shows the
 * amount for that course.
 */
const PaymentBand: React.FC<{ content: Content; course: Course | null; currency: Currency }> = ({ content, course, currency }) => {
  const [mode, setMode] = useState<'cash' | 'installment'>('cash');
  const rates = enrollmentRates(content);
  const base = Number(course?.price?.[currency]) || 0;
  const cash = base ? amountDueNow(base, 'cash', rates) : 0;
  const plan = base ? installmentTotal(base, rates) : 0;
  const first = base ? amountDueNow(base, 'installment', rates) : 0;
  const today = mode === 'cash' ? cash : first;
  const blurb = (course?.shortDescription || '').replace(/<[^>]*>/g, '').trim();
  const enrollTo = course ? `/enroll?course=${encodeURIComponent(course.id)}` : '/enroll';

  const option = (id: 'cash' | 'installment', title: string, pct: number, line: string, Icon: typeof Banknote) => {
    const on = mode === id;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setMode(id)}
        className={`flex min-h-[84px] w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-right transition ${on ? 'border-white bg-white text-gray-900 shadow-xl' : 'border-white/30 bg-white/10 text-white hover:bg-white/15'}`}
      >
        <span className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl ${on ? 'bg-primary-600 text-white' : 'bg-white/15 text-white'}`}><Icon size={22} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <b className="text-lg font-black">{title}</b>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${on ? 'bg-green-700 text-white' : 'bg-secondary-500 text-[#1b0a12]'}`}>خصم {pct}%</span>
          </span>
          <span className={`block text-[13px] leading-snug ${on ? 'text-gray-600' : 'text-white/75'}`}>{line}</span>
        </span>
      </button>
    );
  };

  return (
    <section id="pay" className="scroll-mt-24 w-full bg-primary-600 py-8 text-white sm:py-9">
      <div className="mx-auto grid max-w-[1400px] items-center gap-5 px-4 sm:px-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.5fr)_auto] lg:gap-8">
        <div>
          <span className="text-sm font-extrabold text-amber-200">طريقة الدفع</span>
          <h2 className="mt-1 text-2xl font-black leading-snug lg:text-[26px]">ادفع كاش وفّر أكتر، أو قسّط على راحتك</h2>
          {course && (
            <div className="mt-3 rounded-2xl border border-white/25 bg-white/10 px-4 py-3">
              <span className="text-xs font-extrabold text-amber-200">للبرنامج المرشح لك</span>
              <p className="mt-0.5 text-xl font-black leading-snug text-white sm:text-2xl">{course.title}</p>
              {blurb && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-white/80">{blurb}</p>}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {option('cash', 'دفع كاش كامل', percentLabel(rates.cash), base ? `${formatPrice(cash, currency)} مرة واحدة وتفتح كل المحاضرات فوراً` : 'تدفع مرة واحدة وتفتح لك كل المحاضرات فوراً', Banknote)}
          {option('installment', 'تقسيط مرن', percentLabel(rates.install), base ? `إجمالي الخطة ${formatPrice(plan, currency)} وتبدأ بأول دفعة` : 'تبدأ بأول دفعة وتكمل على راحتك', CalendarClock)}
        </div>

        <div className="flex items-center justify-between gap-4 lg:flex-col lg:items-stretch lg:gap-2.5">
          {base > 0 && (
            <div className="text-right lg:text-center">
              <span className="block text-[13px] text-white/75">هتدفع النهارده</span>
              <span className="text-3xl font-black tabular-nums text-amber-200">{formatPrice(today, currency)}</span>
            </div>
          )}
          <Link to={enrollTo} className="inline-flex min-h-[52px] items-center justify-center rounded-2xl bg-white px-7 text-base font-black text-primary-700 shadow-lg transition hover:bg-primary-50">
            ابدأ الحجز
          </Link>
        </div>
      </div>
    </section>
  );
};

export default PaymentBand;
