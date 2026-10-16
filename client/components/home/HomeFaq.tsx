import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { enrollmentRates, percentLabel } from '../../../shared/enrollmentPricing';

type Content = Record<string, string | undefined>;

/**
 * The questions people ask before they book, answered where they decide.
 * Each one can be rewritten from the content keys home.faq.qN / home.faq.aN.
 */
const HomeFaq: React.FC<{ content: Content }> = ({ content }) => {
  const rates = enrollmentRates(content);
  const defaults = [
    { q: 'هل الشهادة معتمدة؟ وأقدر أثبتها إزاي؟', a: 'كل شهادة بتطلع من المعهد ليها كود تحقق خاص بيها، وأي جهة عمل تقدر تكتب الكود في صفحة التحقق على الموقع وتشوف بيانات الشهادة في ثواني.' },
    { q: 'الدراسة أونلاين ولا حضور؟', a: 'الاتنين. تقدر تحضر في فرع الدقي أو التجمع، أو تدرس أونلاين من أي مكان في مصر أو السعودية أو أي دولة.' },
    { q: 'أقدر أقسّط؟', a: `أيوه. تقدر تدفع كاش بخصم ${percentLabel(rates.cash)}% وتتفتح لك كل المحاضرات فوراً، أو تقسّط بخصم ${percentLabel(rates.install)}% وتبدأ بأول دفعة بس.` },
    { q: 'محتاج خلفية في علم النفس عشان أبدأ؟', a: 'لأ. فيه برامج بتبدأ من الأساس لأي حد مهتم بالمجال، وبرامج متخصصة للأخصائيين والمعالجين. لو محتار، اختار مجال اهتمامك وهنرشح لك الأنسب.' },
    { q: 'المحاضرات بتفضل متاحة بعد ما أخلص؟', a: content['home.feature3.desc'] || 'بعد الاشتراك تحتفظ بوصول كامل لجميع المحاضرات والمراجع بدون رسوم إضافية.' },
  ];
  const items = defaults.map((d, i) => ({ q: content[`home.faq.q${i + 1}`] || d.q, a: content[`home.faq.a${i + 1}`] || d.a }));
  const [open, setOpen] = useState(0);

  return (
    <div>
      <span className="text-sm font-extrabold text-[#a87a1c]">قبل ما تحجز</span>
      <h2 className="mt-2 text-3xl font-black leading-tight text-[#1a0f12] sm:text-4xl">أسئلة بتتسأل كتير</h2>
      <div className="mt-6 divide-y divide-[#ecdfd6] rounded-[26px] border border-[#ecdfd6] bg-white">
        {items.map((item, i) => {
          const on = open === i;
          return (
            <div key={i}>
              <button
                type="button"
                aria-expanded={on}
                onClick={() => setOpen(on ? -1 : i)}
                className="flex min-h-[60px] w-full items-center justify-between gap-4 px-5 py-4 text-right text-base font-extrabold text-[#1a0f12] sm:text-[17px]"
              >
                {item.q}
                <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition ${on ? 'rotate-45 bg-primary-700 text-white' : 'bg-[#fbf7f2] text-[#5b4b46]'}`}><Plus size={18} /></span>
              </button>
              <div className={`grid transition-all duration-300 ${on ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <p className="overflow-hidden px-5 text-[15px] leading-[1.9] text-[#6b5b55]">
                  <span className="block pb-5">{item.a}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HomeFaq;
