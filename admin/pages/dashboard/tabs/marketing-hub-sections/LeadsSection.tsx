import { TrendingUp, CheckCircle, Globe } from 'lucide-react';
import type { LeadItem } from '../../../../types';
import { MiniBarChart, SOURCE_ICONS, SOURCE_COLORS, pct, fmtK, type SourceBreakdownRow } from './shared';

interface Props {
  filteredLeads: LeadItem[];
  leadsChartData: { label: string; value: number }[];
  convChartData: { label: string; value: number }[];
  sourceBreakdown: SourceBreakdownRow[];
}

export function LeadsSection({ filteredLeads, leadsChartData, convChartData, sourceBreakdown }: Props) {
  return (
    <div className="space-y-5">

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5">
              <TrendingUp size={15} className="text-rose-500" /> منحنى الليدات (٧ أيام)
            </h3>
            <span className="text-xs font-bold text-rose-500">{leadsChartData.reduce((s,d)=>s+d.value,0)} ليد</span>
          </div>
          <MiniBarChart data={leadsChartData} color="bg-rose-400" height={60} showLabels />
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
          <h3 className="font-bold text-gray-800 text-sm flex items-center gap-1.5 mb-3">
            <CheckCircle size={15} className="text-green-500" /> تحويلات آخر ٧ أيام
          </h3>
          <MiniBarChart data={convChartData} color="bg-green-400" height={60} showLabels />
        </div>
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { status: 'new', label: 'جديد', color: 'bg-blue-50 border-blue-200', textColor: 'text-blue-700', icon: '🆕' },
          { status: 'contacted', label: 'تم التواصل', color: 'bg-indigo-50 border-indigo-200', textColor: 'text-indigo-700', icon: '📞' },
          { status: 'interested', label: 'مهتم', color: 'bg-yellow-50 border-yellow-200', textColor: 'text-yellow-700', icon: '💡' },
          { status: 'converted', label: 'محوّل ✓', color: 'bg-green-50 border-green-200', textColor: 'text-green-700', icon: '✅' },
        ].map(s => (
          <div key={s.status} className={`border rounded-2xl p-4 text-center ${s.color}`}>
            <div className="text-2xl mb-1">{s.icon}</div>
            <div className={`text-3xl font-black ${s.textColor}`}>
              {filteredLeads.filter(l => l.status === s.status).length}
            </div>
            <div className={`text-xs font-medium mt-1 ${s.textColor}`}>{s.label}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {pct(filteredLeads.filter(l => l.status === s.status).length, filteredLeads.length)}%
            </div>
          </div>
        ))}
      </div>

      {/* Sources detailed table */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Globe size={16} className="text-rose-500" /> تحليل المصادر التفصيلي
          </h3>
          <span className="text-xs text-gray-400">{filteredLeads.length} ليد إجمالي</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-right p-3 font-medium">المصدر</th>
                <th className="text-center p-3 font-medium">إجمالي</th>
                <th className="text-center p-3 font-medium">تواصل</th>
                <th className="text-center p-3 font-medium">مهتم</th>
                <th className="text-center p-3 font-medium">محوّل</th>
                <th className="text-center p-3 font-medium">% تحويل</th>
                <th className="text-center p-3 font-medium">إيراد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sourceBreakdown.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا ليدات في هذه الفترة</td></tr>
              ) : sourceBreakdown.map(src => {
                const myLeads = filteredLeads.filter(l => (l.source || 'Other') === src.source);
                const contacted = myLeads.filter(l => ['contacted','interested','converted','lost'].includes(l.status||'')).length;
                const interested = myLeads.filter(l => ['interested','converted'].includes(l.status||'')).length;
                return (
                  <tr key={src.source} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{SOURCE_ICONS[src.source] || '❓'}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${SOURCE_COLORS[src.source] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                          {src.source}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-center font-bold text-gray-800">{src.total}</td>
                    <td className="p-3 text-center text-indigo-600">{contacted}</td>
                    <td className="p-3 text-center text-amber-600">{interested}</td>
                    <td className="p-3 text-center text-green-600 font-semibold">{src.converted}</td>
                    <td className="p-3 text-center">
                      <span className={`font-bold ${src.convRate >= 30 ? 'text-green-600' : src.convRate >= 15 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {src.convRate}%
                      </span>
                    </td>
                    <td className="p-3 text-center text-teal-600 font-semibold">
                      {src.revenue > 0 ? `${fmtK(src.revenue)} ج` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
