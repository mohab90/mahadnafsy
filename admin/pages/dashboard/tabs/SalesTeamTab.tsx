import React, { useMemo, useState } from 'react';
import { Users, Phone, Mail, Target, Star, Edit2, Save, X, Plus, Trash2, BarChart3, Calendar } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { StaffMember, SalesTarget } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const ROLE_LABEL: Record<string, string> = {
  sales: 'سيلز', collection: 'تحصيل', support: 'خدمة عملاء',
  manager: 'مدير', online_manager: 'مدير أونلاين', sales_collection_manager: 'مدير مبيعات',
  consultant: 'استشاري',
};

const STATUS_COLOR: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-gray-100 text-gray-500',
};

export default function SalesTeamTab({ notify, salesTargets = [], onOpenStaffProfile }: {
  notify: NotifyFn;
  salesTargets?: SalesTarget[];
  onOpenStaffProfile?: (staffId: string) => void;
}) {
  const { staffMembers, leads, orders } = useSiteData();
  const [roleFilter, setRoleFilter] = useState('all');
  const [searchQ, setSearchQ] = useState('');

  const MONTH = new Date().toISOString().slice(0, 7);
  const monthStart = `${MONTH}-01`;

  const filtered = useMemo(() =>
    staffMembers.filter(s =>
      (roleFilter === 'all' || s.role === roleFilter) &&
      (!searchQ || s.name.toLowerCase().includes(searchQ.toLowerCase()) || s.email?.toLowerCase().includes(searchQ.toLowerCase()))
    ),
    [staffMembers, roleFilter, searchQ]
  );

  const stats = useMemo(() => filtered.map(s => {
    const monthLeads = leads.filter(l => l.assignedSalesId === s.id && (l.createdAt || '') >= monthStart);
    const monthConverted = monthLeads.filter(l => l.status === 'converted');
    const monthRevenue = orders.filter(o => o.staffId === s.id && (o.createdAt || '') >= monthStart)
                                .reduce((acc, o) => acc + (Number(o.amount) || 0), 0);
    const target = salesTargets.find(t => t.staffId === s.id);
    const targetPct = target?.monthlyTarget ?? target?.targetEGP ? Math.min(100, Math.round((monthRevenue / (target.monthlyTarget ?? target.targetEGP)) * 100)) : null;
    return { ...s, monthLeads: monthLeads.length, monthConverted: monthConverted.length, monthRevenue, targetPct, target };
  }), [filtered, leads, orders, salesTargets, monthStart]);

  const roles = [...new Set(staffMembers.map(s => s.role))];

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-blue-600 to-indigo-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Users size={22} />فريق المبيعات والتشغيل</h2>
        <p className="text-blue-100 text-sm mt-1">عرض الفريق كاملاً، الأداء الشهري، والأهداف</p>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="🔍 ابحث باسم الموظف..."
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
          <option value="all">كل الأدوار ({staffMembers.length})</option>
          {roles.map(r => (
            <option key={r} value={r}>{ROLE_LABEL[r] || r} ({staffMembers.filter(s => s.role === r).length})</option>
          ))}
        </select>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي الفريق', val: staffMembers.length, color: 'blue' },
          { label: 'النشطون', val: staffMembers.filter(s => s.status === 'active').length, color: 'emerald' },
          { label: 'أدوار مختلفة', val: new Set(staffMembers.map(s => s.role)).size, color: 'violet' },
          { label: 'الموظفون المعروضون', val: stats.length, color: 'amber' },
        ].map(k => (
          <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
            <div className="text-2xl font-extrabold text-gray-900">{k.val}</div>
            <div className="text-xs text-gray-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Staff cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {stats.map(s => (
          <div key={s.id} className="bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md transition space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center font-bold text-blue-700 text-lg flex-shrink-0">
                {s.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-900 text-sm">{s.name}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_COLOR[s.status] || 'bg-gray-100 text-gray-500'}`}>
                    {s.status === 'active' ? 'نشط' : 'غير نشط'}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{ROLE_LABEL[s.role] || s.role}</div>
                {s.email && <div className="text-xs text-gray-400 truncate mt-0.5">{s.email}</div>}
              </div>
              {onOpenStaffProfile && (
                <button onClick={() => onOpenStaffProfile(s.id)} className="text-xs text-blue-600 hover:underline flex-shrink-0">ملف</button>
              )}
            </div>

            {/* This month stats */}
            <div className="grid grid-cols-3 gap-2 text-center bg-gray-50 rounded-xl p-3">
              <div>
                <div className="text-sm font-bold text-blue-700">{s.monthLeads}</div>
                <div className="text-[10px] text-gray-500">ليدات</div>
              </div>
              <div>
                <div className="text-sm font-bold text-emerald-700">{s.monthConverted}</div>
                <div className="text-[10px] text-gray-500">تحويلات</div>
              </div>
              <div>
                <div className="text-sm font-bold text-violet-700">
                  {s.monthRevenue >= 1000 ? `${(s.monthRevenue/1000).toFixed(1)}ك` : s.monthRevenue} ج
                </div>
                <div className="text-[10px] text-gray-500">إيراد</div>
              </div>
            </div>

            {/* Target progress */}
            {s.targetPct !== null && s.target && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-500">هدف الشهر</span>
                  <span className={`font-bold ${s.targetPct >= 100 ? 'text-emerald-600' : s.targetPct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>{s.targetPct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-1.5 rounded-full transition-all ${s.targetPct >= 100 ? 'bg-emerald-400' : s.targetPct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${s.targetPct}%` }} />
                </div>
                <div className="text-[10px] text-gray-400 mt-1">
                  {s.monthRevenue.toLocaleString()} / {((s.target?.monthlyTarget ?? s.target?.targetEGP) || 0).toLocaleString()} ج
                </div>
              </div>
            )}
          </div>
        ))}
        {stats.length === 0 && (
          <div className="col-span-3 bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400">
            لا يوجد موظفون بهذا الفلتر
          </div>
        )}
      </div>
    </div>
  );
}
