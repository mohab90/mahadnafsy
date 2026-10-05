// «اعملي بعض الارقام التحليله في اعلي الصفحه عن الدقي»: the branch at a glance,
// above the schedule. The figures come from daqqiOverview(); this only lays
// them out.

import type { daqqiOverview } from './daqqiScheduleUtils';
import { usePhysicalBranch } from '../../../../lib/physicalBranch';

const num = (value: number) => value.toLocaleString('ar-EG-u-nu-latn');

export function DaqqiOverviewStrip({ overview }: { overview: ReturnType<typeof daqqiOverview> }) {
  const physicalBranch = usePhysicalBranch();
  const share = overview.clients ? Math.round((overview.placed / overview.clients) * 100) : 0;
  const tiles: { label: string; value: string; note: string; tone?: 'attention' }[] = [
    { label: `عملاء ${physicalBranch.label}`, value: num(overview.clients), note: 'كل عملاء الفرع' },
    { label: 'مسكّنين في روندات', value: num(overview.placed), note: `${num(share)}% من العملاء` },
    {
      label: 'حاجزين ومش مسكّنين', value: num(overview.waiting), note: 'كورسهم له روند مفتوح',
      tone: overview.waiting > 0 ? 'attention' : undefined,
    },
    {
      label: 'روندات شغالة', value: num(overview.rounds.active),
      note: `${num(overview.rounds.fresh)} جديد · ${num(overview.rounds.finished)} منتهي`,
    },
    {
      label: 'محاضرات الأسبوع ده', value: `${num(overview.week.held)} اشتغلت`,
      note: `${num(overview.week.postponed)} اتأجلت · ${num(overview.week.unanswered)} لسه متسجلتش`,
      tone: overview.week.unanswered > 0 ? 'attention' : undefined,
    },
    { label: 'محصّل الروندات المفتوحة', value: `${num(overview.collected)} ج.م`, note: `المتبقي ${num(overview.remaining)} ج.م${overview.prior > 0 ? ` · قبل السيستم ${num(overview.prior)}` : ''}` },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map(tile => (
        <div key={tile.label}
          className={`min-w-0 rounded-xl border px-3 py-2.5 ${tile.tone === 'attention' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
          <p className="truncate text-[11px] font-semibold text-gray-500">{tile.label}</p>
          <p className={`mt-0.5 truncate text-lg font-extrabold ${tile.tone === 'attention' ? 'text-amber-800' : 'text-gray-900'}`}>{tile.value}</p>
          <p className="truncate text-[10px] text-gray-500">{tile.note}</p>
        </div>
      ))}
    </div>
  );
}
