import React, { useMemo, useState } from 'react';
import {
  Plus, TrendingUp,
} from 'lucide-react';
import { FinancialSubTabs } from './financial/FinancialSubTabs';
import { FinancialOrdersControls } from './financial/FinancialOrdersControls';
import { FinancialOrdersTable } from './financial/FinancialOrdersTable';
import type { InstallmentPlanDraft } from './financial/InstallmentPlanModal';
import type { PayingInstallmentEntry } from './financial/InstallmentPaymentModal';
import { useFinancialCommissionsData } from './financial/useFinancialCommissionsData';
import { useFinancialOrdersData } from './financial/useFinancialOrdersData';
import { usePaymentProofsReview } from './financial/usePaymentProofsReview';
import { exportCSV, exportExpensesPdfReport, exportFullFinancialReport, exportPaymentsExcelReport } from './financial/financialExports';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { PaymentHistoryEntry, ExpenseItem, InstallmentEntry, InstallmentPlan, SubscriberItem } from '../../../types';
import { branchMatches, createBlankIncomeDraft, type FinancialSubTab } from './financial/financialTabUtils';
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const AgingReportPanel = React.lazy(() => import('./financial/AgingReportPanel').then(module => ({ default: module.AgingReportPanel })));
const AuditLogPanel = React.lazy(() => import('./financial/AuditLogPanel').then(module => ({ default: module.AuditLogPanel })));
const FinancialBudgetPanel = React.lazy(() => import('./financial/FinancialBudgetPanel'));
const FinancialCockpitPanel = React.lazy(() => import('./financial/FinancialCockpitPanel'));
const FinancialCommissionsPanel = React.lazy(() => import('./financial/FinancialCommissionsPanel').then(module => ({ default: module.FinancialCommissionsPanel })));
const FinancialExpensesPanel = React.lazy(() => import('./financial/FinancialExpensesPanel').then(module => ({ default: module.FinancialExpensesPanel })));
const FinancialInstallmentsPanel = React.lazy(() => import('./financial/FinancialInstallmentsPanel').then(module => ({ default: module.FinancialInstallmentsPanel })));
const FinancialOverviewPanel = React.lazy(() => import('./financial/FinancialOverviewPanel').then(module => ({ default: module.FinancialOverviewPanel })));
const FinancialProfitLossPanel = React.lazy(() => import('./financial/FinancialProfitLossPanel').then(module => ({ default: module.FinancialProfitLossPanel })));
const FinancialRefundsPanel = React.lazy(() => import('./financial/FinancialRefundsPanel'));
const IncomeModal = React.lazy(() => import('./financial/IncomeModal').then(module => ({ default: module.IncomeModal })));
const MonthlyRevenuePanel = React.lazy(() => import('./financial/MonthlyRevenuePanel').then(module => ({ default: module.MonthlyRevenuePanel })));
const OutstandingPanel = React.lazy(() => import('./financial/OutstandingPanel').then(module => ({ default: module.OutstandingPanel })));
const ReconciliationPanel = React.lazy(() => import('./financial/ReconciliationPanel'));
const PaymentProofsPanel = React.lazy(() => import('./financial/PaymentProofsPanel').then(module => ({ default: module.PaymentProofsPanel })));
const PaymentReviewPanel = React.lazy(() => import('./financial/PaymentReviewPanel').then(module => ({ default: module.PaymentReviewPanel })));
const PeriodClosingPanel = React.lazy(() => import('./FinancialPanels').then(module => ({ default: module.PeriodClosingPanel })));

