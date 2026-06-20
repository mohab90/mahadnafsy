import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { FileText, TrendingUp, Users, DollarSign, Download, Filter, Calendar, Tag, BarChart3, PieChart as PieIcon, RefreshCw } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell } from 'recharts';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
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

type CommissionMonth = { month: string; dealsCount: number; totalCommission: number; totalPayment: number };
type CommissionStaff = { staffId: string; staffName: string; months: CommissionMonth[]; grandTotal: number };
type CommissionData = { from: string; months: string[]; staff: CommissionStaff[] };

export default function SalesReportsTab({ notify }: { notify: NotifyFn }) {
  const { leads, orders, staffMembers, courses } = useSiteData();
  const [range, setRange] = useState<Range>('month');
  const [commMonths, setCommMonths] = useState(6);
  const [commData, setCommData] = useState<CommissionData | null>(null);
  const [commLoading, setCommLoading] = useState(false);

  const loadCommissions = useCallback(async () => {
    setCommLoading(true);
    try {
      const res = await fetch(`/api/admin/commissions/monthly?months=${commMonths}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCommData(await res.json());
    } catch (e: any) {
      notify('error', `خطأ في تحميل بيانات العمولات: ${e.message}`);
    } finally { setCommLoading(false); }
  }, [commMonths, notify]);

  useEffect(() => { loadCommissions(); }, [loadCommissions]);

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
            {([['week','أسبوع'], ['month','الشهر'], ['3months','٣ أشهر'], ['all','الكل']] as [Range, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${range === k ? 'bg-white text-violet-700' : 'text-white hover:bg-white/20'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Sales Funnel */}
      {filteredLeads.length > 0 && (() => {
        const stages = [
          { key: 'new',               label: 'ليدات جديدة',    color: '#6366f1' },
          { key: 'contacted',         label: 'تم التواصل',      color: '#3b82f6' },
          { key: 'interested',        label: 'مهتمون',          color: '#f59e0b' },
          { key: 'interested_booking',label: 'حجز مبدئي',       color: '#f97316' },
          { key: 'converted',         label: 'تحول فعلي',       color: '#10b981' },
        ] as const;
        const counts = stages.map(s => ({
          ...s,
          count: filteredLeads.filter(l => l.status === s.key).length +
                 (s.key === 'new' ? filteredLeads.filter(l => !['contacted','interested','interested_booking','converted','not_interested','no_answer','follow_up'].includes(l.status || '')).length : 0),
        }));
        const maxCount = Math.max(...counts.map(c => c.count), 1);
        return (
          <div className="bg-white border border-gray-200 rounded-2xl p-5">
            <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-violet-500" /> قمع المبيعات (Funnel)
            </h3>
            <div className="space-y-2">
              {counts.map((s, i) => {
                const pct = Math.round((s.count / maxCount) * 100);
                const convPct = i > 0 ? (counts[i - 1].count > 0 ? Math.round((s.count / counts[i - 1].count) * 100) : 0) : 100;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="text-xs text-gray-500 w-28 text-right flex-shrink-0">{s.label}</div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-8 relative overflow-hidden">
                        <div
                          className="h-8 rounded-full flex items-center justify-end pr-3 transition-all"
                          style={{ width: `${Math.max(pct, 8)}%`, background: s.color, opacity: 0.85 + i * 0.03 }}
                        >
                          <span className="text-white text-xs font-bold">{s.count}</span>
                        </div>
                      </div>
                      {i > 0 && (
                        <span className="text-[10px] text-gray-400 w-12 flex-shrink-0">↓ {convPct}%</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
              <span>من {filteredLeads.length} ليد إجمالي</span>
              <span className="font-semibold text-emerald-600">
                {counts[4].count} تحول ({Math.round((counts[4].count / filteredLeads.length) * 100)}%)
              </span>
            </div>
          </div>
        );
      })()}

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
            <Tooltip formatter={((v: number) => [`${v.toLocaleString()} ج`, 'الإيراد']) as any} />
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

      {/* Commission Monthly Comparison */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <BarChart3 size={16} className="text-violet-500" />
            مقارنة عمولات الموظفين شهرياً
          </h3>
          <div className="flex items-center gap-2">
            <select
              value={commMonths}
              onChange={e => setCommMonths(Number(e.target.value))}
              className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white"
            >
              {[3, 4, 6, 9, 12].map(m => <option key={m} value={m}>{m} أشهر</option>)}
            </select>
            <button
              onClick={loadCommissions}
              disabled={commLoading}
              className="flex items-center gap-1 px-3 py-1.5 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700 disabled:opacity-50"
            >
              <RefreshCw size={12} className={commLoading ? 'animate-spin' : ''} />
              تحديث
            </button>
          </div>
        </div>
        {commLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <RefreshCw size={22} className="animate-spin ml-2" />
            جاري التحميل...
          </div>
        ) : commData && commData.staff.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" dir="rtl">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-right text-xs font-bold text-gray-500 whitespace-nowrap sticky right-0 bg-gray-50">الموظف</th>
                  {commData.months.map(m => (
                    <th key={m} className="px-3 py-3 text-center text-xs font-bold text-gray-500 whitespace-nowrap">
                      {m.slice(5)}/{m.slice(0, 4)}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 whitespace-nowrap">الإجمالي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {commData.staff.map(s => {
                  const maxComm = Math.max(...s.months.map(m => m.totalCommission), 1);
                  return (
                    <tr key={s.staffId} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap sticky right-0 bg-white">{s.staffName}</td>
                      {s.months.map(m => {
                        const pct = Math.round((m.totalCommission / maxComm) * 100);
                        return (
                          <td key={m.month} className="px-3 py-3 text-center">
                            {m.totalCommission > 0 ? (
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="text-xs font-bold text-violet-700">
                                  {m.totalCommission >= 1000 ? `${(m.totalCommission / 1000).toFixed(1)}ك` : m.totalCommission.toLocaleString()}
                                </span>
                                <div className="w-10 bg-gray-100 rounded-full h-1 mx-auto">
                                  <div className="h-1 rounded-full bg-violet-400" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[10px] text-gray-400">{m.dealsCount} صفقة</span>
                              </div>
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block bg-violet-50 text-violet-800 font-extrabold text-xs px-2.5 py-1 rounded-full">
                          {s.grandTotal >= 1000 ? `${(s.grandTotal / 1000).toFixed(1)}ك` : s.grandTotal.toLocaleString()} ج
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-gray-400 text-sm">لا توجد بيانات عمولات في هذه الفترة</div>
        )}
      </div>
    </div>
  );
}
