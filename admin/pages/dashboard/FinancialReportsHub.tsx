import React, { Suspense, lazy, useState } from 'react';
import { BarChart3, BookOpen, CreditCard, FileText, RotateCcw, Target, TrendingUp } from 'lucide-react';
import type { NotifyFn } from '../../types';

const BalanceSheetTab = lazy(() => import('./tabs/BalanceSheetTab'));
const CashFlowTab = lazy(() => import('./tabs/CashFlowTab'));
const RevenueForecastTab = lazy(() => import('./tabs/RevenueForecastTab'));
const BudgetTrackerTab = lazy(() => import('./tabs/BudgetTrackerTab'));
const RecurringExpensesTab = lazy(() => import('./tabs/RecurringExpensesTab'));
const InstallmentPlansTab = lazy(() => import('./tabs/InstallmentPlansTab'));
const ChartOfAccountsTab = lazy(() => import('./tabs/ChartOfAccountsTab'));
const JournalEntriesTab = lazy(() => import('./tabs/JournalEntriesTab'));

const reports = [
  { key: 'balance_sheet', label: 'الميزانية العمومية', icon: BarChart3, Component: BalanceSheetTab },
  { key: 'cash_flow', label: 'التدفق النقدي', icon: TrendingUp, Component: CashFlowTab },
  { key: 'chart_of_accounts', label: 'دليل الحسابات', icon: BookOpen, Component: ChartOfAccountsTab },
  { key: 'journal_entries', label: 'قيود اليومية', icon: FileText, Component: JournalEntriesTab },
  { key: 'revenue_forecast', label: 'توقعات الإيرادات', icon: TrendingUp, Component: RevenueForecastTab },
  { key: 'budget_tracker', label: 'الميزانية مقابل الفعلي', icon: Target, Component: BudgetTrackerTab },
  { key: 'recurring_expenses', label: 'المصاريف المتكررة', icon: RotateCcw, Component: RecurringExpensesTab },
  { key: 'installment_plans', label: 'خطط التقسيط', icon: CreditCard, Component: InstallmentPlansTab },
] as const;

export default function FinancialReportsHub({ notify, initial }: { notify: NotifyFn; initial?: string }) {
  const [active, setActive] = useState<string>(reports.some((item) => item.key === initial) ? String(initial) : 'balance_sheet');
  const Current = reports.find((item) => item.key === active)?.Component;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-3">
        {reports.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setActive(item.key)}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${
                active === item.key ? 'bg-amber-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </div>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-amber-600" /></div>}>
        {Current ? <Current notify={notify} /> : null}
      </Suspense>
    </div>
  );
}
