/**
 * FinancialReportsHub — consolidates the standalone financial-report tabs
 * (balance sheet, cash flow, forecast, budget, recurring expenses, installments)
 * under one menu entry with an internal sub-tab bar. Children are reused as-is.
 */
import React, { Suspense, lazy, useState } from 'react';
import { BarChart3, TrendingUp, RotateCcw, Target, CreditCard } from 'lucide-react';
import type { NotifyFn } from '../../types';

const BalanceSheetTab = lazy(() => import('./tabs/BalanceSheetTab'));
const CashFlowTab = lazy(() => import('./tabs/CashFlowTab'));
const RevenueForecastTab = lazy(() => import('./tabs/RevenueForecastTab'));
const BudgetTrackerTab = lazy(() => import('./tabs/BudgetTrackerTab'));
const RecurringExpensesTab = lazy(() => import('./tabs/RecurringExpensesTab'));
const InstallmentPlansTab = lazy(() => import('./tabs/InstallmentPlansTab'));

const SUBS = [
  { key: 'balance_sheet', label: 'الميزانية العمومية', icon: BarChart3, Comp: BalanceSheetTab },
  { key: 'cash_flow', label: 'التدفق النقدي', icon: TrendingUp, Comp: CashFlowTab },
  { key: 'revenue_forecast', label: 'توقعات الإيرادات', icon: TrendingUp, Comp: RevenueForecastTab },
  { key: 'budget_tracker', label: 'الميزانية مقابل الفعلي', icon: Target, Comp: BudgetTrackerTab },
  { key: 'recurring_expenses', label: 'المصاريف المتكررة', icon: RotateCcw, Comp: RecurringExpensesTab },
  { key: 'installment_plans', label: 'خطط التقسيط', icon: CreditCard, Comp: InstallmentPlansTab },
] as const;

/** Optional `initial` selects which sub-report opens first (used by direct deep-links). */
export default function FinancialReportsHub({ notify, initial }: { notify: NotifyFn; initial?: string }) {
  const [sub, setSub] = useState<string>(SUBS.some(s => s.key === initial) ? (initial as string) : 'balance_sheet');
  const Active = SUBS.find(s => s.key === sub)?.Comp;
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {SUBS.map(s => {
          const Ic = s.icon;
          return (
            <button key={s.key} onClick={() => setSub(s.key)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition ${sub === s.key ? 'bg-amber-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              <Ic size={15} /> {s.label}
            </button>
          );
        })}
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600" /></div>}>
        {Active && <Active notify={notify} />}
      </Suspense>
    </div>
  );
}
