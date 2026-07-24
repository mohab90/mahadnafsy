import type { SubscriberItem } from '../../../types';

type OnlineClientsKpiStripProps = {
  isDaqqiClientsTab: boolean;
  allCombined: SubscriberItem[];
  mineSubsAll: SubscriberItem[];
  collTodayRev: number;
  collWeekRev: number;
  collMonthRev: number;
  collTotalRem: number;
  fmtK: (value: number) => string;
  isIntlSub: (subscriber: SubscriberItem) => boolean;
};

export function OnlineClientsKpiStrip({
  isDaqqiClientsTab,
  allCombined,
  mineSubsAll,
  collTodayRev,
  collWeekRev,
  collMonthRev,
  collTotalRem,
  fmtK,
  isIntlSub,
}: OnlineClientsKpiStripProps) {
  const stats = isDaqqiClientsTab ? [
    { label: 'إجمالي عملاء الدقي', value: allCombined.length, color: 'bg-indigo-50 text-indigo-700 border-indigo-200', icon: '🏢' },
    { label: 'نشطين', value: allCombined.filter(s => !['finished', 'paused', 'refunded', 'refund_pending'].includes(s.clientStatus || '')).length, color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '✅' },
    { label: 'منتهين', value: allCombined.filter(s => s.clientStatus === 'finished').length, color: 'bg-green-50 text-green-700 border-green-200', icon: '🎓' },
    { label: 'متوقفين', value: allCombined.filter(s => s.clientStatus === 'paused').length, color: 'bg-amber-50 text-amber-700 border-amber-200', icon: '⏸️' },
    { label: 'تحصيل اليوم', value: `${fmtK(collTodayRev)} ج`, color: 'bg-sky-50 text-sky-700 border-sky-200', icon: '📅' },
    { label: 'تحصيل الأسبوع', value: `${fmtK(collWeekRev)} ج`, color: 'bg-blue-50 text-blue-700 border-blue-200', icon: '📆' },
    { label: 'تحصيل الشهر', value: `${fmtK(collMonthRev)} ج`, color: 'bg-violet-50 text-violet-700 border-violet-200', icon: '💰' },
    { label: 'متبقي في الشيت', value: `${fmtK(collTotalRem)} ج`, color: 'bg-red-50 text-red-700 border-red-200', icon: '⏳' },
  ] : [
    { label: 'إجمالي العملاء', value: allCombined.length, color: 'bg-slate-50 text-slate-700 border-slate-200', icon: '👥' },
    { label: 'عملاء محلي', value: allCombined.filter(s => !isIntlSub(s)).length, color: 'bg-purple-50 text-purple-700 border-purple-200', icon: '🇪🇬' },
    { label: 'عملاء دولي', value: allCombined.filter(isIntlSub).length, color: 'bg-cyan-50 text-cyan-700 border-cyan-200', icon: '🌍' },
    { label: 'عملائي', value: mineSubsAll.length, color: 'bg-amber-50 text-amber-700 border-amber-200', icon: '⭐' },
    { label: 'تحصيل اليوم', value: `${fmtK(collTodayRev)} ج`, color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: '📅' },
    { label: 'تحصيل الأسبوع', value: `${fmtK(collWeekRev)} ج`, color: 'bg-green-50 text-green-700 border-green-200', icon: '📆' },
    { label: 'تحصيل الشهر', value: `${fmtK(collMonthRev)} ج`, color: 'bg-blue-50 text-blue-700 border-blue-200', icon: '💰' },
    { label: 'متبقي في الشيت', value: `${fmtK(collTotalRem)} ج`, color: 'bg-red-50 text-red-700 border-red-200', icon: '⏳' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
      {stats.map(stat => (
        <div key={stat.label} className={`border rounded-xl px-2 py-2 text-center ${stat.color}`}>
          <div className="text-xs mb-0.5">{stat.icon}</div>
          <div className="text-lg font-extrabold leading-tight">{stat.value}</div>
          <div className="text-[10px] mt-0.5 font-medium leading-tight">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
