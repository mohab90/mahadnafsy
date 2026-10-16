import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Banknote, CalendarClock, ChevronDown } from 'lucide-react';
import type { Course, Currency } from '../../types';
import { formatPrice } from '../../../shared/priceFormat';
import { amountDueNow, enrollmentRates, installmentTotal, percentLabel } from '../../../shared/enrollmentPricing';
import { Reveal } from './Reveal';

type Content = Record<string, string | undefined>;

const STEPS = [
  { title: 'اختار برنامجك', text: 'من الدبلومات أو المسارات الكاملة، أو خلّينا نرشح لك الأنسب.' },
  { title: 'احجز مكانك في دقائق', text: 'سجّل بياناتك أونلاين، وفريقنا يأكد معاك كل التفاصيل.' },
  { title: 'ادفع كاش أو قسّط', text: 'كاش بخصم أكبر، أو تقسيط مرن تبدأ فيه بأول دفعة بس.' },
  { title: 'ادرس واستلم شهادتك', text: 'تدريب نظري وعملي، وشهادة بكود تحقق أي جهة تقدر تتأكد منه.' },
];

/**
 * «ابدأ في 4 خطوات» beside a small calculator: pick a programme, pick cash or
 * instalments, and see what is paid today. The two percentages are the ones
 * marketing sets in التسويق ← الخصومات — the same ones the enrol page and the
 * server charge with — so what is promised here is what is charged.
 */
