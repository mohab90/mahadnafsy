import React, { useMemo, useState } from 'react';
import { BarChart3, TrendingUp, Users, Target, Trophy, Star, Award, Phone, ArrowUpRight, ArrowDownRight, Calendar, Filter, Download } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { StaffMember, LeadItem, OrderItem } from '../../../types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type TimeRange = 'week' | 'month' | '3months' | 'all';

const TODAY = new Date().toISOString().slice(0, 10);
const MONTH = new Date().toISOString().slice(0, 7);

function getRangeStart(range: TimeRange): string {
  const d = new Date();
  if (range === 'week') return new Date(+d - 7 * 86400000).toISOString().slice(0, 10);
  if (range === 'month') return `${MONTH}-01`;
  if (range === '3months') return new Date(+d - 90 * 86400000).toISOString().slice(0, 10);
  return '2000-01-01';
}

function inRange(ds: string | undefined, range: TimeRange) {
  if (range === 'all') return true;
  return (ds || '').slice(0, 10) >= getRangeStart(range);
}

const ROLE_LABEL: Record<string, string> = {
  sales: 'سيلز', collection: 'تحصيل', support: 'خدمة عملاء',
  manager: 'مدير', online_manager: 'مدير أونلاين', sales_collection_manager: 'مدير مبيعات وتحصيل',
  consultant: 'استشاري', hr: 'موارد بشرية',
};

const RANK_ICONS = [Trophy, Award, Star];
const RANK_COLORS = ['text-yellow-500', 'text-slate-400', 'text-amber-600'];

export default function StaffPerformanceTab({ notify }: { notify: NotifyFn }) {
  const { staffMembers, leads, orders, subscribers } = useSiteData();
  const [range, setRange] = useState<TimeRange>('month');
  const [roleFilter, setRoleFilter] = useState('all');

  const frontlineRoles = ['sales', 'collection', 'support', 'consultant', 'online_manager', 'sales_collection_manager'];
  const staff = useMemo(() =>
    staffMembers.filter(s => s.status === 'active' && (roleFilter === 'all' || s.role === roleFilter)),
    [staffMembers, roleFilter]
  );

  const stats = useMemo(() => {
    return staff.map(s => {
      const myLeads = leads.filter(l => l.assignedSalesId === s.id && inRange(l.createdAt, range));
      const myConverted = leads.filter(l => l.assignedSalesId === s.id && l.status === 'converted' && inRange(l.createdAt, range));
      const myOrders = orders.filter(o => o.staffId === s.id && inRange(o.createdAt, range));
      const revenue = myOrders.reduce((acc, o) => acc + (Number(o.amount) || 0), 0);
      const convRate = myLeads.length > 0 ? Math.round((myConverted.length / myLeads.length) * 100) : 0;
      const myContacted = leads.filter(l => l.assignedSalesId === s.id && ['contacted', 'interested', 'interested_booking', 'converted'].includes(l.status) && inRange(l.updatedAt || l.createdAt, range));
      return { ...s, myLeads: myLeads.length, myConverted: myConverted.length, revenue, convRate, contacted: myContacted.length };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [staff, leads, orders, range]);

  const totals = useMemo(() => ({
    leads: stats.reduce((a, s) => a + s.myLeads, 0),
    converted: stats.reduce((a, s) => a + s.myConverted, 0),
    revenue: stats.reduce((a, s) => a + s.revenue, 0),
  }), [stats]);

  const chartData = stats.slice(0, 8).map(s => ({
    name: s.name.split(' ')[0],
    'ليدات': s.myLeads,
    'تحويلات': s.myConverted,
    'إيراد (ك)': Math.round(s.revenue / 1000),
  }));

  const roles = [...new Set(staffMembers.map(s => s.role))].filter(r => frontlineRoles.includes(r));

  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(n);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-indigo-600 to-violet-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><BarChart3 size={22} /> أداء فريق العمل</h2>
            <p className="text-indigo-200 text-sm mt-1">تتبع أداء كل موظف — ليدات وتحويلات وإيرادات</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-white/10 rounded-xl p-1">
              {([['week','أسبوع'], ['month','الشهر'], ['3months','٣ أشهر'], ['all','الكل']] as [TimeRange,string][]).map(([k,l]) => (
                <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${range === k ? 'bg-white text-indigo-700' : 'text-white hover:bg-white/20'}`}>{l}</button>
              ))}
            </div>
            <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="bg-white/20 text-white border-0 rounded-xl px-3 py-2 text-sm">
              <option value="all" className="text-gray-800">كل الأدوار</option>
              {roles.map(r => <option key={r} value={r} className="text-gray-800">{ROLE_LABEL[r] || r}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'عدد الموظفين', val: stats.length, icon: Users, color: 'indigo' },
          { label: 'إجمالي الليدات', val: totals.leads, icon: TrendingUp, color: 'blue' },
          { label: 'التحويلات', val: totals.converted, icon: Target, color: 'emerald' },
          { label: 'الإيراد الكلي', val: fmtMoney(totals.revenue) + ' ج', icon: BarChart3, color: 'violet' },
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

      {/* Chart */}
      {chartData.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-indigo-500" />مقارنة أداء الفريق</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="ليدات" fill="#818cf8" radius={[4,4,0,0]} />
              <Bar dataKey="تحويلات" fill="#34d399" radius={[4,4,0,0]} />
              <Bar dataKey="إيراد (ك)" fill="#a78bfa" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Staff table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Users size={16} className="text-indigo-500" />ترتيب الأداء</h3>
          <span className="text-xs text-gray-400">{stats.length} موظف</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">#</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الموظف</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الدور</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الليدات</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">التحويلات</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">معدل التحويل</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الإيراد</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.map((s, i) => {
                const RankIcon = i < 3 ? RANK_ICONS[i] : null;
                return (
                  <tr key={s.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-3">
                      {RankIcon ? <RankIcon size={16} className={RANK_COLORS[i]} /> : <span className="text-gray-400 text-xs">{i + 1}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {s.name.charAt(0)}
                        </div>
                        <span className="font-semibold text-gray-800">{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-lg text-xs">{ROLE_LABEL[s.role] || s.role}</span></td>
                    <td className="px-4 py-3 font-bold text-blue-700">{s.myLeads}</td>
                    <td className="px-4 py-3 font-bold text-emerald-700">{s.myConverted}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-[60px]">
                          <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${s.convRate}%` }} />
                        </div>
                        <span className="text-xs font-bold text-gray-700">{s.convRate}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-bold text-violet-700">{fmtMoney(s.revenue)} ج</td>
                  </tr>
                );
              })}
              {stats.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">لا توجد بيانات للفترة المحددة</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
