import { Activity, BarChart2, Phone, TrendingUp } from 'lucide-react';
import { cairoMonthOnly, cairoDay } from '../../../../../shared/cairoDate';
import { useCrmData } from '../../../../context/siteDataSlices';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import type { LeadItem } from '../../../../types';
import { PIE_COLORS } from '../leadUtils';
import { LeadPerformanceAnalyticsKpis } from './LeadPerformanceAnalyticsKpis';

type TrendRow = Record<string, string | number>;
type FunnelRow = { name: string; value: number; color: string };
type SourceRow = { name: string; value: number };
type CommsByRepRow = Record<string, string | number>;

interface LeadPerformancePanelProps {
  leads: LeadItem[];
  totalConverted: number;
  monthlyTrend: TrendRow[];
  funnelData: FunnelRow[];
  sourcesData: SourceRow[];
  commsByRep: CommsByRepRow[];
}

// The pie holds the biggest few; the rest are one slice. Each slice used to
// carry its own label, and with 25 sources — three of them over 80% between
// them — the labels were drawn on top of each other: «الصحة النفسية 49%» over
// «فيسبوك ليدز 22%» over «صحة نفسية 11%». The names now sit in a list beside it.
const TOP_SOURCES = 6;
function groupSources(rows: SourceRow[]): SourceRow[] {
  if (rows.length <= TOP_SOURCES + 1) return rows;
  const rest = rows.slice(TOP_SOURCES).reduce((sum, row) => sum + row.value, 0);
  return [...rows.slice(0, TOP_SOURCES), { name: `أخرى (${rows.length - TOP_SOURCES} مصدر)`, value: rest }];
}

export function LeadPerformancePanel({
  leads,
  totalConverted,
  monthlyTrend,
  funnelData,
  sourcesData,
  commsByRep,
}: LeadPerformancePanelProps) {
  const { leadStats } = useCrmData();
  // Three whole-table counts. leadStats answers each of them without the array;
  // the array arms are what run before the stats request resolves.
  const visibleCount = leadStats ? leadStats.total : leads.filter(l => !l.hidden).length;
  const thisMonth = cairoMonthOnly();
  const totalComms = leadStats
    ? leadStats.totalCommunications
    : leads.reduce((s, l) => s + (l.communicationCount ?? l.communications?.length ?? 0), 0);
  const monthlyLeads = leadStats
    ? (leadStats.byMonth?.[thisMonth]?.total ?? 0)
    : leads.filter(l => cairoDay(l.createdAt).startsWith(thisMonth)).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="flex items-center gap-1.5 text-sm font-bold text-gray-500 px-2">
          <BarChart2 size={14} className="text-violet-500" />
          الرسوم والإحصائيات
        </span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      <LeadPerformanceAnalyticsKpis
        totalLeads={visibleCount}
        conversionRate={visibleCount > 0 ? `${Math.round((totalConverted / visibleCount) * 100)}%` : '0%'}
        convertedCount={totalConverted}
        totalCommunications={totalComms}
        monthlyLeads={monthlyLeads}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <BarChart2 size={16} className="text-indigo-600" /> ليدز شهرياً (آخر 6 أشهر)
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyTrend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="ليدز" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Bar dataKey="محوّل" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <TrendingUp size={16} className="text-violet-600" /> قمع المبيعات
          </h4>
          <div className="space-y-2.5">
            {funnelData.map(item => {
              const maxVal = Math.max(...funnelData.map(d => d.value), 1);
              const pct = Math.round((item.value / maxVal) * 100);
              return (
                <div key={item.name} className="flex items-center gap-3">
                  <span className="text-xs text-gray-600 font-bold w-24 text-left flex-shrink-0">{item.name}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-7 overflow-hidden">
                    <div
                      className="h-full rounded-full flex items-center justify-end px-2.5 transition-all duration-500"
                      style={{ width: `${Math.max(pct, 8)}%`, backgroundColor: item.color }}
                    >
                      <span className="text-white text-[10px] font-bold">{item.value}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Activity size={16} className="text-amber-600" /> مصادر الليدز
          </h4>
          {sourcesData.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-16">لا توجد بيانات</p>
          ) : (() => {
            const grouped = groupSources(sourcesData);
            const total = grouped.reduce((sum, row) => sum + row.value, 0) || 1;
            return (
              <div className="flex flex-col items-center gap-3 sm:flex-row">
                <div className="h-[180px] w-full sm:w-[180px] sm:flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={grouped} cx="50%" cy="50%" outerRadius={72} innerRadius={32} dataKey="value">
                        {grouped.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="w-full min-w-0 space-y-1.5 text-xs">
                  {grouped.map((row, i) => (
                    <li key={row.name} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="min-w-0 flex-1 truncate text-gray-700" title={row.name}>{row.name}</span>
                      <span className="font-bold text-gray-900">{row.value.toLocaleString('ar-EG-u-nu-latn')}</span>
                      <span className="w-10 text-left text-gray-500">{Math.round((row.value / total) * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Phone size={16} className="text-blue-600" /> تواصلات الفريق (نوع × مندوب)
          </h4>
          {commsByRep.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-16">لا يوجد بيانات</p>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={commsByRep} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="مكالمة" stackId="a" fill="#6366f1" maxBarSize={36} />
                <Bar dataKey="واتساب" stackId="a" fill="#10b981" maxBarSize={36} />
                <Bar dataKey="اجتماع" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
