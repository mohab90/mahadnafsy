import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, CheckCircle2,
  CreditCard, Eye, RefreshCw, Target, TrendingDown, TrendingUp, Users, Wallet,
} from 'lucide-react';

interface CockpitData {
  revenue: {
    today: number; week: number; month: number; prevMonth: number;
    monthChangePercent: number | null; forecast: number; dayOfMonth: number; daysInMonth: number;
  };
  expenses: { month: number; byCategory: { category: string; total: number }[] };
  netProfit: { month: number; margin: number };
  trend12: { month: string; revenue: number; txnCount: number }[];
  topCourses: { name: string; revenue: number; cnt: number }[];
  topStaff: { name: string; collected: number; deals: number }[];
  byMethod: { method: string; revenue: number }[];
  budgets: { category: string; limit: number }[];
  crossSection: {
    leadsConverted: number; leadsTotal: number; conversionRate: number;
    payrollCost: number; daqqiRevenue: number;
  };
  alerts: { pendingProofs: number; pendingReviews: number; overdueInstallments: number; openTickets: number; total: number };
  healthScore: number;
  generatedAt: string;
}

const fmt = (n: number) => Math.round(n).toLocaleString('ar-EG-u-nu-latn');
const fmtK = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toString();

function HealthRing({ score }: { score: number }) {
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  const label = score >= 75 ? 'ممتاز' : score >= 50 ? 'جيد' : 'يحتاج تحسين';
  const r = 42, circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={100} height={100} viewBox="0 0 100 100" className="-rotate-90">
        <circle cx={50} cy={50} r={r} fill="none" stroke="#e5e7eb" strokeWidth={10} />
        <circle cx={50} cy={50} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" style={{ transition: 'all 0.8s ease' }} />
      </svg>
      <div className="text-center -mt-16">
        <p className="text-3xl font-black" style={{ color }}>{score}</p>
        <p className="text-xs font-semibold text-gray-500">{label}</p>
      </div>
      <div className="mt-12" />
      <p className="text-xs text-gray-500 font-medium">صحة مالية</p>
    </div>
  );
}

