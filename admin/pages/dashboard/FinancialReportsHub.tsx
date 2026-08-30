import { Suspense, lazy, useState } from 'react';
import { BarChart3, BookOpen, FileText, RotateCcw, Target, TrendingUp } from 'lucide-react';
import type { NotifyFn } from '../../types';

const BalanceSheetTab = lazy(() => import('./tabs/BalanceSheetTab'));
const CashFlowTab = lazy(() => import('./tabs/CashFlowTab'));
const BudgetTrackerTab = lazy(() => import('./tabs/BudgetTrackerTab'));
const RecurringExpensesTab = lazy(() => import('./tabs/RecurringExpensesTab'));
const ChartOfAccountsTab = lazy(() => import('./tabs/ChartOfAccountsTab'));
const JournalEntriesTab = lazy(() => import('./tabs/JournalEntriesTab'));

// Two of these used to sit here as well as somewhere else, so one page had two
// doors and nothing said they were the same page:
//
//   توقعات الإيرادات is CrmForecastWorkspace, which also answers توقعات
//   المبيعات. It forecasts the pipeline, so it belongs under المبيعات.
//   خطط التقسيط is InstallmentPlansTab, also a menu entry under الأونلاين. An
//   instalment plan belongs to a customer, not to a financial report.
//
// What is left is the books, and the statements read off them.
const reports = [
  { key: 'chart_of_accounts', label: 'دليل الحسابات', icon: BookOpen, Component: ChartOfAccountsTab },
  { key: 'journal_entries', label: 'قيود اليومية', icon: FileText, Component: JournalEntriesTab },
  { key: 'balance_sheet', label: 'الميزانية العمومية', icon: BarChart3, Component: BalanceSheetTab },
  { key: 'cash_flow', label: 'التدفق النقدي', icon: TrendingUp, Component: CashFlowTab },
  { key: 'budget_tracker', label: 'الميزانية مقابل الفعلي', icon: Target, Component: BudgetTrackerTab },
  { key: 'recurring_expenses', label: 'المصاريف المتكررة', icon: RotateCcw, Component: RecurringExpensesTab },
] as const;

export default function FinancialReportsHub({ notify, initial }: { notify: NotifyFn; initial?: string }) {
  const [active, setActive] = useState<string>(reports.some((item) => item.key === initial) ? String(initial) : 'chart_of_accounts');
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
