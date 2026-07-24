import { TrendingUp, CreditCard, BarChart3, Users, Tag, Globe, Trophy, Layers } from 'lucide-react';
import type { DiscountRule } from '../../../../types';
import { StatCard, ProgressBar, SOURCE_ICONS, SOURCE_COLORS, pct, fmtK, type SourceBreakdownRow, type FunnelStep } from './shared';
import { AttributionTable } from './AttributionTable';

interface Props {
  convRate: number;
  convertedLeads: number;
  filteredOrdersCount: number;
  totalRevenue: number;
  filteredSubsCount: number;
  discounts: DiscountRule[];
  activeDiscounts: DiscountRule[];
  sourceBreakdown: SourceBreakdownRow[];
  funnel: FunnelStep[];
}

export function PerformanceSection({
  convRate, convertedLeads, filteredOrdersCount, totalRevenue, filteredSubsCount,
  discounts, activeDiscounts, sourceBreakdown, funnel,
}: Props) {
  return (
    <div className="space-y-5">

      {/* Main KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard label="معدل تحويل الليدات" value={`${convRate}%`} sub={`${convertedLeads} تحويل`} icon={TrendingUp} color="text-green-600" bg="bg-green-50" />
        <StatCard label="متوسط إيراد/طلب" value={filteredOrdersCount > 0 ? `${Math.round(totalRevenue / filteredOrdersCount).toLocaleString()} ج` : '—'} sub={`${filteredOrdersCount} طلب`} icon={CreditCard} color="text-indigo-600" bg="bg-indigo-50" />
        <StatCard label="إجمالي الإيراد" value={`${fmtK(totalRevenue)} ج`} sub="هذه الفترة" icon={BarChart3} color="text-rose-600" bg="bg-rose-50" />
        <StatCard label="مشتركين جدد" value={filteredSubsCount} sub="هذه الفترة" icon={Users} color="text-teal-600" bg="bg-teal-50" />
        <StatCard label="كوبونات نشطة" value={activeDiscounts.length} sub={`من ${discounts.length} إجمالي`} icon={Tag} color="text-purple-600" bg="bg-purple-50" />
        <StatCard label="قنوات تسويقية" value={sourceBreakdown.length} sub="مصدر مختلف" icon={Globe} color="text-amber-600" bg="bg-amber-50" />
      </div>

      {/* Source performance ranking */}
      {sourceBreakdown.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <Trophy size={16} className="text-amber-500" />
            <h3 className="font-bold text-gray-800">ترتيب المصادر بالأداء</h3>
          </div>
          <div className="p-4 space-y-3">
            {sourceBreakdown.map((src, idx) => (
              <div key={src.source} className="flex items-center gap-3">
                <span className="text-sm w-5 text-center font-mono text-gray-400">
                  {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx+1}.`}
                </span>
                <span className="text-lg">{SOURCE_ICONS[src.source] || '❓'}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${SOURCE_COLORS[src.source] || 'bg-gray-100 text-gray-600 border-gray-200'} w-20 text-center`}>
                  {src.source}
                </span>
                <div className="flex-1">
                  <ProgressBar value={src.total} max={sourceBreakdown[0]?.total || 1} color="bg-rose-400" height="h-2.5" />
                </div>
                <div className="text-right text-xs w-28">
                  <span className="font-bold text-gray-700">{src.total} ليد</span>
                  <span className={`mr-2 font-semibold ${src.convRate >= 30 ? 'text-green-600' : src.convRate >= 15 ? 'text-yellow-600' : 'text-red-400'}`}>
                    {src.convRate}% ✓
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funnel performance */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <Layers size={16} className="text-rose-500" /> أداء مسار التحويل الكامل
        </h3>
        <div className="space-y-4">
          {funnel.map((step, idx) => (
            <div key={step.label} className="flex items-center gap-4">
              <span className="w-5 h-5 rounded-full bg-rose-100 text-rose-600 text-xs flex items-center justify-center font-bold shrink-0">{idx+1}</span>
              <span className="text-sm text-gray-600 w-28">{step.label}</span>
              <div className="flex-1">
                <ProgressBar value={step.value} max={funnel[0].value || 1} color={step.color} height="h-4" />
              </div>
              <span className="text-sm font-bold text-gray-700 w-12 text-left">{step.value}</span>
              <span className={`text-xs font-bold w-10 text-left ${step.w >= 50 ? 'text-green-600' : step.w >= 25 ? 'text-yellow-600' : 'text-red-400'}`}>
                {step.w}%
              </span>
            </div>
          ))}
        </div>
        {/* Drop-off analysis */}
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h4 className="text-sm font-semibold text-gray-600 mb-2">تحليل الانسحاب</h4>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            {funnel.slice(1).map((step, idx) => {
              const prev = funnel[idx];
              const drop = prev.value - step.value;
              const dropPct = pct(drop, prev.value);
              return (
                <div key={step.label} className="bg-red-50 rounded-xl p-2">
                  <div className="font-bold text-red-600">{drop} ({dropPct}%)</div>
                  <div className="text-gray-400 mt-0.5">انسحاب بعد {prev.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <AttributionTable />
    </div>
  );
}
