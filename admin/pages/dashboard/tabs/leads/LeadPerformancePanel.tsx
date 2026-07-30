import { Activity, BarChart2, Phone, TrendingUp } from 'lucide-react';
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

export function LeadPerformancePanel({
  leads,
  totalConverted,
  monthlyTrend,
  funnelData,
  sourcesData,
  commsByRep,
}: LeadPerformancePanelProps) {
  const visibleLeads = leads.filter(l => !l.hidden);

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
        totalLeads={visibleLeads.length}
        conversionRate={visibleLeads.length > 0 ? `${Math.round((totalConverted / visibleLeads.length) * 100)}%` : '0%'}
        convertedCount={totalConverted}
        totalCommunications={leads.reduce((s, l) => s + (l.communicationCount ?? l.communications?.length ?? 0), 0)}
        monthlyLeads={leads.filter(l => (l.createdAt || '').startsWith(new Date().toISOString().slice(0, 7))).length}
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
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <PieChart>
                <Pie
                  data={sourcesData}
                  cx="50%"
                  cy="50%"
                  outerRadius={72}
                  innerRadius={32}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {sourcesData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
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
