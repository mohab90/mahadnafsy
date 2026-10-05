import React from 'react';
import {
  AlertCircle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  Eye,
  Percent,
  PieChart,
  Receipt,
  TrendingDown,
  Wallet,
  XCircle,
  HandCoins,
  Landmark,
  Vault,
  FileBarChart,
} from 'lucide-react';
import type { FinancialSubTab } from './financialTabUtils';

/**
 * Twenty-two screens behind six headings, by the job being done.
 *
 * It was eleven buttons on one wrapping row — الخزائن، الإيرادات، المصروفات،
 * المدفوعات الواردة، الاسترجاعات، الدفاتر، المطابقة والإقفال، لوحة القيادة،
 * التقارير الدورية، المديونيات، الفريق — so the strip itself was the first
 * thing to read («التابات فوق مش كويسة»). Six questions now:
 *
 *   الملخص            cockpit · overview                            how are we doing now
 *   الفلوس الداخلة     orders · review · proofs · paymob             money in, and what waits on a decision
 *   الفلوس الخارجة     expenses · refunds · commissions · advances    money out, to suppliers, clients and the team
 *   المديونيات         installments · outstanding · aging            who owes us
 *   الخزائن والدفاتر    boxes · operations · reconciliation · closing · audit   the books themselves
 *   التقارير           statement · pl · monthly · budget             a period, read back
 *
 * Nothing is removed: every screen is still its own FinancialSubTab, one level
 * in, and /dashboard/financial/<screen> opens it directly.
 */
type Leaf = [FinancialSubTab, string, React.ElementType];
type Primary = {
  id: string;
  label: string;
  icon: React.ElementType;
  /** The screens under this heading. One entry means no second row. */
  leaves: Leaf[];
};

const allPrimaries: Primary[] = [
  {
    id: 'summary',
    label: 'الملخص',
    icon: BarChart3,
    leaves: [
      ['cockpit', 'لوحة القيادة', BarChart3],
      ['overview', 'نظرة مالية', PieChart],
    ],
  },
  {
    id: 'in',
    label: 'الفلوس الداخلة',
    icon: CreditCard,
    leaves: [
      ['orders', 'الإيرادات', CreditCard],
      ['review', 'مراجعة الدفعات', Eye],
      ['proofs', 'إيصالات التحويل', Receipt],
      ['paymob', 'مدفوعات باي موب', CreditCard],
    ],
  },
  {
    id: 'out',
    label: 'الفلوس الخارجة',
    icon: Wallet,
    leaves: [
      ['expenses', 'المصروفات', Wallet],
      ['refunds', 'الاسترجاعات', XCircle],
      ['commissions', 'عمولات ومكافآت الفريق', Percent],
      ['advances', 'سلف الموظفين', HandCoins],
    ],
  },
  {
    id: 'receivables',
    label: 'المديونيات',
    icon: CalendarDays,
    leaves: [
      ['installments', 'الأقساط', CalendarDays],
      ['outstanding', 'أرصدة مستحقة', TrendingDown],
      ['aging', 'تقرير التقادم', AlertCircle],
    ],
  },
  {
    id: 'books',
    label: 'الخزائن والدفاتر',
    icon: Landmark,
    leaves: [
      ['boxes', 'الخزائن', Vault],
      ['operations', 'عمليات الحسابات', Landmark],
      ['reconciliation', 'المطابقة', CheckCircle2],
      ['period_closing', 'إقفال الفترة', CheckCircle2],
      ['audit', 'سجل التدقيق', AlertCircle],
    ],
  },
  {
    id: 'reports',
    label: 'التقارير',
    icon: FileBarChart,
    leaves: [
      ['statement', 'التقرير المالي', FileBarChart],
      ['pl', 'الأرباح والخسائر', PieChart],
      ['monthly', 'التقرير الشهري', BarChart3],
      ['budget', 'الميزانية', TrendingDown],
    ],
  },
];

/** Every screen, in menu order — for checking a screen named in the URL. */
export const FINANCIAL_SCREENS: FinancialSubTab[] = allPrimaries.flatMap(primary => primary.leaves.map(([key]) => key));

interface FinancialSubTabsProps {
  activeTab: FinancialSubTab;
  /** The screens this view offers; every one when absent. */
  allowed?: FinancialSubTab[];
  pendingProofsCount: number;
  pendingReviewCount: number;
  onChange: (tab: FinancialSubTab) => void;
  onOpenProofs: () => void;
}

export function FinancialSubTabs({
  activeTab,
  pendingProofsCount,
  pendingReviewCount,
  onChange,
  onOpenProofs,
  allowed,
}: FinancialSubTabsProps) {
  const primaries = allowed
    ? allPrimaries
      .map(primary => ({ ...primary, leaves: primary.leaves.filter(([key]) => allowed.includes(key)) }))
      .filter(primary => primary.leaves.length > 0)
    : allPrimaries;
  const active = primaries.find(p => p.leaves.some(([key]) => key === activeTab)) || primaries[0];

  const select = (tab: FinancialSubTab) => {
    onChange(tab);
    if (tab === 'proofs') onOpenProofs();
  };

  // Work waiting on someone is counted on the heading as well as the leaf.
  // Both badges live under المدفوعات الواردة now, and a queue that only shows
  // itself once you have already opened the right screen is a queue nobody
  // discovers.
  const pendingFor = (primary: Primary) => primary.leaves.reduce((sum, [key]) => (
    sum + (key === 'proofs' ? pendingProofsCount : key === 'review' ? pendingReviewCount : 0)
  ), 0);

  return (
    <div className="min-w-0 flex-1 space-y-3">
      <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-gray-200" aria-label="أقسام الحسابات">
        {primaries.map(primary => {
          const Icon = primary.icon;
          const isActive = primary.id === active.id;
          const pending = pendingFor(primary);
          return (
            <button
              key={primary.id}
              onClick={() => select(primary.leaves[0][0])}
              aria-current={isActive ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-bold transition ${isActive ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800'}`}
            >
              <Icon size={15} />
              {primary.label}
              {pending > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pending}</span>
              )}
            </button>
          );
        })}
      </nav>

      {active.leaves.length > 1 && (
        <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-gray-100 p-1">
          {active.leaves.map(([key, label, Icon]) => {
            const isActive = key === activeTab;
            const pending = key === 'proofs' ? pendingProofsCount : key === 'review' ? pendingReviewCount : 0;
            return (
              <button
                key={key}
                onClick={() => select(key)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-bold transition ${isActive ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
              >
                <Icon size={13} />
                {label}
                {pending > 0 && (
                  <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pending}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