function TrendBar({ months }: { months: { month: string; revenue: number }[] }) {
  if (!months.length) return <p className="text-xs text-gray-400 text-center py-4">لا بيانات</p>;
  const max = Math.max(...months.map(m => m.revenue), 1);
  return (
    <div className="flex items-end gap-1 h-20 w-full">
      {months.map((m, i) => {
        const pct = (m.revenue / max) * 100;
        const isLast = i === months.length - 1;
        return (
          <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 group relative">
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
              {m.month}<br />{fmtK(m.revenue)} ج
            </div>
            <div
              className={`w-full rounded-t-sm transition-all duration-500 ${isLast ? 'bg-violet-500' : 'bg-violet-200 group-hover:bg-violet-400'}`}
              style={{ height: `${Math.max(pct, 2)}%` }}
            />
            <span className="text-[8px] text-gray-400 hidden sm:block">{m.month.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ChangeChip({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${up ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
      {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
      {Math.abs(pct)}%
    </span>
  );
}

export default function FinancialCockpitPanel({
  notify,
  onNavigate,
}: {
  notify: (msg: string, t?: 'success' | 'error') => void;
  onNavigate?: (tab: string) => void;
}) {
  const [data, setData] = useState<CockpitData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/finance/cockpit', { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      setData(await r.json());
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'فشل تحميل لوحة القيادة', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) {
    return <div className="flex items-center justify-center py-24 text-gray-400">جاري تحميل لوحة القيادة المالية...</div>;
  }

  if (!data) return null;

  const { revenue, expenses, netProfit, trend12, topCourses, topStaff, byMethod, crossSection, alerts, healthScore, budgets } = data;

  // Budget utilization lookup
  const budgetMap: Record<string, number> = {};
  for (const b of budgets) budgetMap[b.category] = b.limit;

  const forecastPct = revenue.daysInMonth > 0
    ? Math.round((revenue.dayOfMonth / revenue.daysInMonth) * 100) : 0;

  return (
    <div className="space-y-5" dir="rtl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-black text-gray-900">🎯 لوحة القيادة المالية</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            بيانات حية من قاعدة البيانات · آخر تحديث: {data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString('ar-EG-u-nu-latn') : '—'}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 disabled:opacity-50 transition">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {/* ── Alerts bar ── */}
      {alerts.total > 0 && (
        <div className="flex flex-wrap gap-2">
          {alerts.pendingProofs > 0 && (
            <button onClick={() => onNavigate?.('proofs')}
              className="flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-800 rounded-xl px-3 py-1.5 text-xs font-bold hover:bg-amber-100 transition">
              <AlertCircle size={13} /> {alerts.pendingProofs} إيصال بانتظار المراجعة
            </button>
          )}
          {alerts.pendingReviews > 0 && (
            <button onClick={() => onNavigate?.('review')}
              className="flex items-center gap-1.5 bg-orange-50 border border-orange-300 text-orange-800 rounded-xl px-3 py-1.5 text-xs font-bold hover:bg-orange-100 transition">
              <Eye size={13} /> {alerts.pendingReviews} دفعة بانتظار التأكيد
            </button>
          )}
          {alerts.overdueInstallments > 0 && (
            <button onClick={() => onNavigate?.('installments')}
              className="flex items-center gap-1.5 bg-red-50 border border-red-300 text-red-800 rounded-xl px-3 py-1.5 text-xs font-bold hover:bg-red-100 transition">
              <AlertCircle size={13} /> {alerts.overdueInstallments} قسط متأخر السداد
            </button>
          )}
        </div>
      )}

      {/* ── Main KPI row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Health score */}
        <div className="lg:col-span-1 bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex items-center justify-center">
          <HealthRing score={healthScore} />
        </div>

        {/* KPI cards */}
        {[
          { label: 'إيرادات اليوم', val: revenue.today, sub: null, color: 'emerald', icon: ArrowUpRight },
          { label: 'إيرادات الأسبوع', val: revenue.week, sub: null, color: 'teal', icon: TrendingUp },
          { label: 'إيرادات الشهر', val: revenue.month, sub: revenue.monthChangePercent, color: 'violet', icon: BarChart3 },
          { label: 'صافي الربح', val: netProfit.month, sub: null, color: netProfit.month >= 0 ? 'blue' : 'red', icon: netProfit.month >= 0 ? TrendingUp : TrendingDown },
        ].map(({ label, val, sub, color, icon: Icon }) => (
          <div key={label} className={`bg-${color}-50 border border-${color}-200 rounded-2xl p-4 shadow-sm`}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-gray-500 font-medium">{label}</p>
              <Icon size={16} className={`text-${color}-500`} />
            </div>
            <p className={`text-xl font-extrabold text-${color}-700`}>{fmt(val)} <span className="text-xs font-normal">ج.م</span></p>
            {sub !== null && sub !== undefined && <ChangeChip pct={sub as number} />}
          </div>
        ))}
      </div>

      {/* ── 12-month trend + Forecast ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BarChart3 size={16} className="text-violet-500" />الإيرادات — آخر 12 شهراً</h3>
          <TrendBar months={trend12} />
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Target size={16} className="text-violet-500" />توقع الشهر</h3>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-500">اليوم {revenue.dayOfMonth} من {revenue.daysInMonth}</span>
              <span className="font-bold text-violet-700">{fmt(revenue.forecast)} ج.م</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full" style={{ width: `${forecastPct}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">المُحقق: {fmt(revenue.month)} · التوقع: {fmt(revenue.forecast)}</p>
          </div>
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-red-600">مصروفات الشهر</span>
              <span className="font-bold text-red-700">{fmt(expenses.month)} ج.م</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-blue-600">هامش الربح</span>
              <span className="font-bold text-blue-700">{netProfit.margin}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Top performers + Methods ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Top courses */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 text-sm flex items-center gap-2"><BarChart3 size={14} className="text-emerald-500" />أعلى كورسات (الشهر)</h3>
          <div className="space-y-2">
            {topCourses.length === 0 && <p className="text-xs text-gray-400">لا بيانات</p>}
            {topCourses.map((c, i) => {
              const max = topCourses[0]?.revenue || 1;
              const medals = ['🥇','🥈','🥉'];
              return (
                <div key={c.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-gray-700 truncate max-w-[60%]">{medals[i] || '•'} {c.name}</span>
                    <span className="font-bold text-emerald-700 shrink-0">{fmtK(c.revenue)} ج</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(c.revenue / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top staff */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 text-sm flex items-center gap-2"><Users size={14} className="text-indigo-500" />أعلى موظفين (الشهر)</h3>
          <div className="space-y-2">
            {topStaff.length === 0 && <p className="text-xs text-gray-400">لا بيانات</p>}
            {topStaff.map((s, i) => {
              const max = topStaff[0]?.collected || 1;
              const medals = ['🥇','🥈','🥉'];
              return (
                <div key={s.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-gray-700 truncate max-w-[60%]">{medals[i] || '•'} {s.name}</span>
                    <span className="font-bold text-indigo-700 shrink-0">{fmtK(s.collected)} ج · {s.deals} صفقة</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(s.collected / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment methods */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 text-sm flex items-center gap-2"><Wallet size={14} className="text-amber-500" />الإيرادات بوسيلة الدفع</h3>
          <div className="space-y-2">
            {byMethod.length === 0 && <p className="text-xs text-gray-400">لا بيانات</p>}
            {byMethod.slice(0, 6).map(m => {
              const max = byMethod[0]?.revenue || 1;
              return (
                <div key={m.method}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-gray-700 truncate max-w-[60%]">{m.method}</span>
                    <span className="font-bold text-amber-700 shrink-0">{fmtK(m.revenue)} ج</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${(m.revenue / max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Cross-section integration ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-cyan-500" />
          ربط الأقسام — نظرة مالية شاملة (الشهر الحالي)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* Leads */}
          <button onClick={() => onNavigate?.('leads')}
            className="bg-blue-50 border border-blue-200 hover:border-blue-400 rounded-xl p-3 text-right transition group">
            <p className="text-xs text-blue-500 font-bold mb-1 flex items-center gap-1"><Users size={11} /> المبيعات / Leads</p>
            <p className="text-lg font-extrabold text-blue-800">{crossSection.leadsConverted}</p>
            <p className="text-[10px] text-blue-500">تحول من {crossSection.leadsTotal} · {crossSection.conversionRate}%</p>
          </button>

          {/* Daqqi */}
          <button onClick={() => onNavigate?.('daqqi_accounting')}
            className="bg-amber-50 border border-amber-200 hover:border-amber-400 rounded-xl p-3 text-right transition group">
            <p className="text-xs text-amber-600 font-bold mb-1">🏢 إيرادات الدقي</p>
            <p className="text-lg font-extrabold text-amber-800">{fmt(crossSection.daqqiRevenue)}</p>
            <p className="text-[10px] text-amber-500">ج.م · من مصدر دقي</p>
          </button>

          {/* HR Payroll cost */}
          <button onClick={() => onNavigate?.('hr')}
            className="bg-slate-50 border border-slate-200 hover:border-slate-400 rounded-xl p-3 text-right transition group">
            <p className="text-xs text-slate-600 font-bold mb-1">👥 تكلفة الرواتب</p>
            <p className="text-lg font-extrabold text-slate-800">{fmt(crossSection.payrollCost)}</p>
            <p className="text-[10px] text-slate-500">ج.م · من الـ HR</p>
          </button>

          {/* Expenses breakdown quick nav */}
          <button onClick={() => onNavigate?.('expenses')}
            className="bg-red-50 border border-red-200 hover:border-red-400 rounded-xl p-3 text-right transition group">
            <p className="text-xs text-red-500 font-bold mb-1 flex items-center gap-1"><CreditCard size={11} /> المصروفات</p>
            <p className="text-lg font-extrabold text-red-800">{fmt(expenses.month)}</p>
            <p className="text-[10px] text-red-400">ج.م هذا الشهر ← تفاصيل</p>
          </button>

          {/* Profitability summary */}
          <div className={`rounded-xl p-3 text-right border ${netProfit.month >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-orange-50 border-orange-200'}`}>
            <p className={`text-xs font-bold mb-1 ${netProfit.month >= 0 ? 'text-emerald-600' : 'text-orange-600'}`}>
              {netProfit.month >= 0 ? '📈 صافي الربح' : '📉 صافي الخسارة'}
            </p>
            <p className={`text-lg font-extrabold ${netProfit.month >= 0 ? 'text-emerald-800' : 'text-orange-800'}`}>
              {fmt(Math.abs(netProfit.month))}
            </p>
            <p className={`text-[10px] ${netProfit.month >= 0 ? 'text-emerald-500' : 'text-orange-500'}`}>
              هامش {netProfit.margin}%
            </p>
          </div>
        </div>
      </div>

      {/* ── Expense breakdown vs budget ── */}
      {expenses.byCategory.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <TrendingDown size={16} className="text-red-500" />
            المصروفات حسب الفئة {Object.keys(budgetMap).length > 0 && '← مقارنة بالميزانية'}
          </h3>
          <div className="space-y-3">
            {expenses.byCategory.map(c => {
              const budget = budgetMap[c.category];
              const hasBudget = budget && budget > 0;
              const utilPct = hasBudget ? Math.round((c.total / budget) * 100) : null;
              const barColor = utilPct === null ? 'bg-red-300'
                : utilPct >= 100 ? 'bg-red-500'
                : utilPct >= 80 ? 'bg-amber-500'
                : 'bg-emerald-500';
              const barPct = hasBudget ? Math.min(100, utilPct!) : 100;
              return (
                <div key={c.category}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{c.category}</span>
                    <span className="text-gray-500">
                      {fmt(c.total)} ج.م
                      {hasBudget && <span className="text-xs text-gray-400 mr-1">/ {fmt(budget)} {utilPct! >= 100 && <span className="text-red-600 font-bold">⚠️ تجاوز</span>}</span>}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full transition-all duration-500`} style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          {Object.keys(budgetMap).length === 0 && (
            <p className="text-xs text-gray-400 text-center mt-3">
              لم تُحدَّد ميزانيات بعد ·{' '}
              <button onClick={() => onNavigate?.('budget')} className="text-violet-600 underline">إعداد الميزانية</button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
