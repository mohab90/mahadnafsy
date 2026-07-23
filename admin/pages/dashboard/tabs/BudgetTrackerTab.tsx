import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Target, Edit2, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const CATEGORIES = ['رواتب', 'تسويق', 'إيجار', 'برمجيات', 'معدات', 'أخرى'];

interface BudgetRow {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  utilizationPct: number;
  notes: string;
}

const CAT_COLORS: Record<string, string> = {
  'رواتب': '#6366f1', 'تسويق': '#a855f7', 'إيجار': '#f59e0b',
  'برمجيات': '#14b8a6', 'معدات': '#6b7280', 'أخرى': '#ec4899',
};

// CFG-04: budgeted targets used to live in localStorage (per-browser, per-device —
// two admins on different machines saw two different "budgets"), while a
// completely real, tenant-shared backend for the exact same feature already
// existed (routes/finance.js's GET/PUT /api/admin/finance/budgets, also consumed
// by FinancialBudgetPanel.tsx elsewhere in the dashboard). Rewired onto that
// backend instead of building a second one.
const BudgetTrackerTab: React.FC<Props> = ({ notify }) => {
  const { orders } = useSiteData();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<BudgetRow[]>(`/admin/finance/budgets?month=${selectedMonth}`);
      const byCategory = new Map((Array.isArray(data) ? data : []).map(r => [r.category, r]));
      const merged: BudgetRow[] = CATEGORIES.map(cat => byCategory.get(cat) || {
        category: cat, limit: 0, spent: 0, remaining: 0, utilizationPct: 0, notes: '',
      });
      setRows(merged);
    } catch { notify('error', 'فشل تحميل الميزانية'); }
    finally { setLoading(false); }
  }, [selectedMonth, notify]);

  useEffect(() => { load(); }, [load]);

  const { revenue } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const start = new Date(year, month - 1, 1).toISOString();
    const end = new Date(year, month, 0, 23, 59, 59).toISOString();
    const monthOrders = orders.filter(o => o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) <= end);
    return { revenue: monthOrders.reduce((s, o) => s + o.amount, 0) };
  }, [orders, selectedMonth]);

  const totalBudget = rows.reduce((s, r) => s + r.limit, 0);
  const totalActual = rows.reduce((s, r) => s + r.spent, 0);
  const totalVariance = totalBudget - totalActual;
  const overBudgetCount = rows.filter(r => r.limit > 0 && r.utilizationPct >= 100).length;
  const budgetUtilization = totalBudget > 0 ? Math.round(totalActual / totalBudget * 100) : 0;

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const r of rows) d[r.category] = r.limit ? String(r.limit) : '';
    setDrafts(d);
    setEditMode(true);
  };

  const saveEdits = async () => {
    setSaving(true);
    try {
      const budgets = CATEGORIES.map(category => ({ category, limit: parseFloat(drafts[category]) || 0 }));
      await mysqlAdmin.adminPut('/admin/finance/budgets', { month: selectedMonth, budgets });
      notify('success', 'تم حفظ الميزانية');
      setEditMode(false);
      await load();
    } catch { notify('error', 'فشل حفظ الميزانية'); }
    finally { setSaving(false); }
  };

  const format = (n: number) => n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { key, label: `${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}` };
  });

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-violet-700 to-purple-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Target size={22} /> متابعة الميزانية</h2>
            <p className="text-purple-200 text-sm mt-0.5">الميزانية المخططة مقابل الإنفاق الفعلي</p>
          </div>
          <div className="flex gap-2">
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
              className="bg-white/15 border border-white/30 rounded-xl px-3 py-2 text-sm text-white focus:outline-none">
              {monthOptions.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            {editMode ? (
              <>
                <button onClick={saveEdits} disabled={saving} className="flex items-center gap-1.5 bg-green-400 text-white px-3 py-2 rounded-xl text-sm font-bold disabled:opacity-60"><Save size={14} /> حفظ</button>
                <button onClick={() => setEditMode(false)} className="bg-white/20 text-white px-3 py-2 rounded-xl text-sm"><X size={14} /></button>
              </>
            ) : (
              <button onClick={startEdit} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white px-3 py-2 rounded-xl text-sm"><Edit2 size={14} /> تعديل الميزانية</button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'إجمالي الميزانية', value: `${format(totalBudget)} ج.م`, bg: 'bg-white/15' },
            { label: 'إجمالي الإنفاق', value: `${format(totalActual)} ج.م`, bg: 'bg-white/15' },
            { label: 'الفارق', value: `${totalVariance >= 0 ? '+' : ''}${format(totalVariance)} ج.م`, bg: totalVariance >= 0 ? 'bg-green-500/25' : 'bg-red-500/25' },
            { label: 'تجاوزت الميزانية', value: `${overBudgetCount} فئة`, bg: overBudgetCount > 0 ? 'bg-red-500/30' : 'bg-green-500/25' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
              <div className="text-lg font-black leading-tight">{s.value}</div>
              <div className="text-xs text-purple-200 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        {/* Overall progress */}
        <div className="mt-3">
          <div className="flex justify-between text-xs text-purple-200 mb-1">
            <span>الاستخدام الإجمالي للميزانية</span>
            <span>{budgetUtilization}%</span>
          </div>
          <div className="h-2.5 bg-white/20 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${budgetUtilization > 100 ? 'bg-red-400' : budgetUtilization > 80 ? 'bg-yellow-300' : 'bg-green-400'}`}
              style={{ width: `${Math.min(budgetUtilization, 100)}%` }} />
          </div>
        </div>
      </div>

      {/* Revenue vs expenses */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'إيرادات الشهر', value: revenue, color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: '📈' },
          { label: 'مصروفات الشهر', value: totalActual, color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: '📉' },
          { label: 'صافي الشهر', value: revenue - totalActual, color: (revenue - totalActual) >= 0 ? 'text-green-700' : 'text-red-700', bg: 'bg-white border-gray-200', icon: '💰' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl border p-4 shadow-sm ${s.bg}`}>
            <p className="text-sm text-gray-500">{s.icon} {s.label}</p>
            <p className={`text-2xl font-black mt-1 ${s.color}`}>{format(Math.abs(s.value))} ج.م</p>
          </div>
        ))}
      </div>

      {/* Budget rows */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
          <h3 className="font-bold text-gray-800">الميزانية حسب الفئة</h3>
          {editMode && <span className="text-xs text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">وضع التعديل</span>}
        </div>
        {loading ? (
          <div className="text-center py-10 text-gray-400 text-sm">جاري التحميل...</div>
        ) : (
        <div className="divide-y divide-gray-50">
          {rows.map(row => {
            const variance = row.limit - row.spent;
            const pct = row.utilizationPct;
            const status: 'ok' | 'warning' | 'over' = pct > 100 ? 'over' : pct > 80 ? 'warning' : 'ok';
            const barColor = status === 'over' ? '#ef4444' : status === 'warning' ? '#f59e0b' : '#22c55e';
            const catColor = CAT_COLORS[row.category] || '#6b7280';
            return (
              <div key={row.category} className={`px-4 py-4 ${status === 'over' ? 'bg-red-50/30' : ''}`}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: catColor }} />
                  <span className="font-bold text-gray-800 flex-1">{row.category}</span>
                  {status === 'over' && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><AlertTriangle size={10} /> تجاوز {pct - 100}%</span>}
                  {status === 'warning' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle size={10} /> {pct}% مستخدم</span>}
                  {status === 'ok' && row.limit > 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={10} /> {pct}%</span>}
                </div>
                {/* Progress bar */}
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
                </div>
                <div className="flex flex-wrap justify-between items-center text-xs text-gray-500 gap-2">
                  <span>
                    {editMode ? (
                      <span className="flex items-center gap-1">
                        الميزانية:
                        <input type="number" value={drafts[row.category] ?? ''}
                          onChange={e => setDrafts(p => ({ ...p, [row.category]: e.target.value }))}
                          className="w-24 border border-purple-300 rounded-lg px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400" />
                        ج.م
                      </span>
                    ) : (
                      <span>الميزانية: <strong className="text-gray-700">{format(row.limit)} ج.م</strong></span>
                    )}
                  </span>
                  <span>الفعلي: <strong className="text-gray-700">{format(row.spent)} ج.م</strong></span>
                  <span className={variance >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                    فارق: {variance >= 0 ? '+' : ''}{format(variance)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        )}
        {/* Total row */}
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex flex-wrap justify-between items-center gap-3">
          <span className="font-bold text-gray-800">الإجمالي</span>
          <span className="text-sm">ميزانية: <strong>{format(totalBudget)}</strong></span>
          <span className="text-sm">فعلي: <strong>{format(totalActual)}</strong></span>
          <span className={`font-black text-sm ${totalVariance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            فارق: {totalVariance >= 0 ? '+' : ''}{format(totalVariance)} ج.م
          </span>
        </div>
      </div>

      {/* Tips */}
      {overBudgetCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <h3 className="font-bold text-red-800 mb-2 flex items-center gap-2"><AlertTriangle size={16} /> تنبيهات الميزانية</h3>
          <ul className="space-y-1">
            {rows.filter(r => r.limit > 0 && r.utilizationPct >= 100).map(r => (
              <li key={r.category} className="text-sm text-red-700">
                ⚠️ فئة <strong>{r.category}</strong>: تجاوزت الميزانية بـ {format(Math.abs(r.limit - r.spent))} ج.م ({r.utilizationPct - 100}% زيادة)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default BudgetTrackerTab;
