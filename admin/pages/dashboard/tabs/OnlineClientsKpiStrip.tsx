import type { ElementType } from 'react';
import {
  CalendarCheck, CalendarDays, CalendarRange, CheckCircle2, CirclePause, Globe2, GraduationCap, Hourglass,
  MapPin, Users, Wallet,
} from 'lucide-react';
import type { SubscriberItem } from '../../../types';

type OnlineClientsKpiStripProps = {
  isDaqqiClientsTab: boolean;
  allCombined: SubscriberItem[];
  collTodayRev: number;
  collWeekRev: number;
  collMonthRev: number;
  collTotalRem: number;
  fmtK: (value: number) => string;
  /** «محلي / سعودي / دولي» for an online client, null for a branch one. */
  marketOf: (subscriber: SubscriberItem) => 'local' | 'saudi' | 'intl' | null;
};

type Stat = { label: string; value: string | number; icon: ElementType; tone: string };

// Tint for the icon square, per tone.
const TONES: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700', violet: 'bg-violet-100 text-violet-700', emerald: 'bg-emerald-100 text-emerald-700',
  cyan: 'bg-cyan-100 text-cyan-700', sky: 'bg-sky-100 text-sky-700', blue: 'bg-blue-100 text-blue-700',
  indigo: 'bg-indigo-100 text-indigo-700', rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700',
  green: 'bg-green-100 text-green-700',
};

const TERMINAL = ['finished', 'paused', 'refunded', 'refund_pending'];

/**
 * The numbers above the table, as one compact card in two groups — who the
 * clients are, and what came in — instead of nine tall tiles.
 */
export function OnlineClientsKpiStrip({
  isDaqqiClientsTab, allCombined, collTodayRev, collWeekRev, collMonthRev, collTotalRem, fmtK, marketOf,
}: OnlineClientsKpiStripProps) {
  const clients: Stat[] = isDaqqiClientsTab ? [
    { label: 'عملاء الدقي', value: allCombined.length, icon: Users, tone: 'indigo' },
    { label: 'نشطين', value: allCombined.filter(s => !TERMINAL.includes(s.clientStatus || '')).length, icon: CheckCircle2, tone: 'emerald' },
    { label: 'منتهين', value: allCombined.filter(s => s.clientStatus === 'finished').length, icon: GraduationCap, tone: 'green' },
    { label: 'متوقفين', value: allCombined.filter(s => s.clientStatus === 'paused').length, icon: CirclePause, tone: 'amber' },
  ] : [
    { label: 'إجمالي العملاء', value: allCombined.length, icon: Users, tone: 'slate' },
    { label: 'محلي', value: allCombined.filter(s => marketOf(s) === 'local').length, icon: MapPin, tone: 'violet' },
    { label: 'سعودي', value: allCombined.filter(s => marketOf(s) === 'saudi').length, icon: MapPin, tone: 'emerald' },
    { label: 'دولي', value: allCombined.filter(s => marketOf(s) === 'intl').length, icon: Globe2, tone: 'cyan' },
  ];
  const money: Stat[] = [
    { label: 'تحصيل اليوم', value: `${fmtK(collTodayRev)} ج`, icon: CalendarCheck, tone: 'sky' },
    { label: 'تحصيل الأسبوع', value: `${fmtK(collWeekRev)} ج`, icon: CalendarDays, tone: 'blue' },
    { label: 'تحصيل الشهر', value: `${fmtK(collMonthRev)} ج`, icon: CalendarRange, tone: 'indigo' },
    { label: 'المتبقي', value: `${fmtK(collTotalRem)} ج`, icon: Hourglass, tone: 'rose' },
  ];

  const group = (title: string, TitleIcon: ElementType, stats: Stat[]) => (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-bold text-gray-400">
        <TitleIcon size={11} /> {title}
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="flex items-center gap-2 rounded-xl bg-gray-50/80 px-2 py-1.5">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>
              <Icon size={14} />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-sm font-extrabold text-gray-900">{value}</span>
              <span className="block truncate text-[10px] text-gray-500">{label}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-2.5 xl:flex-row">
      {group('العملاء', Users, clients)}
      <div className="hidden w-px bg-gray-100 xl:block" />
      {group('التحصيل', Wallet, money)}
    </div>
  );
}
