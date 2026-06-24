import React, { useMemo, useState, useEffect } from 'react';
import { Target, Edit2, Save, X, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, BarChart3, DollarSign, Layers } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { ExpenseCategory } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const CATEGORIES: ExpenseCategory[] = ['رواتب', 'تسويق', 'إيجار', 'برمجيات', 'معدات', 'أخرى'];

type BudgetMap = Record<string, number>; // category → budgeted amount
const DEFAULT_BUDGETS: BudgetMap = { 'رواتب': 25000, 'تسويق': 5000, 'إيجار': 8000, 'برمجيات': 2000, 'معدات': 1000, 'أخرى': 2000 };

const CAT_COLORS: Record<string, string> = {
  'رواتب': '#6366f1', 'تسويق': '#a855f7', 'إيجار': '#f59e0b',
  'برمجيات': '#14b8a6', 'معدات': '#6b7280', 'أخرى': '#ec4899',
};

const BudgetTrackerTab: React.FC<Props> = ({ notify }) => {
  const { orders, expenses } = useSiteData();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [budgets, setBudgets] = useState<BudgetMap>({});
  const [editMode, setEditMode] = useState(false);
  const [draftBudgets, setDraftBudgets] = useState<BudgetMap>({});

  // Load budgets for the selected month from the server (shared + persistent).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/admin/finance/budgets?month=${selectedMonth}`, { credentials: 'include' });
        if (!r.ok) throw new Error('load failed');
        const data = await r.json() as { category: string; limit: number }[];
        if (cancelled) return;
        const map: BudgetMap = {};
        for (const b of (data || [])) map[b.category] = Number(b.limit) || 0;
        // Show sensible defaults the first time a month has no saved budget yet.
        setBudgets(Object.keys(map).length === 0 ? { ...DEFAULT_BUDGETS } : map);
      } catch { if (!cancelled) setBudgets({ ...DEFAULT_BUDGETS }); }
    })();
    return () => { cancelled = true; };
  }, [selectedMonth]);

  const { actuals, revenue, rows } = useMemo(() => {
    const [year, month] = selectedMonth.split('-').map(Number);
    const start = new Date(year, month - 1, 1).toISOString();
    const end = new Date(year, month, 0, 23, 59, 59).toISOString();

    const monthExpenses = expenses.filter(e => e.date >= start && e.date <= end);
    const monthOrders = orders.filter(o => o.status === 'paid' && (o.paidAt || o.createdAt) >= start && (o.paidAt || o.createdAt) <= end);
    const rev = monthOrders.reduce((s, o) => s + o.amount, 0);

    const actMap: Record<string, number> = {};
    monthExpenses.forEach(e => { actMap[e.category] = (actMap[e.category] || 0) + e.amount; });

    const rows = CATEGORIES.map(cat => {
      const budgeted = budgets[cat] || 0;
      const actual = actMap[cat] || 0;
      const variance = budgeted - actual;
      const pct = budgeted > 0 ? Math.round(actual / budgeted * 100) : actual > 0 ? 999 : 0;
      const status: 'ok' | 'warning' | 'over' = pct > 100 ? 'over' : pct > 80 ? 'warning' : 'ok';
      return { cat, budgeted, actual, variance, pct, status };
    });

    return { actuals: actMap, revenue: rev, rows };
  }, [expenses, orders, selectedMonth, budgets]);

  const totalBudget = rows.reduce((s, r) => s + r.budgeted, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const totalVariance = totalBudget - totalActual;
  const overBudgetCount = rows.filter(r => r.status === 'over').length;
  const budgetUtilization = totalBudget > 0 ? Math.round(totalActual / totalBudget * 100) : 0;

  const saveEdits = async () => {
    try {
      const payload = {
        month: selectedMonth,
        budgets: Object.entries(draftBudgets).map(([category, limit]) => ({ category, limit: Number(limit) || 0 })),
      };
      const r = await fetch('/api/admin/finance/budgets', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error('save failed');
      setBudgets(draftBudgets);
      setEditMode(false);
      notify('success', 'تم حفظ الميزانية');
    } catch { notify('error', 'فشل حفظ الميزانية — تأكد من الاتصال وحاول مرة أخرى'); }
  };

  const startEdit = () => {
    setDraftBudgets({ ...budgets });
    setEditMode(true);
  };

  const format = (n: number) => n.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });

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
                <button onClick={saveEdits} className="flex items-center gap-1.5 bg-green-400 text-white px-3 py-2 rounded-xl text-sm font-bold"><Save size={14} /> حفظ</button>
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
        <div className="divide-y divide-gray-50">
          {rows.map(row => {
            const barColor = row.status === 'over' ? '#ef4444' : row.status === 'warning' ? '#f59e0b' : '#22c55e';
            const catColor = CAT_COLORS[row.cat] || '#6b7280';
            return (
              <div key={row.cat} className={`px-4 py-4 ${row.status === 'over' ? 'bg-red-50/30' : ''}`}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: catColor }} />
                  <span className="font-bold text-gray-800 flex-1">{row.cat}</span>
                  {row.status === 'over' && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><AlertTriangle size={10} /> تجاوز {row.pct - 100}%</span>}
                  {row.status === 'warning' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle size={10} /> {row.pct}% مستخدم</span>}
                  {row.status === 'ok' && row.budgeted > 0 && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={10} /> {row.pct}%</span>}
                </div>
                {/* Progress bar */}
                <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(row.pct, 100)}%`, background: barColor }} />
                </div>
                <div className="flex flex-wrap justify-between items-center text-xs text-gray-500 gap-2">
                  <span>
                    {editMode ? (
                      <span className="flex items-center gap-1">
                        الميزانية:
                        <input type="number" value={draftBudgets[row.cat] ?? row.budgeted}
                          onChange={e => setDraftBudgets(p => ({ ...p, [row.cat]: +e.target.value }))}
                          className="w-24 border border-purple-300 rounded-lg px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400" />
                        ج.م
                      </span>
                    ) : (
                      <span>الميزانية: <strong className="text-gray-700">{format(row.budgeted)} ج.م</strong></span>
                    )}
                  </span>
                  <span>الفعلي: <strong className="text-gray-700">{format(row.actual)} ج.م</strong></span>
                  <span className={row.variance >= 0 ? 'text-green-600 font-bold' : 'text-red-600 font-bold'}>
                    فارق: {row.variance >= 0 ? '+' : ''}{format(row.variance)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
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
            {rows.filter(r => r.status === 'over').map(r => (
              <li key={r.cat} className="text-sm text-red-700">
                ⚠️ فئة <strong>{r.cat}</strong>: تجاوزت الميزانية بـ {format(Math.abs(r.variance))} ج.م ({r.pct - 100}% زيادة)
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default BudgetTrackerTab;
