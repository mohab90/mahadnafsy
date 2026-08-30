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
 * Twenty sub-tabs in one row, ordered by nothing.
 *
 * Reading them took scanning the whole strip, because الاسترجاعات sat between
 * الميزانية and سلف الموظفين and نظرة مالية came after both — a report, a
 * setup screen and a daily task next to each other with no way to tell which
 * was which. They are the same twenty screens; what is new is that they are
 * grouped by what you are doing when you open one.
 *
 * المال الداخل والخارج — the desk's daily work: money arriving, money leaving,
 * and the receipts to check. الدفاتر — the ledger itself, where an entry is
 * made or a period sealed. التقارير — read, never written. الفريق — commissions
 * and advances, which are about people rather than about the books.
 */
type SubTabGroup = { label: string; items: [FinancialSubTab, string, React.ElementType][] };

const subTabGroups: SubTabGroup[] = [
  {
    label: 'المال الداخل والخارج',
    items: [
      ['orders', 'الإيرادات', CreditCard],
      ['expenses', 'المصروفات', Wallet],
      ['paymob', 'مدفوعات باي موب', CreditCard],
      ['proofs', 'إيصالات التحويل', Receipt],
      ['review', 'مراجعة الدفعات', Eye],
      ['refunds', 'الاسترجاعات', XCircle],
    ],
  },
  {
    label: 'الدفاتر',
    items: [
      ['operations', 'عمليات الحسابات', Landmark],
      ['reconciliation', 'المطابقة', CheckCircle2],
      ['period_closing', 'إقفال الفترة', CheckCircle2],
      ['audit', 'سجل التدقيق', AlertCircle],
    ],
  },
  {
    label: 'التقارير',
    items: [
      ['cockpit', 'لوحة القيادة', BarChart3],
      ['overview', 'نظرة مالية', BarChart3],
      ['pl', 'الأرباح والخسائر', PieChart],
      ['monthly', 'التقرير الشهري', BarChart3],
      ['budget', 'الميزانية', TrendingDown],
      ['installments', 'الأقساط والمديونيات', CalendarDays],
      ['outstanding', 'أرصدة مستحقة', TrendingDown],
      ['aging', 'تقرير التقادم', AlertCircle],
    ],
  },
  {
    label: 'الفريق',
    items: [
      ['commissions', 'عمولات الفريق', Percent],
      ['advances', 'سلف الموظفين', HandCoins],
    ],
  },
];

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
  return (
    <div className="space-y-3">
      {subTabGroups.map(group => (
        <div key={group.label} className="flex flex-wrap items-center gap-2">
          <span className="w-full text-[11px] font-bold uppercase tracking-wide text-gray-400 sm:w-auto sm:min-w-[9.5rem]">
            {group.label}
          </span>
          {group.items.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => {
                onChange(key);
                if (key === 'proofs') onOpenProofs();
              }}
              aria-current={activeTab === key ? 'page' : undefined}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${activeTab === key ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              <Icon size={15} />
              {label}
              {key === 'proofs' && pendingProofsCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pendingProofsCount}</span>
              )}
              {key === 'review' && pendingReviewCount > 0 && (
                <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pendingReviewCount}</span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
