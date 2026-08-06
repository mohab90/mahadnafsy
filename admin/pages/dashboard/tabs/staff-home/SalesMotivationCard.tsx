import React, { useMemo } from 'react';
import { Flame, Quote, Sparkles, Target, TrendingUp, Sunrise } from 'lucide-react';

export interface MotivationStats {
  convertedThisMonth: number;
  convRate: number;
  callsThisMonth: number;
  revenueThisMonth: number;
  overdueCount: number;
  todayFollowupCount: number;
  /** { day, calls, converted } for the last 7 days, oldest first. */
  last7: { day: string; label: string; calls: number; converted: number }[];
  monthlyTarget?: number;
  monthlyTargetType?: 'egp' | 'clients';
  name: string;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });

/**
 * A permanent quote strip. Rotates by day-of-year rather than at random so it
 * changes every morning but never flickers between re-renders of the same day.
 */
const QUOTES: { text: string; author?: string }[] = [
  { text: 'النجاح مجموع مجهودات صغيرة تتكرر كل يوم.', author: 'روبرت كوليير' },
  { text: 'لا تَعُدّ المكالمات… اجعل كل مكالمة تُعَد.' },
  { text: 'أفضل وقت للاتصال بعميل كان أمس، وثاني أفضل وقت هو الآن.' },
  { text: 'البيع ليس إقناع الناس، بل مساعدتهم على القرار الصحيح.' },
  { text: 'من يتابع يكسب. المتابعة هي الفرق بين "ربما" و"تم".' },
  { text: 'كل رفض يقرّبك خطوة من القبول التالي.' },
  { text: 'اهتم بالعميل أكثر من اهتمامك بالصفقة، والصفقة ستأتي.' },
  { text: 'الانضباط يفعل ما لا يفعله الحافز: يعمل كل يوم.' },
  { text: 'استمع ضِعف ما تتكلم — العميل سيخبرك بما يحتاج.' },
  { text: 'ثِق أنك تصنع فرقًا في حياة كل عميل تساعده على التعلّم.' },
  { text: 'الأرقام الكبيرة تبدأ دائمًا بأول مكالمة في الصباح.' },
  { text: 'الاحترافية أن تُنجز عملك بنفس الجودة في يومك الصعب.' },
  { text: 'لا شيء يهزم المثابرة. لا الموهبة ولا الحظ.' },
  { text: 'اجعل هدفك اليوم أفضل من أمس بواحد فقط — يكفي.' },
];

/**
 * "جزء تحفيزي دائم" for the sales home page. Every line is derived from the
 * rep's own real numbers, so praise only appears when it is earned and the
 * nudge only appears when there is something actually waiting — a card that
 * congratulates unconditionally stops being read within a week.
 */
