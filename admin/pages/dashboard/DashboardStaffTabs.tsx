import React, { Suspense } from 'react';

import { TabErrorBoundary } from '../../../shared/ui/TabErrorBoundary';
import type { LeadItem, StaffMember, SubscriberItem } from '../../types';
import { StaffHomeTab } from './lazyTabs';
import type { TabKey } from './navigation';

interface DashboardStaffTabsProps {
  activeTab: TabKey;
  currentStaff: StaffMember | null;
  leads: LeadItem[];
  subscribers: SubscriberItem[];
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
  onNavigate: (tab: TabKey) => void;
}

export const DashboardStaffTabs: React.FC<DashboardStaffTabsProps> = ({
  activeTab,
  currentStaff,
  leads,
  subscribers,
  notify,
  onNavigate,
}) => {
  if (activeTab !== 'staff_home') return null;

  // "مساحتي" is driven entirely by the signed-in user's own staff row. An owner or
  // super-admin who administers the system without being an employee has no row in
  // `staff` — verified on production, where the signed-in admin matched none of the
  // 18 staff records — so currentStaff is null. This used to `return null`, which
  // painted the page chrome and nothing else: no content, no spinner, no message,
  // and no console error to explain it. Say what happened instead of rendering a
  // blank screen.
  if (!currentStaff) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <h3 className="text-lg font-bold text-amber-900">مساحتي غير متاحة لهذا الحساب</h3>
        <p className="mt-2 text-sm leading-relaxed text-amber-800">
          هذه الصفحة بتعرض بيانات الموظف المرتبط بحسابك (مبيعاتك، عمولتك، مهامك)، وحسابك
          الحالي حساب إدارة مش مربوط بسجل موظف — فمفيش بيانات شخصية يتم عرضها هنا.
        </p>
        <p className="mt-3 text-xs text-amber-700">
          لو محتاج تشوف الصفحة دي، اربط حسابك بسجل موظف من صفحة «نظام HR والموظفون».
        </p>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div>}>
      <TabErrorBoundary>
        <StaffHomeTab
          staff={currentStaff}
          leads={leads}
          subscribers={subscribers}
          notify={notify}
          onNavigate={(tab) => onNavigate(tab as TabKey)}
        />
      </TabErrorBoundary>
    </Suspense>
  );
};
