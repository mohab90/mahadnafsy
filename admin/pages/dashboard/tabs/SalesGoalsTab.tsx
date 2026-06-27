import React, { useMemo, useState } from 'react';
import { Target, Trophy, Edit2, Save, X, Plus, TrendingUp, Users, CheckCircle, AlertCircle } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Goal {
  staffId: string;
  monthlyTarget: number;
  monthlyLeadsTarget: number;
}

const MONTH_LABEL = new Date().toLocaleDateString('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' });

export default function SalesGoalsTab({ notify }: { notify: NotifyFn }) {
  const { staffMembers, leads, orders, updateStaffMember } = useSiteData();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ monthlyTarget: string; monthlyLeadsTarget: string }>({ monthlyTarget: '', monthlyLeadsTarget: '' });

  const MONTH = new Date().toISOString().slice(0, 7);
  const monthStart = `${MONTH}-01`;

  const salesStaff = useMemo(() => staffMembers.filter(s => s.status === 'active'), [staffMembers]);

  // Goals are persisted on the staff record (monthly_target / monthly_leads_target),
  // so they survive refresh and feed HR/commission rather than living in local state.
  const goals = useMemo<Record<string, Goal>>(() => {
    const m: Record<string, Goal> = {};
    for (const s of staffMembers) {
      if (s.monthlyTarget || s.monthlyLeadsTarget) {
        m[s.id] = { staffId: s.id, monthlyTarget: Number(s.monthlyTarget) || 0, monthlyLeadsTarget: Number(s.monthlyLeadsTarget) || 0 };
      }
    }
    return m;
  }, [staffMembers]);

  const stats = useMemo(() => salesStaff.map(s => {
    const g = goals[s.id];
    const myLeads = leads.filter(l => l.assignedSalesId === s.id && (l.createdAt || '') >= monthStart);
    const myConverted = myLeads.filter(l => l.status === 'converted');
    const myRevenue = orders.filter(o => o.staffId === s.id && (o.createdAt || '') >= monthStart && o.status === 'paid')
                           .reduce((acc, o) => acc + (Number(o.amount) || 0), 0);
    const revPct = g?.monthlyTarget ? Math.min(100, Math.round((myRevenue / g.monthlyTarget) * 100)) : null;
    const leadsPct = g?.monthlyLeadsTarget ? Math.min(100, Math.round((myLeads.length / g.monthlyLeadsTarget) * 100)) : null;
    return { ...s, myLeads: myLeads.length, myConverted: myConverted.length, myRevenue, goal: g, revPct, leadsPct };
  }).sort((a, b) => (b.revPct || 0) - (a.revPct || 0)), [salesStaff, goals, leads, orders, monthStart]);

  const totals = useMemo(() => ({
    revenue: stats.reduce((a, s) => a + s.myRevenue, 0),
    leads: stats.reduce((a, s) => a + s.myLeads, 0),
    converted: stats.reduce((a, s) => a + s.myConverted, 0),
    targetRevenue: Object.values(goals).reduce((a, g) => a + (g.monthlyTarget || 0), 0),
    achieved: stats.filter(s => s.revPct !== null && s.revPct >= 100).length,
  }), [stats, goals]);

  function startEdit(s: typeof stats[0]) {
    setEditingId(s.id);
    setEditValues({
      monthlyTarget: String(s.goal?.monthlyTarget || ''),
      monthlyLeadsTarget: String(s.goal?.monthlyLeadsTarget || ''),
    });
  }

  function saveEdit(staffId: string) {
    const staff = staffMembers.find(s => s.id === staffId);
    if (!staff) return;
    // Persist onto the staff record via the existing staff round-trip.
    updateStaffMember({
      ...staff,
      monthlyTarget: Number(editValues.monthlyTarget) || 0,
      monthlyTargetType: 'egp',
      monthlyLeadsTarget: Number(editValues.monthlyLeadsTarget) || 0,
    });
    setEditingId(null);
    notify('success', 'تم حفظ الهدف');
  }

  const fmtMoney = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}ك` : String(n);

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-amber-500 to-orange-500 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><Target size={22} />أهداف المبيعات — {MONTH_LABEL}</h2>
        <p className="text-amber-100 text-sm mt-1">تحديد وتتبع أهداف الإيراد والليدات لكل موظف</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي الإيراد الشهري', val: `${fmtMoney(totals.revenue)} ج`, color: 'emerald' },
          { label: 'الهدف الكلي', val: totals.targetRevenue > 0 ? `${fmtMoney(totals.targetRevenue)} ج` : '—', color: 'amber' },
          { label: 'حققوا الهدف', val: `${totals.achieved} موظف`, color: 'violet' },
          { label: 'إجمالي الليدات', val: totals.leads, color: 'blue' },
        ].map(k => (
          <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
            <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
            <div className="text-xs text-gray-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Goals table */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-800">🎯 أهداف الفريق</h3>
          <span className="text-xs text-gray-400">انقر تعديل لضبط الهدف لكل موظف</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الموظف</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">هدف الإيراد</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الإيراد الفعلي</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">التقدم</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الليدات</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">التحويلات</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-500">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {s.name.charAt(0)}
                      </div>
                      <span className="font-semibold text-gray-800">{s.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {editingId === s.id ? (
                      <input type="number" value={editValues.monthlyTarget} onChange={e => setEditValues(v => ({ ...v, monthlyTarget: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2 py-1 w-24 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" placeholder="0 ج" />
                    ) : (
                      <span className="text-amber-700 font-bold">{s.goal?.monthlyTarget ? `${fmtMoney(s.goal.monthlyTarget)} ج` : '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-emerald-700">{fmtMoney(s.myRevenue)} ج</td>
                  <td className="px-4 py-3">
                    {s.revPct !== null ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-100 rounded-full h-2 min-w-[60px]">
                          <div className={`h-2 rounded-full ${s.revPct >= 100 ? 'bg-emerald-400' : s.revPct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                            style={{ width: `${s.revPct}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${s.revPct >= 100 ? 'text-emerald-600' : s.revPct >= 70 ? 'text-amber-600' : 'text-red-500'}`}>{s.revPct}%</span>
                        {s.revPct >= 100 && <Trophy size={14} className="text-yellow-500" />}
                      </div>
                    ) : <span className="text-gray-400 text-xs">لا يوجد هدف</span>}
                  </td>
                  <td className="px-4 py-3">
                    {editingId === s.id ? (
                      <input type="number" value={editValues.monthlyLeadsTarget} onChange={e => setEditValues(v => ({ ...v, monthlyLeadsTarget: e.target.value }))}
                        className="border border-gray-300 rounded-lg px-2 py-1 w-20 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" placeholder="0" />
                    ) : (
                      <span className="text-blue-700 font-bold">{s.myLeads}{s.goal?.monthlyLeadsTarget ? ` / ${s.goal.monthlyLeadsTarget}` : ''}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-bold text-violet-700">{s.myConverted}</td>
                  <td className="px-4 py-3 text-center">
                    {editingId === s.id ? (
                      <div className="flex items-center gap-1 justify-center">
                        <button onClick={() => saveEdit(s.id)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition"><Save size={14} /></button>
                        <button onClick={() => setEditingId(null)} className="p-1.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition"><X size={14} /></button>
                      </div>
                    ) : (
                      <button onClick={() => startEdit(s)} className="px-2 py-1 text-xs bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 transition flex items-center gap-1 mx-auto">
                        <Edit2 size={12} />تعديل
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-800 text-sm">
        <strong>ملاحظة:</strong> يُحفظ الهدف على سجل الموظف ويبقى بعد إعادة التحميل. يتطلب الحفظ صلاحية مدير/أدمن.
      </div>
    </div>
  );
}