export default function SalesMotivationCard({ stats }: { stats: MotivationStats }) {
  const quote = useMemo(() => {
    const start = new Date(new Date().getFullYear(), 0, 0);
    const dayOfYear = Math.floor((Date.now() - start.getTime()) / 86400000);
    return QUOTES[dayOfYear % QUOTES.length];
  }, []);

  // Consecutive days with any activity, counting back from today.
  const streak = useMemo(() => {
    let run = 0;
    for (let i = stats.last7.length - 1; i >= 0; i -= 1) {
      const day = stats.last7[i];
      if ((day.calls || 0) > 0 || (day.converted || 0) > 0) run += 1;
      else break;
    }
    return run;
  }, [stats.last7]);

  const bestDay = useMemo(
    () => stats.last7.reduce((best, day) => (day.calls > (best?.calls ?? -1) ? day : best), stats.last7[0]),
    [stats.last7],
  );

  const target = Number(stats.monthlyTarget || 0);
  const progressValue = stats.monthlyTargetType === 'clients' ? stats.convertedThisMonth : stats.revenueThisMonth;
  const targetPct = target > 0 ? Math.min(100, Math.round((progressValue / target) * 100)) : null;
  const remaining = target > 0 ? Math.max(0, target - progressValue) : 0;

  // The single most useful thing to say right now, in priority order.
  const headline = useMemo(() => {
    const firstName = String(stats.name || '').trim().split(/\s+/)[0] || '';
    if (targetPct !== null && targetPct >= 100) {
      return { icon: Sparkles, tone: 'from-emerald-500 to-teal-600',
        title: `${firstName} حقّقت التارجت! 🎉`,
        body: 'أنت فوق الهدف هذا الشهر. كل صفقة من هنا رصيد إضافي لك.' };
    }
    if (stats.overdueCount > 0) {
      return { icon: Target, tone: 'from-amber-500 to-orange-600',
        title: `عندك ${fmt(stats.overdueCount)} متابعة فايتة`,
        body: 'أسرع مكسب متاح لك الآن: العملاء دول عرفوك بالفعل — مكالمة واحدة تفرق.' };
    }
    if (stats.todayFollowupCount > 0) {
      return { icon: Sunrise, tone: 'from-sky-500 to-indigo-600',
        title: `${fmt(stats.todayFollowupCount)} متابعة مستحقة اليوم`,
        body: 'خلّصهم بدري والباقي من يومك يبقى للعملاء الجدد.' };
    }
    if (targetPct !== null && targetPct >= 70) {
      return { icon: TrendingUp, tone: 'from-violet-500 to-indigo-600',
        title: `${targetPct}% من التارجت — قربت خلاص`,
        body: stats.monthlyTargetType === 'clients'
          ? `فاضلك ${fmt(remaining)} عميل بس.`
          : `فاضلك ${fmt(remaining)} ج.م بس على الهدف.` };
    }
    if (streak >= 3) {
      return { icon: Flame, tone: 'from-rose-500 to-orange-600',
        title: `${fmt(streak)} أيام نشاط متواصلة 🔥`,
        body: 'الاستمرارية دي هي اللي تبني الأرقام الكبيرة. متكسرهاش النهاردة.' };
    }
    if (stats.convertedThisMonth > 0) {
      return { icon: Sparkles, tone: 'from-emerald-500 to-green-600',
        title: `${fmt(stats.convertedThisMonth)} تحويل هذا الشهر`,
        body: 'كل واحد منهم كان مجرد اسم في قائمة. أنت اللي حوّلته لعميل.' };
    }
    return { icon: Sunrise, tone: 'from-indigo-500 to-violet-600',
      title: `يوم جديد يا ${firstName}`,
      body: 'ابدأ بمكالمة واحدة. أول مكالمة هي أصعب حاجة، وبعدها كل شيء يمشي.' };
  }, [stats, targetPct, remaining, streak]);

  const HeadlineIcon = headline.icon;

  return (
    <div className="space-y-3">
      {/* Contextual headline — reacts to today's real state */}
      <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-l ${headline.tone} p-5 text-white shadow-sm`}>
        <div className="pointer-events-none absolute -top-16 left-6 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="relative z-10 flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/20">
            <HeadlineIcon size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-lg font-black leading-tight">{headline.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-white/85">{headline.body}</p>
          </div>
        </div>

        {targetPct !== null && (
          <div className="relative z-10 mt-4">
            <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-white/80">
              <span>التقدّم نحو التارجت</span>
              <span>{targetPct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white transition-all" style={{ width: `${targetPct}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Permanent quote strip + earned badges */}
      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
        <div className="flex items-start gap-3">
          <Quote size={16} className="mt-0.5 shrink-0 text-indigo-400" />
          <div className="min-w-0">
            <p className="text-sm font-bold leading-relaxed text-indigo-900">{quote.text}</p>
            {quote.author && <p className="mt-0.5 text-[11px] text-indigo-500">— {quote.author}</p>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {streak >= 2 && (
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-orange-700 border border-orange-200">
              🔥 {fmt(streak)} أيام متواصلة
            </span>
          )}
          {stats.convRate >= 15 && (
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
              ⚡ معدل تحويل {stats.convRate}%
            </span>
          )}
          {stats.callsThisMonth >= 50 && (
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-cyan-700 border border-cyan-200">
              📞 {fmt(stats.callsThisMonth)} تواصل هذا الشهر
            </span>
          )}
          {bestDay && bestDay.calls > 0 && (
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-indigo-700 border border-indigo-200">
              أفضل يوم: {bestDay.label} ({fmt(bestDay.calls)})
            </span>
          )}
          {stats.overdueCount === 0 && stats.todayFollowupCount === 0 && (
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-emerald-700 border border-emerald-200">
              ✅ مفيش متابعات متأخرة
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
