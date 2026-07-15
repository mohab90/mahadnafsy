import React from 'react';
import type { UnifiedClientTab } from './useUnifiedClientActiveTab';

export type UnifiedClientTabItem = [UnifiedClientTab, string];

interface BuildUnifiedClientTabsInput {
  isSubscriber: boolean;
  communicationsCount: number;
  paymentCount: number;
  courseCount: number;
  certificateCount: number;
  installmentPlanCount: number;
  overdueInstallmentCount: number;
  soonInstallmentCount: number;
  daqqiRoundCount: number;
  consultationCount: number;
}

export function buildUnifiedClientTabs({
  isSubscriber,
  communicationsCount,
  paymentCount,
  courseCount,
  certificateCount,
  installmentPlanCount,
  overdueInstallmentCount,
  soonInstallmentCount,
  daqqiRoundCount,
  consultationCount,
}: BuildUnifiedClientTabsInput): UnifiedClientTabItem[] {
  const installmentAlert =
    overdueInstallmentCount > 0
      ? ` 🔴${overdueInstallmentCount}`
      : soonInstallmentCount > 0
        ? ' 🟡'
        : '';

  return [
    ['overview', 'نظرة عامة 📊'],
    ['communications', `التواصل (${communicationsCount})`],
    ['payments', `حجز / دفع (${paymentCount})`],
    ...(isSubscriber ? [
      ['courses', `الكورسات (${courseCount})`] as UnifiedClientTabItem,
      ['certificates', `الشهادات (${certificateCount})`] as UnifiedClientTabItem,
      ['loyalty', 'الولاء والنقاط'] as UnifiedClientTabItem,
      ['installments', `الأقساط${installmentPlanCount > 0 ? ` (${installmentPlanCount})` : ''}${installmentAlert}`] as UnifiedClientTabItem,
      ...(daqqiRoundCount > 0 ? [['daqqi', `جدول الدقي (${daqqiRoundCount})`] as UnifiedClientTabItem] : []),
    ] : []),
    ...(consultationCount > 0 ? [['consultations', `الاستشارات (${consultationCount})`] as UnifiedClientTabItem] : []),
    ['edit', 'تعديل البيانات ✏️'],
  ];
}

interface UnifiedClientTabsProps {
  activeTab: UnifiedClientTab;
  setActiveTab: (tab: UnifiedClientTab) => void;
  tabs: UnifiedClientTabItem[];
}

export function UnifiedClientTabs({ activeTab, setActiveTab, tabs }: UnifiedClientTabsProps) {
  return (
    <div className="flex items-center gap-0 overflow-x-auto border-b border-gray-100 bg-white rounded-t-2xl px-3">
      {tabs.map(([tab, label]) => (
        <button
          key={tab}
          onClick={() => setActiveTab(tab)}
          className={`px-3 py-3 text-xs font-bold whitespace-nowrap border-b-2 transition-colors ${
            activeTab === tab
              ? 'text-indigo-700 border-indigo-500'
              : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
