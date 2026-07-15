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
} from 'lucide-react';
import type { FinancialSubTab } from './financialTabUtils';

const subTabs: [FinancialSubTab, string, React.ElementType][] = [
  ['cockpit', 'لوحة القيادة', BarChart3],
  ['budget', 'الميزانية', TrendingDown],
  ['refunds', 'الاسترجاعات', XCircle],
  ['overview', 'نظرة مالية', BarChart3],
  ['orders', 'الإيرادات', CreditCard],
  ['expenses', 'المصروفات', Wallet],
  ['pl', 'الأرباح والخسائر', PieChart],
  ['installments', 'الأقساط والمديونيات', CalendarDays],
  ['aging', 'تقرير التقادم', AlertCircle],
  ['outstanding', 'أرصدة مستحقة', TrendingDown],
  ['monthly', 'التقرير الشهري', BarChart3],
  ['commissions', 'عمولات الفريق', Percent],
  ['proofs', 'إيصالات التحويل', Receipt],
  ['audit', 'سجل التدقيق', AlertCircle],
  ['review', 'مراجعة الدفعات', Eye],
  ['period_closing', 'إقفال الفترة', CheckCircle2],
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
    <div className="flex gap-2 flex-wrap">
      {subTabs.map(([key, label, Icon]) => (
        <button
          key={key}
          onClick={() => {
            onChange(key);
            if (key === 'proofs') onOpenProofs();
          }}
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
  );
}