const PaymentPlanner: React.FC<{ content: Content; courses: Course[]; currency: Currency; initialCourseId?: string }> = ({ content, courses, currency, initialCourseId }) => {
  const options = useMemo(() => courses
    .filter(c => Number(c.price?.[currency]) > 0)
    .sort((a, b) => (Number(b.students) || 0) - (Number(a.students) || 0)), [courses, currency]);
  const [pick, setPick] = useState('');
  const [mode, setMode] = useState<'cash' | 'installment'>('cash');
  const course = options.find(c => c.id === pick) || options.find(c => c.id === initialCourseId) || options[0] || null;

  const rates = enrollmentRates(content);
  const base = Number(course?.price?.[currency]) || 0;
  const cash = amountDueNow(base, 'cash', rates);
  const plan = installmentTotal(base, rates);
  const first = amountDueNow(base, 'installment', rates);
  const today = mode === 'cash' ? cash : first;
  const blurb = (course?.shortDescription || '').replace(/<[^>]*>/g, '').trim();

  const toggle = (id: 'cash' | 'installment', title: string, pct: number, Icon: typeof Banknote) => {
    const on = mode === id;
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => setMode(id)}
        className={`flex min-h-[64px] items-center gap-2.5 rounded-2xl border-2 px-3 text-right transition sm:px-4 ${on ? 'border-primary-700 bg-primary-50/60' : 'border-[#ecdfd6] bg-white hover:border-[#d9c7bf]'}`}
      >
        <span className={`hidden h-10 w-10 flex-none items-center justify-center rounded-xl sm:flex ${on ? 'bg-primary-700 text-white' : 'bg-[#fbf7f2] text-[#7a6a64]'}`}><Icon size={20} /></span>
        <span className="min-w-0">
          <b className="block text-[15px] leading-tight text-[#1a0f12] sm:text-base">{title}</b>
          <span className={`text-[13px] font-extrabold ${on ? 'text-primary-700' : 'text-[#8f7f79]'}`}>خصم {pct}%</span>
        </span>
      </button>
    );
  };

  return (
    <section id="pay" className="scroll-mt-24 bg-[#fbf7f2] py-16 sm:py-24">
      <div className="container mx-auto grid items-center gap-10 px-4 lg:grid-cols-[1fr_minmax(0,520px)] lg:gap-16">
        <Reveal className="text-center lg:text-right">
          <span className="text-sm font-extrabold text-[#a87a1c]">طريقة الدفع</span>
          <h2 className="mt-2 text-3xl font-black leading-tight text-[#1a0f12] sm:text-4xl lg:text-[44px]">ادفع كاش وفّر أكتر، أو قسّط على راحتك</h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-[#6b5b55] sm:text-lg lg:mx-0">من أول ما تختار لحد ما تستلم شهادتك، كل خطوة واضحة ومعاك فريق يتابعك.</p>

          <ol className="mx-auto mt-8 grid max-w-xl gap-3 text-right sm:grid-cols-2 lg:mx-0">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3.5 rounded-[20px] bg-white p-4 ring-1 ring-[#ecdfd6]">
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#1a0f12] text-base font-black text-[#f3c969]">{i + 1}</span>
                <span>
                  <b className="block text-base text-[#1a0f12]">{step.title}</b>
                  <span className="text-sm leading-relaxed text-[#7a6a64]">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Reveal>

        {course && (
          <Reveal delay={120}>
            <div className="rounded-[32px] bg-white p-5 shadow-[0_40px_80px_-40px_rgba(26,15,18,.45)] ring-1 ring-[#ecdfd6] sm:p-7">
              <div className="mb-4 flex items-center justify-between gap-3">
                <b className="text-lg font-black text-[#1a0f12]">احسب قسطك</b>
                <span className="rounded-full bg-[#fbf7f2] px-3 py-1 text-xs font-extrabold text-[#7a6a64] ring-1 ring-[#ecdfd6]">بالأسعار الحالية</span>
              </div>

              <label htmlFor="pay-course" className="mb-1.5 block text-[13px] font-bold text-[#7a6a64]">البرنامج</label>
              <div className="relative">
                <select
                  id="pay-course"
                  value={course.id}
                  onChange={e => setPick(e.target.value)}
                  className="min-h-[56px] w-full appearance-none rounded-2xl border border-[#e6d8cf] bg-[#fbf7f2] pe-11 ps-4 text-base font-extrabold text-[#1a0f12] outline-none focus:border-primary-600 focus:ring-4 focus:ring-primary-600/10"
                >
                  {options.map(c => <option key={c.id} value={c.id}>{c.title.trim()}</option>)}
                </select>
                <ChevronDown size={20} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#7a6a64]" />
              </div>
              <div className="mt-3 rounded-2xl border border-dashed border-[#e6d8cf] px-4 py-3">
                <p className="text-xl font-black leading-snug text-[#1a0f12]">{course.title.trim()}</p>
                {blurb && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[#7a6a64]">{blurb}</p>}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {toggle('cash', 'دفع كاش كامل', percentLabel(rates.cash), Banknote)}
                {toggle('installment', 'تقسيط مرن', percentLabel(rates.install), CalendarClock)}
              </div>

              <div className="mt-4 rounded-[22px] bg-[#1a0f12] p-5 text-white">
                <div className="flex items-end justify-between gap-3">
                  <span className="text-sm text-white/65">{mode === 'cash' ? 'هتدفع مرة واحدة' : 'هتدفع النهارده (أول دفعة)'}</span>
                  {base > today && <s className="text-sm text-white/40 tabular-nums">{formatPrice(base, currency)}</s>}
                </div>
                <p className="mt-1 text-[40px] font-black leading-none tabular-nums text-[#f3c969]">{formatPrice(today, currency)}</p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/65">
                  {mode === 'cash' ? 'وتتفتح لك كل المحاضرات فوراً.' : `إجمالي الخطة ${formatPrice(plan, currency)}، والباقي على دفعات مريحة.`}
                </p>
              </div>

              <Link to={`/enroll?course=${encodeURIComponent(course.id)}`} className="mt-4 flex min-h-[56px] items-center justify-center gap-2 rounded-2xl bg-primary-700 text-lg font-black text-white transition hover:bg-primary-800">
                احجز بالسعر ده
                <ArrowLeft size={20} />
              </Link>
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
};

export default PaymentPlanner;
