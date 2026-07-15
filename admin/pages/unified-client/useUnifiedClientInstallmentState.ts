import { useState } from 'react';

export type InstallmentPlanDraft = {
  courseId: string;
  currency: 'EGP' | 'SAR' | 'USD';
  amountPerInst: string;
  numInstallments: string;
  inputMode: 'count' | 'amount';
  startDate: string;
  intervalDays: string;
  notes: string;
};

export const createInstallmentPlanDraft = (): InstallmentPlanDraft => ({
  courseId: '',
  currency: 'EGP',
  amountPerInst: '',
  numInstallments: '3',
  inputMode: 'count',
  startDate: new Date().toISOString().slice(0, 10),
  intervalDays: '30',
  notes: '',
});

export const useUnifiedClientInstallmentState = () => {
  const [showInstPlanForm, setShowInstPlanForm] = useState(false);
  const [instPlanDraft, setInstPlanDraft] = useState<InstallmentPlanDraft>(createInstallmentPlanDraft());
  const [payingEntryKey, setPayingEntryKey] = useState<string | null>(null);
  const [payEntryAmount, setPayEntryAmount] = useState('');
  const [payEntryDate, setPayEntryDate] = useState(new Date().toISOString().slice(0, 10));

  const resetInstPlanDraft = () => setInstPlanDraft(createInstallmentPlanDraft());
  const resetPaidEntryState = () => {
    setPayingEntryKey(null);
    setPayEntryAmount('');
    setPayEntryDate(new Date().toISOString().slice(0, 10));
  };

  return {
    showInstPlanForm,
    setShowInstPlanForm,
    instPlanDraft,
    setInstPlanDraft,
    resetInstPlanDraft,
    payingEntryKey,
    setPayingEntryKey,
    payEntryAmount,
    setPayEntryAmount,
    payEntryDate,
    setPayEntryDate,
    resetPaidEntryState,
  };
};
