import React from 'react';
import { CalendarDays } from 'lucide-react';
import type { Course, InstallmentEntry, InstallmentPlan, SubscriberItem } from '../../../../types';
import { InstallmentActions } from './InstallmentActions';
import { InstallmentPlansList } from './InstallmentPlansList';
import { InstallmentPlanModal, type InstallmentPlanDraft } from './InstallmentPlanModal';
import { InstallmentPaymentModal, type PayingInstallmentEntry } from './InstallmentPaymentModal';

type NewEntryDraft = { dueDate: string; amount: number; note: string };

interface Props {
  subscribersWithPlans: SubscriberItem[];
  subscribers: SubscriberItem[];
  courses: Course[];
  today: string;
  toEGP: (amount: number, currency: string) => number;
  exportCSV: (filename: string, rows: string[][], headers: string[]) => void;
  isNewPlanOpen: boolean;
  setIsNewPlanOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newPlanSubId: string;
  setNewPlanSubId: React.Dispatch<React.SetStateAction<string>>;
  newPlanDraft: InstallmentPlanDraft;
  setNewPlanDraft: React.Dispatch<React.SetStateAction<InstallmentPlanDraft>>;
  newEntry: NewEntryDraft;
  setNewEntry: React.Dispatch<React.SetStateAction<NewEntryDraft>>;
  payingEntry: PayingInstallmentEntry | null;
  setPayingEntry: React.Dispatch<React.SetStateAction<PayingInstallmentEntry | null>>;
  paymentMethods: string[];
  handleSaveInstallmentPlan: () => void;
  handleConfirmInstallmentPayment: (sub: SubscriberItem, plan: InstallmentPlan, entry: InstallmentEntry) => void;
}

export function FinancialInstallmentsPanel({
  subscribersWithPlans,
  subscribers,
  courses,
  today,
  toEGP,
  exportCSV,
  isNewPlanOpen,
  setIsNewPlanOpen,
  newPlanSubId,
  setNewPlanSubId,
  newPlanDraft,
  setNewPlanDraft,
  newEntry,
  setNewEntry,
  payingEntry,
  setPayingEntry,
  paymentMethods,
  handleSaveInstallmentPlan,
  handleConfirmInstallmentPayment,
}: Props) {
  const allPlanEntries = subscribersWithPlans.flatMap(s =>
    (s.installmentPlans || []).flatMap(plan =>
      plan.entries.map(e => ({ ...e, subId: s.id, planId: plan.id }))
    )
  );
  const overdueEntries = allPlanEntries.filter(e => !e.paidAt && e.dueDate < today);
  const totalOutstanding = allPlanEntries.filter(e => !e.paidAt).reduce((sum, e) => sum + toEGP(e.amount, e.currency), 0);
  const totalOverdue = overdueEntries.reduce((sum, e) => sum + toEGP(e.amount, e.currency), 0);
  return (
  <div className="space-y-4">
    {/* Summary */}
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-xs text-amber-700 font-bold mb-1">إجمالي المديونيات</p>
        <p className="text-xl font-extrabold text-amber-900">{totalOutstanding.toLocaleString('ar-EG')} ج.م</p>
      </div>
      <div className="bg-red-50 border border-red-200 rounded-xl p-4">
        <p className="text-xs text-red-700 font-bold mb-1">متأخر السداد</p>
        <p className="text-xl font-extrabold text-red-900">{totalOverdue.toLocaleString('ar-EG')} ج.م</p>
        <p className="text-xs text-red-500 mt-0.5">{overdueEntries.length} دفعة متأخرة</p>
      </div>
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
        <p className="text-xs text-emerald-700 font-bold mb-1">خطط الأقساط</p>
        <p className="text-xl font-extrabold text-emerald-900">
          {subscribersWithPlans.reduce((s, sub) => s + (sub.installmentPlans?.length || 0), 0)}
        </p>
        <p className="text-xs text-emerald-600 mt-0.5">{subscribersWithPlans.length} عميل</p>
      </div>
    </div>

    <InstallmentActions
      subscribersWithPlans={subscribersWithPlans}
      exportCSV={exportCSV}
      onNewPlan={() => { setIsNewPlanOpen(true); setNewPlanSubId(''); setNewPlanDraft({ courseId: '', courseTitle: '', totalAmount: 0, currency: 'EGP', notes: '', entries: [] }); setNewEntry({ dueDate: '', amount: 0, note: '' }); }}
    />

    {/* Plans list */}
    {subscribersWithPlans.length === 0 ? (
      <div className="bg-gray-50 border border-gray-200 rounded-xl py-12 text-center text-gray-400">
        <CalendarDays size={32} className="mx-auto mb-2 opacity-40" />
        <p>لا توجد خطط أقساط مسجلة بعد</p>
      </div>
    ) : (
      <InstallmentPlansList
        subscribersWithPlans={subscribersWithPlans}
        today={today}
        onPayEntry={setPayingEntry}
      />
    )}

    <InstallmentPlanModal
      open={isNewPlanOpen}
      subscribers={subscribers}
      courses={courses}
      newPlanSubId={newPlanSubId}
      setNewPlanSubId={setNewPlanSubId}
      newPlanDraft={newPlanDraft}
      setNewPlanDraft={setNewPlanDraft}
      newEntry={newEntry}
      setNewEntry={setNewEntry}
      onClose={() => setIsNewPlanOpen(false)}
      onSave={handleSaveInstallmentPlan}
    />

    <InstallmentPaymentModal
      payingEntry={payingEntry}
      setPayingEntry={setPayingEntry}
      subscribers={subscribers}
      paymentMethods={paymentMethods}
      onConfirm={handleConfirmInstallmentPayment}
    />
  </div>
  );
}
