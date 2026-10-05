import { Suspense, lazy } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
  // The report is in the address — /dashboard/financial_reports/<report> — so a
  // refresh or a shared link opens the same statement.
  const navigate = useNavigate();
  const { param } = useParams<{ param?: string }>();
  const wanted = param || initial;
  const active = reports.some((item) => item.key === wanted) ? String(wanted) : 'chart_of_accounts';
  const Current = reports.find((item) => item.key === active)?.Component;

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">التقارير المحاسبية</h2>
        <p className="text-xs text-gray-500">الدفاتر والقوائم المقروءة منها. تقرير الفترة (المحصّل والمصروف والنتيجة) في الحسابات ← التقارير ← التقرير المالي.</p>
      </div>
      <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-gray-200" aria-label="التقارير المحاسبية">
        {reports.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(`/dashboard/financial_reports/${item.key}`)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-bold transition ${
                isActive ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'
              }`}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary-600" /></div>}>
        {Current ? <Current notify={notify} /> : null}
      </Suspense>
    </div>
  );
}
