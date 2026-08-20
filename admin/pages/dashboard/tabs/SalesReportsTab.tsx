import { useMemo, useState } from 'react';
import { FileText, TrendingUp, Users, DollarSign, Tag, BarChart3, PieChart as PieIcon } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from 'recharts';

type Range = 'week' | 'month' | '3months' | 'all';

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'];

const LEAD_STATUS_LABEL: Record<string, string> = {
  new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم', interested_booking: 'مهتم (حجز)',
  converted: 'تم التحويل', not_interested: 'غير مهتم', no_answer: 'لا يرد', follow_up: 'متابعة',
};

function getRangeStart(range: Range): string {
  const d = new Date();
  if (range === 'week') return new Date(+d - 7 * 86400000).toISOString().slice(0, 10);
  if (range === 'month') return `${new Date().toISOString().slice(0, 7)}-01`;
  if (range === '3months') return new Date(+d - 90 * 86400000).toISOString().slice(0, 10);
  return '2000-01-01';
}

export default function SalesReportsTab() {
  const { leads, orders, staffMembers, courses } = useSiteData();
  const [range, setRange] = useState<Range>('month');

  const rangeStart = getRangeStart(range);

  const filteredLeads = useMemo(() => leads.filter(l => (l.createdAt || '') >= rangeStart), [leads, rangeStart]);
  const filteredOrders = useMemo(() => orders.filter(o => o.status === 'paid' && (o.createdAt || '') >= rangeStart), [orders, rangeStart]);

  const totalRevenue = useMemo(() => filteredOrders.reduce((acc, o) => acc + (Number(o.amount) || 0), 0), [filteredOrders]);
  const avgOrderValue = filteredOrders.length > 0 ? Math.round(totalRevenue / filteredOrders.length) : 0;
  const convRate = filteredLeads.length > 0
    ? Math.round((filteredLeads.filter(l => l.status === 'converted').length / filteredLeads.length) * 100) : 0;

  // Leads by status
  const byStatus = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLeads.forEach(l => { const s = l.status || 'new'; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ name: LEAD_STATUS_LABEL[k] || k, value: v }))
      .sort((a, b) => b.value - a.value);
  }, [filteredLeads]);

  // Leads by source
  const bySource = useMemo(() => {
    const map: Record<string, number> = {};
    filteredLeads.forEach(l => { const s = l.source || 'غير محدد'; map[s] = (map[s] || 0) + 1; });
    return Object.entries(map).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [filteredLeads]);

  // Revenue by staff
  const byStaff = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; orders: number }> = {};
    filteredOrders.forEach(o => {
      const s = staffMembers.find(st => st.id === o.staffId);
      const key = o.staffId || 'unknown';
      if (!map[key]) map[key] = { name: s?.name || 'غير محدد', revenue: 0, orders: 0 };
      map[key].revenue += Number(o.amount) || 0;
      map[key].orders++;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  }, [filteredOrders, staffMembers]);

  // Revenue by course
  const byCourse = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; count: number }> = {};
    filteredOrders.forEach(o => {
      const cid = o.courseId || o.bundleId || 'unknown';
      const c = courses.find(c => c.id === cid);
      if (!map[cid]) map[cid] = { name: c?.title || o.courseName || 'غير محدد', revenue: 0, count: 0 };
      map[cid].revenue += Number(o.amount) || 0;
      map[cid].count++;
    });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [filteredOrders, courses]);

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

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي الليدات', val: filteredLeads.length, color: 'blue', icon: Users },
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
            <Tooltip formatter={(v: unknown) => [`${Number(v).toLocaleString()} ج`, 'الإيراد']} />
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
                  <td className="px-4 py-3 text-emerald-700 font-bold">{c.revenue.toLocaleString()} ج</td>
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
