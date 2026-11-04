import { useEffect, useMemo, useState } from 'react';
import { rangeStartDate } from '../../../lib/rangeStart';
import { FileText, TrendingUp, Users, DollarSign, Tag, BarChart3, PieChart as PieIcon } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { numericTooltip } from '../../../lib/chartFormat';
import { STATUS_CFG } from './leadUtils';

type Range = 'week' | 'month' | '3months' | 'all';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'];

// The complete Arabic map is STATUS_CFG, one directory over. This file kept a
// partial copy of eight — including 'follow_up', which is not a lead status at
// all — so a desk working no_answer_wa and interested_followup saw raw English
// in the legend of an Arabic pie chart.
const leadStatusLabel = (status: string) =>
  STATUS_CFG[status as keyof typeof STATUS_CFG]?.label || status;


type Breakdown = {
  leads: { status: string; source: string; n: number }[];
  revenue: number; payments: number;
  byStaff: { staffId: string | null; name: string; revenue: number; payments: number }[];
  byItem: { id: string | null; name: string; revenue: number; payments: number }[];
};

// The numbers are the server's (GET /api/admin/reports/sales-breakdown): the leads by status and source, the collected money in EGP in total, by employee and by course or
// track, over the range chosen. The screen used to count them out of the leads and orders its browser held — it loaded every lead of the tenant to do it — and added
// amounts of different currencies as if they were one (4 Nov 2026).
export default function SalesReportsTab() {
  const [range, setRange] = useState<Range>('month');
  const [data, setData] = useState<Breakdown | null>(null);
  const [failed, setFailed] = useState(false);

  const rangeStart = rangeStartDate(range);
  useEffect(() => {
    let live = true;
    setFailed(false);
    mysqlAdmin.adminGet<Breakdown>(`/admin/reports/sales-breakdown${rangeStart ? `?from=${rangeStart.slice(0, 10)}` : ''}`)
      .then(result => { if (live) setData(result); })
      .catch(() => { if (live) { setData(null); setFailed(true); } });
    return () => { live = false; };
  }, [rangeStart]);

  const leadRows = useMemo(() => data?.leads || [], [data]);
  const leadsTotal = leadRows.reduce((sum, row) => sum + row.n, 0);
  const totalRevenue = data?.revenue || 0;
  const avgOrderValue = data && data.payments > 0 ? Math.round(totalRevenue / data.payments) : 0;
  const converted = leadRows.filter(row => row.status === 'converted').reduce((sum, row) => sum + row.n, 0);
  const convRate = leadsTotal > 0 ? Math.round((converted / leadsTotal) * 100) : 0;

  // Leads by status
  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    leadRows.forEach(row => { map[row.status] = (map[row.status] || 0) + row.n; });
    return Object.entries(map).map(([k, v]) => ({ name: leadStatusLabel(k), value: v })).sort((x, y) => y.value - x.value);
  }, [leadRows]);

  // Leads by source
  const bySource = useMemo(() => {
    const map: Record<string, number> = {};
    leadRows.forEach(row => { map[row.source] = (map[row.source] || 0) + row.n; });
    return Object.entries(map).map(([k, v]) => ({ name: k, value: v })).sort((x, y) => y.value - x.value).slice(0, 6);
  }, [leadRows]);

  // Revenue by staff and by course or track
  const byStaff = (data?.byStaff || []).map(row => ({ name: row.name, revenue: row.revenue, orders: row.payments }));
  const byCourse = (data?.byItem || []).map(row => ({ name: row.name, revenue: row.revenue, count: row.payments }));

  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(n);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-violet-600 to-purple-700 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><FileText size={22} />تقارير المبيعات</h2>
            <p className="text-violet-200 text-sm mt-1">تحليل شامل للمبيعات والليدات والإيرادات</p>
          </div>
          <div className="flex gap-1 bg-white/10 rounded-xl p-1">
            {([['week','أسبوع'], ['month','الشهر'], ['3months','3 أشهر'], ['all','الكل']] as [Range, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${range === k ? 'bg-white text-violet-700' : 'text-white hover:bg-white/20'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {failed && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">تعذر تحميل أرقام التقرير — جرّب تاني بعد شوية.</p>}

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي الليدات', val: leadsTotal, color: 'blue', icon: Users },
          { label: 'إجمالي الإيراد', val: `${fmtMoney(totalRevenue)} ج`, color: 'emerald', icon: DollarSign },
          { label: 'معدل التحويل', val: `${convRate}%`, color: 'amber', icon: TrendingUp },
          { label: 'متوسط الطلب', val: `${fmtMoney(avgOrderValue)} ج`, color: 'violet', icon: BarChart3 },
        ].map(k => {
          const Icon = k.icon;
          return (
            <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 flex items-center gap-3`}>
              <div className={`w-10 h-10 rounded-xl bg-${k.color}-100 flex items-center justify-center flex-shrink-0`}>
                <Icon size={18} className={`text-${k.color}-600`} />
              </div>
              <div>
                <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
                <div className="text-xs text-gray-500">{k.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Leads by status */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><PieIcon size={16} className="text-violet-500" />الليدات حسب الحالة</h3>
          <div className="flex gap-4 items-center">
            <PieChart width={140} height={140}>
              <Pie data={byStatus} cx={65} cy={65} outerRadius={55} dataKey="value" nameKey="name">
                {byStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
            </PieChart>
            <div className="flex-1 space-y-1.5">
              {byStatus.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2 text-sm">
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-gray-600 flex-1 truncate">{s.name}</span>
                  <span className="font-bold text-gray-900">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Leads by source */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Tag size={16} className="text-blue-500" />الليدات حسب المصدر</h3>
          <div className="space-y-3">
            {bySource.map((s, i) => (
              <div key={s.name} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-400 w-5">{i+1}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700">{s.name}</span>
                    <span className="text-sm font-bold text-gray-900">{s.value}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full">
                    <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${(s.value / (bySource[0]?.value || 1)) * 100}%` }} />
                  </div>
                </div>
              </div>
            ))}
            {bySource.length === 0 && <p className="text-center text-gray-400 text-sm py-4">لا توجد بيانات</p>}
          </div>
        </div>
      </div>

      {/* Revenue by staff */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-emerald-500" />الإيراد حسب الموظف</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={byStaff}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtMoney(v)} />
            <Tooltip formatter={numericTooltip(v => [`${v.toLocaleString('ar-EG-u-nu-latn')} ج`, 'الإيراد'])} />
            <Bar dataKey="revenue" fill="#10b981" radius={[4,4,0,0]} name="الإيراد" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue by course */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100"><h3 className="font-bold text-gray-800">🎓 الإيراد حسب الكورس</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الكورس</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الطلبات</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الإيراد</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">النسبة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {byCourse.map(c => (
                <tr key={c.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800 truncate max-w-[200px]">{c.name}</td>
                  <td className="px-4 py-3 text-blue-700 font-bold">{c.count}</td>
                  <td className="px-4 py-3 text-emerald-700 font-bold">{c.revenue.toLocaleString('ar-EG-u-nu-latn')} ج</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                        <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${(c.revenue / totalRevenue) * 100}%` }} />
                      </div>
                      <span className="text-xs text-gray-600">{totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 100) : 0}%</span>
                    </div>
                  </td>
                </tr>
              ))}
              {byCourse.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">لا توجد طلبات مدفوعة في هذه الفترة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
