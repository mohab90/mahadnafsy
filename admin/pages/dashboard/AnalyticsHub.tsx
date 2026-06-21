/**
 * AnalyticsHub — consolidates analytics/CX dashboards (KPIs, NPS, revenue sources,
 * expense analytics) under one menu entry with an internal sub-tab bar.
 * Gives previously URL-only tabs a discoverable home.
 */
import React, { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, TrendingUp, PieChart, Wallet, Filter, Users, Layers } from 'lucide-react';
import type { NotifyFn } from '../../types';

const FunnelTab = lazy(() => import('./tabs/FunnelTab'));
const KpiDashboardTab = lazy(() => import('./tabs/KpiDashboardTab'));
const NpsDashboardTab = lazy(() => import('./tabs/NpsDashboardTab'));
const RevenueSourcesTab = lazy(() => import('./tabs/RevenueSourcesTab'));
const ExpenseAnalyticsTab = lazy(() => import('./tabs/ExpenseAnalyticsTab'));
const RetentionTab = lazy(() => import('./tabs/RetentionTab'));
const CohortAnalysisTab = lazy(() => import('./tabs/CohortAnalysisTab'));

const SUBS = [
  { key: 'funnel', label: 'قمع التحويل', icon: Filter, Comp: FunnelTab },
  { key: 'kpi_dashboard', label: 'مؤشرات الأداء (KPIs)', icon: BarChart3, Comp: KpiDashboardTab },
  { key: 'revenue_sources', label: 'مصادر الإيراد', icon: TrendingUp, Comp: RevenueSourcesTab },
  { key: 'expense_analytics', label: 'تحليل المصروفات', icon: Wallet, Comp: ExpenseAnalyticsTab },
  { key: 'retention', label: 'الاحتفاظ بالعملاء', icon: Users, Comp: RetentionTab },
  { key: 'cohort_analysis', label: 'تحليل الأفواج', icon: Layers, Comp: CohortAnalysisTab },
  { key: 'nps_dashboard', label: 'رضا العملاء (NPS)', icon: PieChart, Comp: NpsDashboardTab },
] as const;

export default function AnalyticsHub({ notify, initial }: { notify: NotifyFn; initial?: string }) {
  // Sub-tab is URL-driven (?sub=) so each analytics view is deep-linkable and
  // browser back/forward moves between them.
  const [searchParams, setSearchParams] = useSearchParams();
  const valid = (k?: string | null) => SUBS.some(s => s.key === k);
  const urlSub = searchParams.get('sub');
  const sub = valid(urlSub) ? (urlSub as string) : (valid(initial) ? (initial as string) : 'kpi_dashboard');
  const setSub = (k: string) => { const next = new URLSearchParams(searchParams); next.set('sub', k); setSearchParams(next); };
  const Active = SUBS.find(s => s.key === sub)?.Comp;
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {SUBS.map(s => {
          const Ic = s.icon;
          return (
            <button key={s.key} onClick={() => setSub(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition ${sub === s.key ? 'bg-violet-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              <Ic size={15} /> {s.label}
            </button>
          );
        })}
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" /></div>}>
        {Active && <Active notify={notify} />}
      </Suspense>
    </div>
  );
}
