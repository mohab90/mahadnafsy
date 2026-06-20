import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Edit3, Save, X } from 'lucide-react';

interface BudgetRow {
  id?: string;
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  utilizationPct: number;
  notes: string;
}

const DEFAULT_CATS = ['رواتب', 'تسويق', 'إيجار', 'برمجيات', 'معدات', 'مرافق', 'سفر', 'أخرى'];

const fmtN = (n: number) => Math.round(n).toLocaleString('ar-EG');

function pctColor(pct: number) {
  if (pct >= 100) return { bar: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50 border-red-200' };
  if (pct >= 80)  return { bar: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' };
  return { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' };
}

export default function FinancialBudgetPanel({ notify }: { notify: (msg: string, t?: 'success' | 'error') => void }) {
  const curMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(curMonth);
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/finance/budgets?month=${month}`, { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      const data: BudgetRow[] = await r.json();

      // Merge with default categories (add any missing as 0-budget rows)
      const existing = new Set(data.map(d => d.category));
      const merged: BudgetRow[] = [...data];
      for (const cat of DEFAULT_CATS) {
        if (!existing.has(cat)) {
          merged.push({ category: cat, limit: 0, spent: 0, remaining: 0, utilizationPct: 0, notes: '' });
        }
      }
      setRows(merged.sort((a, b) => b.spent - a.spent));

      // Init drafts from current limits
      const d: Record<string, string> = {};
      for (const r of merged) d[r.category] = r.limit ? String(r.limit) : '';
      setDrafts(d);
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'فشل التحميل', 'error');
    } finally {
      setLoading(false);
    }
  }, [month, notify]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const budgets = Object.entries(drafts).map(([category, val]) => ({
        category,
        limit: parseFloat(val) || 0,
        notes: '',
      })).filter(b => b.limit > 0);

      const r = await fetch('/api/admin/finance/budgets', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, budgets }),
      });
      if (!r.ok) throw new Error(await r.text());
      notify('تم حفظ الميزانية', 'success');
      setEditing(false);
      await load();
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const totalBudget = rows.reduce((s, r) => s + r.limit, 0);
  const totalSpent  = rows.reduce((s, r) => s + r.spent, 0);
  const totalPct    = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  const overBudget  = rows.filter(r => r.utilizationPct >= 100 && r.limit > 0);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">📊 الميزانية والتحكم في المصروفات</h2>
          <p className="text-sm text-gray-500 mt-0.5">حدد ميزانية شهرية لكل فئة مصروف وتابع الاستخدام في الوقت الفعلي</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm" />
          {editing ? (
            <>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                <Save size={14} /> {saving ? 'جاري الحفظ...' : 'حفظ'}
              </button>
              <button onClick={() => setEditing(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300">
                <X size={14} /> إلغاء
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-white rounded-lg text-sm font-bold hover:bg-violet-700">
              <Edit3 size={14} /> تعديل الميزانية
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm text-center">
          <p className="text-xs text-gray-400 mb-1">إجمالي الميزانية</p>
          <p className="text-xl font-extrabold text-gray-800">{fmtN(totalBudget)} <span className="text-xs font-normal">ج.م</span></p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm text-center">
          <p className="text-xs text-gray-400 mb-1">المصروف الفعلي</p>
          <p className={`text-xl font-extrabold ${totalPct >= 100 ? 'text-red-700' : totalPct >= 80 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmtN(totalSpent)} <span className="text-xs font-normal">ج.م</span></p>
        </div>
        <div className={`rounded-xl p-4 shadow-sm text-center border ${totalPct >= 100 ? 'bg-red-50 border-red-200' : totalPct >= 80 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <p className="text-xs text-gray-400 mb-1">نسبة الاستخدام</p>
          <p className={`text-xl font-extrabold ${pctColor(totalPct).text}`}>{totalPct}%</p>
        </div>
      </div>

      {/* Over-budget alerts */}
      {overBudget.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex flex-wrap gap-2 items-center">
          <span className="text-red-700 font-bold text-sm">⚠️ تجاوز الميزانية:</span>
          {overBudget.map(r => (
            <span key={r.category} className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded-full border border-red-300">
              {r.category} ({r.utilizationPct}%)
            </span>
          ))}
        </div>
      )}

      {/* Budget table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs font-semibold text-right border-b border-gray-100">
                <th className="px-4 py-3">الفئة</th>
                <th className="px-4 py-3 text-center">المصروف الفعلي</th>
                <th className="px-4 py-3 text-center">الميزانية</th>
                <th className="px-4 py-3 text-center">المتبقي</th>
                <th className="px-4 py-3 w-40">الاستخدام</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const colors = pctColor(row.utilizationPct);
                const pct = row.limit > 0 ? row.utilizationPct : 0;
                return (
                  <tr key={row.category} className={`border-t border-gray-50 hover:bg-gray-50 ${row.utilizationPct >= 100 && row.limit > 0 ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3 font-medium text-gray-800">{row.category}</td>
                    <td className="px-4 py-3 text-center font-bold text-gray-700">
                      {row.spent > 0 ? fmtN(row.spent) + ' ج.م' : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {editing ? (
                        <input
                          type="number" min={0}
                          value={drafts[row.category] || ''}
                          onChange={e => setDrafts(d => ({ ...d, [row.category]: e.target.value }))}
                          className="w-24 border border-violet-300 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-violet-500"
                          placeholder="0"
                        />
                      ) : (
                        <span className={row.limit > 0 ? 'text-gray-700 font-medium' : 'text-gray-300 text-xs'}>
                          {row.limit > 0 ? fmtN(row.limit) + ' ج.م' : 'غير محددة'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.limit > 0 ? (
                        <span className={`font-bold ${row.remaining > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {row.remaining > 0 ? fmtN(row.remaining) : `-${fmtN(Math.abs(row.remaining))}`} ج.م
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {row.limit > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${colors.bar} rounded-full`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className={`text-xs font-bold w-9 text-left ${colors.text}`}>{pct}%</span>
                          {row.utilizationPct >= 100 && <span className="text-red-500">⚠️</span>}
                          {row.utilizationPct < 80 && row.spent > 0 && <CheckCircle2 size={12} className="text-emerald-500" />}
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">لا ميزانية</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <p className="text-xs text-gray-400 text-center">
          أدخل الميزانية الشهرية لكل فئة بالجنيه المصري · اتركها فارغة لفئات بدون حد
        </p>
      )}
    </div>
  );
}
