import { useState } from 'react';
import { useSiteData } from '../../context/SiteDataContext';
import type { SubscriberItem, InstallmentPlan, InstallmentEntry } from '../../types';

type InstBookingInfo = { expectedEGP: number; paidEGP: number; remainingEGP: number; currency: 'EGP' | 'SAR' | 'USD'; title: string };

/**
 * Installment-plan management for a subscriber: build a plan (count- or
 * amount-driven schedule, bundle-aware), record a paid entry, delete a plan or
 * a single entry. Extracted verbatim from UnifiedClientPage; returns identical
 * names so the render JSX is unchanged.
 *
 * `getInstBookingInfo` stays in the component (it derives from confirmedHistory/
 * bookingMap and is also passed to a child) and is injected here.
 */
export function useInstallmentPlans(
  subscriber: SubscriberItem | undefined,
  getInstBookingInfo: (courseIdOrBundle: string) => InstBookingInfo,
) {
  const { updateSubscriber, bundles, courses } = useSiteData();

  const [showInstPlanForm, setShowInstPlanForm] = useState(false);
  const [instPlanDraft, setInstPlanDraft] = useState({
    courseId: '',                       // courseId or 'bundle:bundleId'
    currency: 'EGP' as 'EGP' | 'SAR' | 'USD',
    amountPerInst: '',                  // قيمة القسط (user fills)
    numInstallments: '3',              // auto or user override
    inputMode: 'count' as 'count' | 'amount', // which field is primary
    startDate: new Date().toISOString().slice(0, 10),
    intervalDays: '30', notes: '',
  });
  const [payingEntryKey, setPayingEntryKey] = useState<string | null>(null); // `${planId}::${entryId}`
  const [payEntryAmount, setPayEntryAmount] = useState('');
  const [payEntryDate, setPayEntryDate] = useState(new Date().toISOString().slice(0, 10));

  const handleCreateInstallmentPlan = () => {
    if (!subscriber || !instPlanDraft.courseId || !instPlanDraft.numInstallments) return;
    const info = getInstBookingInfo(instPlanDraft.courseId);
    const remaining = info.remainingEGP;
    const n = Math.max(1, Number(instPlanDraft.numInstallments));
    const perInstRaw = instPlanDraft.inputMode === 'amount' && instPlanDraft.amountPerInst
      ? Number(instPlanDraft.amountPerInst)
      : Math.floor(remaining / n);
    const perInst = Math.max(1, perInstRaw);
    const actualN = instPlanDraft.inputMode === 'amount' && instPlanDraft.amountPerInst
      ? Math.ceil(remaining / perInst)
      : n;
    const intervalDays = Number(instPlanDraft.intervalDays || 30);
    const startDate = new Date(instPlanDraft.startDate);

    const entries: InstallmentEntry[] = Array.from({ length: actualN }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i * intervalDays);
      const isLast = i === actualN - 1;
      return {
        id: `ie-${Date.now()}-${i}`,
        amount: isLast ? remaining - perInst * (actualN - 1) : perInst,
        currency: instPlanDraft.currency,
        dueDate: d.toISOString().slice(0, 10),
      };
    });

    const isBundleSel = instPlanDraft.courseId.startsWith('bundle:');
    const resolvedCourseId = isBundleSel ? undefined : instPlanDraft.courseId;
    const resolvedTitle = isBundleSel
      ? bundles.find(b => `bundle:${b.id}` === instPlanDraft.courseId)?.title
      : courses.find(c => c.id === instPlanDraft.courseId)?.title;

    const plan: InstallmentPlan = {
      id: `ip-${Date.now()}`,
      courseId: resolvedCourseId,
      courseTitle: resolvedTitle,
      totalAmount: remaining,
      currency: instPlanDraft.currency,
      downPayment: info.paidEGP > 0 ? info.paidEGP : undefined,
      entries,
      notes: instPlanDraft.notes || undefined,
      createdAt: new Date().toISOString().slice(0, 10),
    };

    updateSubscriber({ ...subscriber, installmentPlans: [...(subscriber.installmentPlans || []), plan] });
    setShowInstPlanForm(false);
    setInstPlanDraft({ courseId: '', currency: 'EGP', amountPerInst: '', numInstallments: '3', inputMode: 'count', startDate: new Date().toISOString().slice(0, 10), intervalDays: '30', notes: '' });
  };

  const handlePayInstallmentEntry = (planId: string, entryId: string) => {
    if (!subscriber) return;
    const amt = Number(payEntryAmount);
    if (!amt || amt <= 0) return;
    const plans = (subscriber.installmentPlans || []).map(plan => {
      if (plan.id !== planId) return plan;
      return {
        ...plan,
        entries: plan.entries.map(e =>
          e.id !== entryId ? e : { ...e, paidAt: payEntryDate, paidAmount: amt }
        ),
      };
    });
    updateSubscriber({ ...subscriber, installmentPlans: plans });
    setPayingEntryKey(null);
    setPayEntryAmount('');
    setPayEntryDate(new Date().toISOString().slice(0, 10));
  };

  const handleDeleteInstallmentPlan = (planId: string) => {
    if (!subscriber || !window.confirm('هل تريد حذف خطة الأقساط؟')) return;
    updateSubscriber({ ...subscriber, installmentPlans: (subscriber.installmentPlans || []).filter(p => p.id !== planId) });
  };

  const handleDeleteInstallmentEntry = (planId: string, entryId: string) => {
    if (!subscriber || !window.confirm('حذف هذا القسط؟')) return;
    const plans = (subscriber.installmentPlans || []).map(plan => {
      if (plan.id !== planId) return plan;
      return { ...plan, entries: plan.entries.filter(e => e.id !== entryId) };
    });
    updateSubscriber({ ...subscriber, installmentPlans: plans });
  };

  return {
    showInstPlanForm, setShowInstPlanForm, instPlanDraft, setInstPlanDraft,
    payingEntryKey, setPayingEntryKey, payEntryAmount, setPayEntryAmount,
    payEntryDate, setPayEntryDate,
    handleCreateInstallmentPlan, handlePayInstallmentEntry,
    handleDeleteInstallmentPlan, handleDeleteInstallmentEntry,
  };
}
