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
} from 'lucide-react';
import type { FinancialSubTab } from './financialTabUtils';

/**
 * Twenty screens behind ten entries.
 *
 * They were twenty buttons in four labelled rows. Grouping them by what you are
 * doing helped, but it did not change the count: the strip still asked you to
 * pick one of twenty things before you could start, and several of those twenty
 * answer the same question. الأقساط, أرصدة مستحقة and تقرير التقادم are three
 * ways of asking who owes us money. مراجعة الدفعات, إيصالات التحويل and مدفوعات
 * باي موب are three doors onto money arriving and waiting to be checked.
 *
 * So the merges are by question, not by convenience:
 *
 *   المدفوعات الواردة  review · proofs · paymob      — money in, needing a decision
 *   المطابقة والإقفال  reconciliation · period_closing — closing a period
 *   الدفاتر            operations · audit             — the ledger and its trail
 *   لوحة القيادة       cockpit · overview             — two summaries of now
 *   التقارير الدورية   pl · monthly · budget          — a period, read back
 *   المديونيات         installments · outstanding · aging — who owes us
 *   الفريق             commissions · advances         — people, not books
 *
 * Nothing is removed and nothing is renamed: every one of the twenty is still
 * reachable, one level in, under the heading that describes it. The active leaf
 * is still the same FinancialSubTab value it always was, so the twenty render
 * blocks in FinancialTab are untouched by this.
 */
type Leaf = [FinancialSubTab, string, React.ElementType];
type Primary = {
  id: string;
  label: string;
  icon: React.ElementType;
  /** The screens under this heading. One entry means no second row. */
  leaves: Leaf[];
};

const primaries: Primary[] = [
  { id: 'orders', label: 'الإيرادات', icon: CreditCard, leaves: [['orders', 'الإيرادات', CreditCard]] },
  { id: 'expenses', label: 'المصروفات', icon: Wallet, leaves: [['expenses', 'المصروفات', Wallet]] },
  {
    id: 'incoming',
    label: 'المدفوعات الواردة',
    icon: Eye,
    leaves: [
      ['review', 'مراجعة الدفعات', Eye],
      ['proofs', 'إيصالات التحويل', Receipt],
      ['paymob', 'مدفوعات باي موب', CreditCard],
    ],
  },
  { id: 'refunds', label: 'الاسترجاعات', icon: XCircle, leaves: [['refunds', 'الاسترجاعات', XCircle]] },
  {
    id: 'ledger',
    label: 'الدفاتر',
    icon: Landmark,
    leaves: [
      ['operations', 'عمليات الحسابات', Landmark],
      ['audit', 'سجل التدقيق', AlertCircle],
    ],
  },
  {
    id: 'closing',
    label: 'المطابقة والإقفال',
    icon: CheckCircle2,
    leaves: [
      ['reconciliation', 'المطابقة', CheckCircle2],
      ['period_closing', 'إقفال الفترة', CheckCircle2],
    ],
  },
  {
    id: 'cockpit',
    label: 'لوحة القيادة',
    icon: BarChart3,
    leaves: [
      ['cockpit', 'لوحة القيادة', BarChart3],
      ['overview', 'نظرة مالية', BarChart3],
    ],
  },
  {
    id: 'reports',
    label: 'التقارير الدورية',
    icon: PieChart,
    leaves: [
      ['pl', 'الأرباح والخسائر', PieChart],
      ['monthly', 'التقرير الشهري', BarChart3],
      ['budget', 'الميزانية', TrendingDown],
    ],
  },
  {
    id: 'receivables',
    label: 'المديونيات',
    icon: CalendarDays,
    leaves: [
      ['installments', 'الأقساط والمديونيات', CalendarDays],
      ['outstanding', 'أرصدة مستحقة', TrendingDown],
      ['aging', 'تقرير التقادم', AlertCircle],
    ],
  },
  {
    id: 'team',
    label: 'الفريق',
    icon: Percent,
    leaves: [
      ['commissions', 'عمولات الفريق', Percent],
      ['advances', 'سلف الموظفين', HandCoins],
    ],
  },
];

const primaryOf = (tab: FinancialSubTab): Primary =>
  primaries.find(p => p.leaves.some(([key]) => key === tab)) || primaries[0];

interface FinancialSubTabsProps {
  activeTab: FinancialSubTab;
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
}: FinancialSubTabsProps) {
  const active = primaryOf(activeTab);

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {primaries.map(primary => {
          const Icon = primary.icon;
          const isActive = primary.id === active.id;
          const pending = pendingFor(primary);
          return (
            <button
              key={primary.id}
              onClick={() => select(primary.leaves[0][0])}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${isActive ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Icon size={15} />
              {primary.label}
              {pending > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pending}</span>
              )}
            </button>
          );
        })}
      </div>

      {active.leaves.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 border-r-2 border-gray-200 pr-3">
          {active.leaves.map(([key, label, Icon]) => {
            const isActive = key === activeTab;
            const pending = key === 'proofs' ? pendingProofsCount : key === 'review' ? pendingReviewCount : 0;
            return (
              <button
                key={key}
                onClick={() => select(key)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold transition ${isActive ? 'bg-primary-100 text-primary-700' : 'text-gray-500 hover:bg-gray-100'}`}
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