export default function FinancialTab({ notify, branchFilter }: { notify: NotifyFn; branchFilter?: string }) {
  const {
    orders: _allOrders, subscribers: _allSubscribers, updateSubscriber, staffMembers,
    expenses: _allExpenses, addExpense, updateExpense, deleteExpense, content, setContentValue, courses,
    authUser,
  } = useSiteData();

  // Apply branch filter: daqqi_accounting passes branchFilter='daqqi' to restrict data to that branch only
  const subscribers = branchFilter ? _allSubscribers.filter(s => branchMatches(s.branch, branchFilter)) : _allSubscribers;
  const expenses    = branchFilter ? _allExpenses.filter(e => !e.branchType || branchMatches(e.branchType, branchFilter)) : _allExpenses;
  // Online (Paymob) orders don't carry branch — exclude when filtering a specific branch (they belong to online branch)
  const orders = branchFilter ? [] : _allOrders;

  // Expense management state
  const [expenseDraft, setExpenseDraft] = useState<Omit<ExpenseItem, 'id' | 'createdAt'>>({
    category: 'أخرى', description: '', amount: 0, currency: 'EGP',
    date: new Date().toISOString().slice(0, 10), receiptUrl: '',
  });
  const [editingExpenseId, setEditingExpenseId] = useState('');
  const [isExpenseFormOpen, setIsExpenseFormOpen] = useState(false);
  const [expenseDateFrom, setExpenseDateFrom] = useState('');
  const [expenseDateTo, setExpenseDateTo] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState<string>('all');
  const [financialSubTab, setFinancialSubTab] = useState<FinancialSubTab>('cockpit');
  const {
    allProofs,
    proofsLoading,
    proofFilter,
    setProofFilter,
    reviewingProofId,
    setReviewingProofId,
    proofsReviewerNote,
    setProofsReviewerNote,
    proofsReviewLoading,
    proofImages,
    loadAllProofs,
    loadProofImg,
    handleProofReview,
    pendingProofsCount,
  } = usePaymentProofsReview({
    authUserEmail: authUser?.email,
    notify,
    staffMembers,
    subscribers,
    updateSubscriber,
  });

  // ── FX rates refresh ──
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const refreshFxRates = async () => {
    setFxRefreshing(true);
    try {
      const r = await mysqlAdmin.adminPost<{ ok: boolean; sar_to_egp: number; usd_to_egp: number }>('/api/admin/fx-rates/refresh', {});
      if (r && (r as { ok?: boolean }).ok) {
        setContentValue('exchange.sar_to_egp', String((r as { sar_to_egp: number }).sar_to_egp));
        setContentValue('exchange.usd_to_egp', String((r as { usd_to_egp: number }).usd_to_egp));
        notify('success', `تم تحديث أسعار الصرف: 1 ر.س = ${(r as { sar_to_egp: number }).sar_to_egp} ج.م، 1 $ = ${(r as { usd_to_egp: number }).usd_to_egp} ج.م`);
      }
    } catch { notify('error', 'فشل تحديث أسعار الصرف'); }
    finally { setFxRefreshing(false); }
  };

  // ── خزنة date filter ──
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [vaultMonth, setVaultMonth] = useState(currentMonth);

  // ── Global date range filter (for overview / P&L) ──
  const [globalDateFrom, setGlobalDateFrom] = useState('');
  const [globalDateTo, setGlobalDateTo] = useState('');

  // ── Orders tab extra filters ──
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [orderTypeFilter, setOrderTypeFilter] = useState('');
  const [ordersPage, setOrdersPage] = useState(1);
  const ORDERS_PAGE_SIZE = 50;

  const exportFullReport = () => exportFullFinancialReport({ content, orders, subscribers, expenses });
  const exportPaymentsExcel = () => exportPaymentsExcelReport({ content, orders, subscribers });
  const exportExpensesPDF = () => exportExpensesPdfReport(expenses);

  const allPaymentHistoryEarly = subscribers.flatMap(s => s.paymentHistory ?? []);
  const pendingReviewCount = allPaymentHistoryEarly.filter(p => p.status === 'pending').length;
  const [orderMethodFilter, setOrderMethodFilter] = useState('');
  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const [isMethodsEditing, setIsMethodsEditing] = useState(false);
  const [newMethodDraft, setNewMethodDraft] = useState('');
  const [commissionMonth, setCommissionMonth] = useState(new Date().toISOString().slice(0, 7));
  const [commissionFrom, setCommissionFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().slice(0, 7); });
  const [commissionTo, setCommissionTo] = useState(new Date().toISOString().slice(0, 7));
  const [commissionViewMode, setCommissionViewMode] = useState<'single' | 'range'>('single');
  const [isNewPlanOpen, setIsNewPlanOpen] = useState(false);
  const [newPlanSubId, setNewPlanSubId] = useState('');
  const [newPlanDraft, setNewPlanDraft] = useState<InstallmentPlanDraft>({ courseId: '', courseTitle: '', totalAmount: 0, currency: 'EGP', notes: '', entries: [] });
  const [newEntry, setNewEntry] = useState({ dueDate: '', amount: 0, note: '' });
  const [payingEntry, setPayingEntry] = useState<PayingInstallmentEntry | null>(null);
  const [dbPayments, setDbPayments] = useState<Array<{ id: string; subscriberId: string; subscriberName: string; amount: number; currency: string; paymentType: string; paymentMethod: string | null; transactionId: string | null; note: string | null; at: string; isInstallment: boolean }> | null>(null);
  const [loadingDbPayments, setLoadingDbPayments] = useState(false);

  const loadDbPayments = async () => {
    setLoadingDbPayments(true);
    try {
      const rows = await mysqlAdmin.getPayments() as unknown as typeof dbPayments;
      setDbPayments(rows ?? null);
    } catch { /* ignore */ }
    finally { setLoadingDbPayments(false); }
  };
  const [incomeDraft, setIncomeDraft] = useState(createBlankIncomeDraft);

  const handleSaveInstallmentPlan = () => {
    if (!newPlanSubId || !newPlanDraft.totalAmount || newPlanDraft.entries.length === 0) return;
    const sub = subscribers.find(s => s.id === newPlanSubId);
    if (!sub) return;
    const plan: InstallmentPlan = {
      id: `plan-${Date.now()}`,
      courseId: newPlanDraft.courseId || undefined,
      courseTitle: newPlanDraft.courseTitle || undefined,
      totalAmount: newPlanDraft.totalAmount,
      currency: newPlanDraft.currency,
      notes: newPlanDraft.notes || undefined,
      entries: newPlanDraft.entries.map((entry, index) => ({
        id: `entry-${Date.now()}-${index}`,
        amount: entry.amount,
        currency: newPlanDraft.currency,
        dueDate: entry.dueDate,
        note: entry.note || undefined,
      } as InstallmentEntry)),
      createdAt: new Date().toISOString().slice(0, 10),
    };
    updateSubscriber({ ...sub, installmentPlans: [...(sub.installmentPlans || []), plan] });
    if (newPlanDraft.courseId) {
      void mysqlAdmin.addEnrollment(sub.id, newPlanDraft.courseId, null, 'limited', 15).catch(() => {});
    }
    notify('success', 'تم إنشاء خطة الأقساط بنجاح.');
    setIsNewPlanOpen(false);
    setNewPlanSubId('');
    setNewPlanDraft({ courseId: '', courseTitle: '', totalAmount: 0, currency: 'EGP', notes: '', entries: [] });
    setNewEntry({ dueDate: '', amount: 0, note: '' });
  };

  const handleConfirmInstallmentPayment = (sub: SubscriberItem, plan: InstallmentPlan, entry: InstallmentEntry) => {
    if (!payingEntry) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    const updatedPlans = (sub.installmentPlans || []).map(pl =>
      pl.id !== payingEntry.planId ? pl : {
        ...pl,
        entries: pl.entries.map(en =>
          en.id !== payingEntry.entryId ? en : {
            ...en,
            paidAt: todayStr,
            paidAmount: payingEntry.paidAmount,
          }
        ),
      }
    );
    const payHistEntry: PaymentHistoryEntry = {
      id: `inst-${payingEntry.entryId}-${Date.now()}`,
      amount: payingEntry.paidAmount,
      currency: entry.currency || plan.currency || 'EGP',
      paymentMethod: payingEntry.paymentMethod || undefined,
      note: [
        `قسط: ${plan.courseTitle || 'خطة سداد'}`,
        entry.dueDate ? `استحقاق: ${entry.dueDate}` : '',
        entry.note || '',
      ].filter(Boolean).join(' — ') || undefined,
      paymentType: 'course',
      courseId: plan.courseId || undefined,
      isInstallment: true,
      at: todayStr,
    };
    let updatedCourseAccess = { ...(sub.courseAccess ?? {}) };
    let updatedEnrolledIds = [...(sub.enrolledCourseIds ?? [])];
    if (plan.courseId) {
      const prevInstCount = (sub.paymentHistory || []).filter(
        payment => payment.isInstallment && payment.courseId === plan.courseId
      ).length;
      if (prevInstCount === 0) {
        const curAccess = updatedCourseAccess[plan.courseId];
        const notFull = !curAccess || curAccess === 'preview' ||
          (typeof curAccess === 'object' && curAccess.mode !== 'full' && curAccess.mode !== 'limited');
        if (notFull) updatedCourseAccess[plan.courseId] = { mode: 'limited', lectureLimit: 15 };
        if (!updatedEnrolledIds.includes(plan.courseId))
          updatedEnrolledIds = [...updatedEnrolledIds, plan.courseId];
      }
    }
    updateSubscriber({
      ...sub,
      installmentPlans: updatedPlans,
      paymentHistory: [...(sub.paymentHistory || []), payHistEntry],
      courseAccess: updatedCourseAccess,
      enrolledCourseIds: updatedEnrolledIds,
    });
    void mysqlAdmin.saveSubscriberPayment(sub.id, payHistEntry as unknown as Record<string, unknown>).catch(() => {});
    if (plan.courseId) {
      void mysqlAdmin.addEnrollment(sub.id, plan.courseId, null, 'limited', 15).catch(() => {});
    }
    notify('success', 'تم تسجيل دفعة القسط بنجاح.');
    setPayingEntry(null);
  };

  const handleAddIncome = () => {
    if (!incomeDraft.subscriberId || !incomeDraft.amount) return;
    const sub = subscribers.find((s) => s.id === incomeDraft.subscriberId);
    if (!sub) return;
    const entry: PaymentHistoryEntry = {
      id: `inc-${Date.now()}`, amount: incomeDraft.amount, currency: incomeDraft.currency,
      note: [incomeDraft.note, incomeDraft.transactionId].filter(Boolean).join(' | ') || undefined,
      paymentMethod: incomeDraft.paymentMethod || undefined,
      fromAccountNumber: incomeDraft.fromAccountNumber || undefined,
      source: 'staff' as const,
      paymentType: incomeDraft.paymentType,
      courseId: incomeDraft.courseId || undefined,
      isInstallment: incomeDraft.isInstallment || false,
      at: incomeDraft.date,
    };
    // Auto-unlock 15 limited videos on first installment for a course
    let updatedCourseAccess = { ...(sub.courseAccess ?? {}) };
    let updatedEnrolledIds = [...(sub.enrolledCourseIds ?? [])];
    if (incomeDraft.isInstallment && incomeDraft.courseId) {
      const prevInstCount = (sub.paymentHistory || []).filter(
        p => p.isInstallment && p.courseId === incomeDraft.courseId
      ).length;
      if (prevInstCount === 0) {
        const curAccess = updatedCourseAccess[incomeDraft.courseId];
        const notFull = !curAccess || curAccess === 'preview' ||
          (typeof curAccess === 'object' && curAccess.mode !== 'full' && curAccess.mode !== 'limited');
        if (notFull) updatedCourseAccess[incomeDraft.courseId] = { mode: 'limited', lectureLimit: 15 };
        if (!updatedEnrolledIds.includes(incomeDraft.courseId))
          updatedEnrolledIds = [...updatedEnrolledIds, incomeDraft.courseId];
      }
    }
    updateSubscriber({
      ...sub,
      paymentHistory: [...(sub.paymentHistory ?? []), entry],
      courseAccess: updatedCourseAccess,
      enrolledCourseIds: updatedEnrolledIds,
    });
    // Persist payment to MySQL payments table
    void mysqlAdmin.saveSubscriberPayment(sub.id, entry as unknown as Record<string, unknown>).catch(() => {});
    // Persist enrollment to MySQL enrollments table
    if (incomeDraft.courseId) {
      let accessLevel: 'full' | 'limited' = 'full';
      let lectureLimit: number | undefined;
      const newAccess = updatedCourseAccess[incomeDraft.courseId];
      if (newAccess && typeof newAccess === 'object' && newAccess.mode === 'limited') {
        accessLevel = 'limited';
        lectureLimit = newAccess.lectureLimit;
      }
      void mysqlAdmin.addEnrollment(sub.id, incomeDraft.courseId, null, accessLevel, lectureLimit).catch(() => {});
    }
    notify('success', 'تم تسجيل الدخل بنجاح.');
    setIsIncomeFormOpen(false);
    setIncomeDraft(createBlankIncomeDraft());
  };

  const today = new Date().toISOString().slice(0, 10);
  const subscribersWithPlans = subscribers.filter(s => (s.installmentPlans?.length ?? 0) > 0);

  const sarRate = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
  const usdRate = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
  const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;
  const paidOrders = orders.filter(o => o.status === 'paid' && (o.paymentMethod === 'card' || o.paymentMethod === 'wallet' || o.paymentMethod === 'online_paymob' || (o as unknown as Record<string,unknown>)['source'] !== 'crm'));
  // All paymentHistory entries across subscribers — only confirmed/paid entries count toward revenue
  const allPaymentHistory = subscribers.flatMap(s => s.paymentHistory ?? []);
  // Truly manual payments: only paid status, exclude Paymob online entries (already in paidOrders above)
  const allManualPayments = allPaymentHistory.filter(p =>
    (!p.status || p.status === 'paid') &&
    (p.paymentMethod || '') !== 'online_paymob' &&
    !(p.paymentMethod || '').includes('Paymob')
  );
  const onlineRevenueEGP = paidOrders.reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
  const manualRevenueEGP = allManualPayments.reduce((s, p) => s + toEGP(p.amount, p.currency), 0);
  const totalRevenueEGP = onlineRevenueEGP + manualRevenueEGP;
  const totalExpensesEGP = expenses.reduce((s, e) => s + toEGP(e.amount, e.currency), 0);
  const netProfitEGP = totalRevenueEGP - totalExpensesEGP;
  const profitMargin = totalRevenueEGP > 0 ? Math.round((netProfitEGP / totalRevenueEGP) * 100) : 0;

  // ── فلتر فترة زمنية للنظرة العامة / الأرباح والخسائر ──
  const isGlobalFiltered = !!(globalDateFrom || globalDateTo);
  const globalFilteredManual = allManualPayments.filter(p => {
    const d = (p.at || '').slice(0, 10);
    if (globalDateFrom && d < globalDateFrom) return false;
    if (globalDateTo && d > globalDateTo) return false;
    return true;
  });
  const globalFilteredOrders = paidOrders.filter(o => {
    const d = (o.paidAt || o.createdAt || '').slice(0, 10);
    if (globalDateFrom && d < globalDateFrom) return false;
    if (globalDateTo && d > globalDateTo) return false;
    return true;
  });
  const globalFilteredExpenses = expenses.filter(e => {
    if (globalDateFrom && e.date < globalDateFrom) return false;
    if (globalDateTo && e.date > globalDateTo) return false;
    return true;
  });
  const gOnline = globalFilteredOrders.reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
  const gManual = globalFilteredManual.reduce((s, p) => s + toEGP(p.amount, p.currency), 0);
  const gRevenue = gOnline + gManual;
  const gExpenses = globalFilteredExpenses.reduce((s, e) => s + toEGP(e.amount, e.currency), 0);
  const gProfit = gRevenue - gExpenses;
  const gMargin = gRevenue > 0 ? Math.round((gProfit / gRevenue) * 100) : 0;

  // ── إيرادات لكل كورس ──
  const revenueByCourse = courses.map(c => {
    const manual = allManualPayments
      .filter(p => p.courseId === c.id && p.paymentType === 'course')
      .reduce((s, p) => s + toEGP(p.amount, p.currency), 0);
    const online = paidOrders
      .filter(o => o.type === 'course' && o.courseId === c.id)
      .reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
    return { id: c.id, title: c.titleAr || c.title, manual, online, total: manual + online };
  }).filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // ── تقرير التقادم (aging) للأقساط المتأخرة ──
  const agingRows = subscribersWithPlans.flatMap(s =>
    (s.installmentPlans ?? []).flatMap(plan => {
      const totalPaid = (plan.payments ?? []).reduce((sum: number, py: { amount: number }) => sum + py.amount, 0);
      const remaining = plan.totalAmount - totalPaid;
      if (remaining <= 0) return [];
      const dueDate = plan.nextDueDate || plan.startDate || '';
      if (!dueDate) return [];
      const days = dueDate < today ? Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000) : 0;
      return [{ sub: s, plan, remaining, dueDate, daysOverdue: days }];
    })
  ).sort((a, b) => b.daysOverdue - a.daysOverdue);

  // Helper: get payment method from entry (new field first, then scan note for compat)
  const DEFAULT_METHODS = ['خزنة الدقي', 'خزنة الفرع', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'احمد السعودية'];
  const PAYMENT_METHODS: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map(s => s.trim()).filter(Boolean)
    : DEFAULT_METHODS;
  const savePaymentMethods = (methods: string[]) =>
    setContentValue('finance.payment_methods', methods.join('||'));
  const getMethod = (p: { paymentMethod?: string; note?: string }) =>
    p.paymentMethod || PAYMENT_METHODS.find(m => (p.note || '').includes(m)) || '';
  const {
    allRows,
    onlineRows,
    manualRows,
    filteredRows,
    pageRows,
    byType,
    totalFiltered,
    pageCount,
    hasFilters,
  } = useFinancialOrdersData({
    paidOrders,
    subscribers,
    dbPayments,
    orderMethodFilter,
    orderSearch,
    orderDateFrom,
    orderDateTo,
    orderTypeFilter,
    ordersPage,
    pageSize: ORDERS_PAGE_SIZE,
    toEGP,
    getMethod,
  });

  // Revenue by payment method (manual entries only)
  const revenueByMethod: Record<string, number> = {};
  for (const p of allManualPayments) {
    const m = getMethod(p) || 'غير محدد';
    revenueByMethod[m] = (revenueByMethod[m] || 0) + toEGP(p.amount, p.currency);
  }

  // Revenue by method filtered by vaultMonth
  const vaultFilteredPayments = allManualPayments.filter(p => p.at.startsWith(vaultMonth));
  const revenueByMethodFiltered: Record<string, number> = {};
  for (const p of vaultFilteredPayments) {
    const m = getMethod(p) || 'غير محدد';
    revenueByMethodFiltered[m] = (revenueByMethodFiltered[m] || 0) + toEGP(p.amount, p.currency);
  }
  const onlineRevenueFiltered = paidOrders.filter(o => (o.paidAt || o.createdAt || '').startsWith(vaultMonth)).reduce((s, o) => s + toEGP(o.amount, o.currency), 0);

  const manualByType = (type: string) => allManualPayments.filter(p => p.paymentType === type).reduce((s, p) => s + toEGP(p.amount, p.currency), 0);
  const revenueByType = {
    course: paidOrders.filter(o => o.type === 'course').reduce((s, o) => s + toEGP(o.amount, o.currency), 0) + manualByType('course'),
    bundle: paidOrders.filter(o => o.type === 'bundle').reduce((s, o) => s + toEGP(o.amount, o.currency), 0),
    consultation: paidOrders.filter(o => o.type === 'consultation').reduce((s, o) => s + toEGP(o.amount, o.currency), 0) + manualByType('consultation'),
    certificate: manualByType('certificate'),
    book: manualByType('book'),
    carneh: manualByType('carneh'),
    other: allManualPayments.filter(p => !p.paymentType || p.paymentType === 'other').reduce((s, p) => s + toEGP(p.amount, p.currency), 0),
  };
  const expenseByCategory = expenses.reduce((acc: Record<string, number>, e) => {
    acc[e.category] = (acc[e.category] || 0) + toEGP(e.amount, e.currency);
    return acc;
  }, {});
  const filteredExpenses = expenses.filter(e => {
    const matchCat = expenseCategoryFilter === 'all' || e.category === expenseCategoryFilter;
    const matchFrom = !expenseDateFrom || e.date >= expenseDateFrom;
    const matchTo = !expenseDateTo || e.date <= expenseDateTo;
    return matchCat && matchFrom && matchTo;
  });
  const EXPENSE_CATS: string[] = ['رواتب', 'تسويق', 'إيجار', 'برمجيات', 'معدات', 'أخرى'];

  const monthlyRevenue = useMemo(() => {
    const data: Record<string, { online: number; manual: number }> = {};
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      data[key] = { online: 0, manual: 0 };
    }
    paidOrders.forEach(o => {
      const m = o.createdAt.slice(0, 7);
      if (m in data) data[m].online += toEGP(o.amount, o.currency);
    });
    allManualPayments.forEach(p => {
      const m = p.at.slice(0, 7);
      if (m in data) data[m].manual += toEGP(p.amount, p.currency);
    });
    return Object.entries(data).sort(([a], [b]) => b.localeCompare(a));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, subscribers, sarRate, usdRate]);

  const { commissionsData, rangeMonths, rangeCommissionsData } = useFinancialCommissionsData(
    staffMembers,
    subscribers,
    commissionMonth,
    commissionFrom,
    commissionTo,
    toEGP,
  );

  const notifyLegacy = (msg: string, type?: 'success' | 'error') => notify(type || 'info', msg);

  return (
    <div className="space-y-5">
      {/* Branch filter banner */}
      {branchFilter && (
        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3">
          <span className="text-2xl">🏢</span>
          <div>
            <p className="font-bold text-amber-800 text-sm">محاسبة فرع الدقي فقط</p>
            <p className="text-xs text-amber-600">البيانات مفلترة على المشتركين المسجلين في فرع الدقي · المدفوعات اليدوية فقط (الأونلاين يُحسب في النظام المحاسبي الرئيسي)</p>
          </div>
          <span className="mr-auto text-xs font-bold text-amber-700 bg-amber-100 border border-amber-200 px-3 py-1 rounded-lg">{subscribers.length} مشترك</span>
        </div>
      )}
      {/* Sub-tabs + quick action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FinancialSubTabs
          activeTab={financialSubTab}
          pendingProofsCount={pendingProofsCount}
          pendingReviewCount={pendingReviewCount}
          onChange={setFinancialSubTab}
          onOpenProofs={() => { if (!allProofs) loadAllProofs(); }}
        />
        <div className="flex gap-2">
          {/* FX Rates widget */}
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5 text-xs">
            <span className="text-gray-500">ر.س =</span>
            <span className="font-bold text-gray-800">{parseFloat(content['exchange.sar_to_egp'] || '13') || 13} ج.م</span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-500">$ =</span>
            <span className="font-bold text-gray-800">{parseFloat(content['exchange.usd_to_egp'] || '50') || 50} ج.م</span>
            <button onClick={refreshFxRates} disabled={fxRefreshing} title="تحديث أسعار الصرف من الإنترنت"
              className="mr-1 p-1 rounded-lg hover:bg-gray-200 transition disabled:opacity-50">
              {fxRefreshing
                ? <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin inline-block" />
                : <TrendingUp size={12} className="text-emerald-600" />}
            </button>
          </div>
          <button
            onClick={() => { setIsIncomeFormOpen(true); setIncomeDraft(createBlankIncomeDraft()); }}
            className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 transition">
            <Plus size={14} /> إضافة دخل
          </button>
          <button
            onClick={() => { setFinancialSubTab('expenses'); setIsExpenseFormOpen(true); setEditingExpenseId(''); setExpenseDraft({ category: 'أخرى', description: '', amount: 0, currency: 'EGP', date: new Date().toISOString().slice(0, 10), receiptUrl: '' }); }}
            className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-2 rounded-xl text-sm font-bold hover:bg-red-700 transition">
            <Plus size={14} /> إضافة مصروف
          </button>
        </div>
      </div>

      {isIncomeFormOpen && (
        <IncomeModal
          incomeDraft={incomeDraft}
          setIncomeDraft={setIncomeDraft}
          subscribers={subscribers}
          courses={courses}
          paymentMethods={PAYMENT_METHODS}
          onSave={handleAddIncome}
          onClose={() => setIsIncomeFormOpen(false)}
        />
      )}

      {financialSubTab === 'cockpit' && (
        <FinancialCockpitPanel
          notify={notifyLegacy}
          onNavigate={(tab) => {
            if (tab === 'proofs' && !allProofs) loadAllProofs();
            setFinancialSubTab(tab as typeof financialSubTab);
          }}
        />
      )}

      {financialSubTab === 'budget' && (
        <FinancialBudgetPanel notify={notifyLegacy} />
      )}

      {financialSubTab === 'refunds' && (
        <FinancialRefundsPanel notify={notifyLegacy} />
      )}

      {financialSubTab === 'overview' && (
        <FinancialOverviewPanel
          globalDateFrom={globalDateFrom}
          setGlobalDateFrom={setGlobalDateFrom}
          globalDateTo={globalDateTo}
          setGlobalDateTo={setGlobalDateTo}
          isGlobalFiltered={isGlobalFiltered}
          exportFullReport={exportFullReport}
          exportPaymentsExcel={exportPaymentsExcel}
          exportExpensesPDF={exportExpensesPDF}
          gRevenue={gRevenue}
          gExpenses={gExpenses}
          gProfit={gProfit}
          gMargin={gMargin}
          totalRevenueEGP={totalRevenueEGP}
          totalExpensesEGP={totalExpensesEGP}
          netProfitEGP={netProfitEGP}
          profitMargin={profitMargin}
          revenueByType={revenueByType}
          expenseByCategory={expenseByCategory}
          vaultMonth={vaultMonth}
          setVaultMonth={setVaultMonth}
          currentMonth={currentMonth}
          onlineRevenueFiltered={onlineRevenueFiltered}
          revenueByMethodFiltered={revenueByMethodFiltered}
          setFinancialSubTab={setFinancialSubTab}
          setOrderMethodFilter={setOrderMethodFilter}
          isMethodsEditing={isMethodsEditing}
          setIsMethodsEditing={setIsMethodsEditing}
          paymentMethods={PAYMENT_METHODS}
          savePaymentMethods={savePaymentMethods}
          newMethodDraft={newMethodDraft}
          setNewMethodDraft={setNewMethodDraft}
          revenueByCourse={revenueByCourse}
          exportCSV={exportCSV}
        />
      )}
      {financialSubTab === 'orders' && (() => {
        return (
          <div className="space-y-4">
            <FinancialOrdersControls
              onlineRevenueEGP={onlineRevenueEGP}
              manualRevenueEGP={manualRevenueEGP}
              totalRevenueEGP={totalRevenueEGP}
              onlineRows={onlineRows}
              manualRows={manualRows}
              filteredRows={filteredRows}
              allRows={allRows}
              byType={byType}
              totalFiltered={totalFiltered}
              hasFilters={hasFilters}
              orderSearch={orderSearch}
              setOrderSearch={setOrderSearch}
              orderDateFrom={orderDateFrom}
              setOrderDateFrom={setOrderDateFrom}
              orderDateTo={orderDateTo}
              setOrderDateTo={setOrderDateTo}
              orderTypeFilter={orderTypeFilter}
              setOrderTypeFilter={setOrderTypeFilter}
              orderMethodFilter={orderMethodFilter}
              setOrderMethodFilter={setOrderMethodFilter}
              setOrdersPage={setOrdersPage}
              paymentMethods={PAYMENT_METHODS}
              exportCSV={exportCSV}
              loadDbPayments={loadDbPayments}
              loadingDbPayments={loadingDbPayments}
            />

            <FinancialOrdersTable
              pageRows={pageRows}
              filteredRows={filteredRows}
              totalFiltered={totalFiltered}
              hasFilters={hasFilters}
              pageCount={pageCount}
              ordersPage={ordersPage}
              setOrdersPage={setOrdersPage}
            />
          </div>
        );
      })()}

      {/* Expenses sub-tab */}
      {financialSubTab === 'expenses' && (
        <FinancialExpensesPanel
          expenseDraft={expenseDraft}
          setExpenseDraft={setExpenseDraft}
          expenseCategories={EXPENSE_CATS}
          editingExpenseId={editingExpenseId}
          setEditingExpenseId={setEditingExpenseId}
          isExpenseFormOpen={isExpenseFormOpen}
          setIsExpenseFormOpen={setIsExpenseFormOpen}
          expenseCategoryFilter={expenseCategoryFilter}
          setExpenseCategoryFilter={setExpenseCategoryFilter}
          expenseDateFrom={expenseDateFrom}
          setExpenseDateFrom={setExpenseDateFrom}
          expenseDateTo={expenseDateTo}
          setExpenseDateTo={setExpenseDateTo}
          filteredExpenses={filteredExpenses}
          toEGP={toEGP}
          exportCSV={exportCSV}
          addExpense={addExpense}
          updateExpense={updateExpense}
          deleteExpense={deleteExpense}
        />
      )}

      {/* P&L sub-tab */}
      {financialSubTab === 'pl' && (
        <FinancialProfitLossPanel
          isGlobalFiltered={isGlobalFiltered}
          setFinancialSubTab={setFinancialSubTab}
          gRevenue={gRevenue}
          gExpenses={gExpenses}
          gProfit={gProfit}
          gMargin={gMargin}
          totalRevenueEGP={totalRevenueEGP}
          totalExpensesEGP={totalExpensesEGP}
          netProfitEGP={netProfitEGP}
          profitMargin={profitMargin}
          globalDateFrom={globalDateFrom}
          globalDateTo={globalDateTo}
          today={today}
          revenueByType={revenueByType}
          expenseByCategory={expenseByCategory}
        />
      )}

      {financialSubTab === 'installments' && (
        <FinancialInstallmentsPanel
          subscribersWithPlans={subscribersWithPlans}
          subscribers={subscribers}
          courses={courses}
          today={today}
          toEGP={toEGP}
          exportCSV={exportCSV}
          isNewPlanOpen={isNewPlanOpen}
          setIsNewPlanOpen={setIsNewPlanOpen}
          newPlanSubId={newPlanSubId}
          setNewPlanSubId={setNewPlanSubId}
          newPlanDraft={newPlanDraft}
          setNewPlanDraft={setNewPlanDraft}
          newEntry={newEntry}
          setNewEntry={setNewEntry}
          payingEntry={payingEntry}
          setPayingEntry={setPayingEntry}
          paymentMethods={PAYMENT_METHODS}
          handleSaveInstallmentPlan={handleSaveInstallmentPlan}
          handleConfirmInstallmentPayment={handleConfirmInstallmentPayment}
        />
      )}

      {financialSubTab === 'monthly' && <MonthlyRevenuePanel monthlyRevenue={monthlyRevenue} />}

      {/* ─── Commissions sub-tab ─── */}
      {financialSubTab === 'commissions' && (
        <FinancialCommissionsPanel
          commissionViewMode={commissionViewMode}
          setCommissionViewMode={setCommissionViewMode}
          commissionMonth={commissionMonth}
          setCommissionMonth={setCommissionMonth}
          commissionFrom={commissionFrom}
          setCommissionFrom={setCommissionFrom}
          commissionTo={commissionTo}
          setCommissionTo={setCommissionTo}
          commissionsData={commissionsData}
          rangeMonths={rangeMonths}
          rangeCommissionsData={rangeCommissionsData}
        />
      )}

      {/* ─── Payment Proofs sub-tab ─── */}
      {financialSubTab === 'proofs' && (
        <PaymentProofsPanel
          allProofs={allProofs}
          proofsLoading={proofsLoading}
          proofFilter={proofFilter}
          setProofFilter={setProofFilter}
          pendingProofsCount={pendingProofsCount}
          loadAllProofs={loadAllProofs}
          proofImages={proofImages}
          loadProofImg={loadProofImg}
          reviewingProofId={reviewingProofId}
          setReviewingProofId={setReviewingProofId}
          proofsReviewerNote={proofsReviewerNote}
          setProofsReviewerNote={setProofsReviewerNote}
          proofsReviewLoading={proofsReviewLoading}
          handleProofReview={handleProofReview}
        />
      )}

      {/* ─── Aging Report Tab ─── */}
      {financialSubTab === 'aging' && (
        <AgingReportPanel rows={agingRows} toEGP={toEGP} exportCSV={exportCSV} />
      )}

      {/* ─── Outstanding Balances Tab ─── */}
      {financialSubTab === 'outstanding' && <OutstandingPanel notify={notify} />}

      {financialSubTab === 'reconciliation' && <ReconciliationPanel />}

      {/* ── Audit Log ─────────────────────────────────────────────────── */}
      {financialSubTab === 'audit' && <AuditLogPanel />}

      {financialSubTab === 'review' && <PaymentReviewPanel notify={notify} branchFilter={branchFilter} subscribers={subscribers} updateSubscriber={updateSubscriber} actorEmail={authUser?.email} sarRate={sarRate} usdRate={usdRate} />}

      {/* ── Period Closing ──────────────────────────────────────────────── */}
      {financialSubTab === 'period_closing' && (
        <PeriodClosingPanel notify={notify} />
      )}
    </div>
  );
}
