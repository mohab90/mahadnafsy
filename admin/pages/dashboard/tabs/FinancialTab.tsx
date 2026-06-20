import React, { useMemo, useState, useEffect } from 'react';
import {
  AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays,
  CheckCircle2, Clock, CreditCard, Download, FileText, PieChart, Plus, Percent,
  Receipt, Search, TrendingDown, TrendingUp, Users, Wallet, X, Eye, CheckCircle, XCircle,
} from 'lucide-react';
import { exportToExcel, exportToPDF, fmtCurrency, fmtDate } from '../../../lib/exportUtils';
import { BulkStubPanel, PeriodClosingPanel } from './FinancialPanels';
import { AuditLogPanel } from './financial/AuditLogPanel';
import { OutstandingPanel } from './financial/OutstandingPanel';
import { PaymentReviewPanel } from './financial/PaymentReviewPanel';
import { FinancialInstallmentsPanel } from './financial/FinancialInstallmentsPanel';
import { FinancialCommissionsPanel } from './financial/FinancialCommissionsPanel';
import { FinancialOrdersPanel } from './financial/FinancialOrdersPanel';
import { FinancialAgingPanel } from './financial/FinancialAgingPanel';
import { FinancialMonthlyPanel } from './financial/FinancialMonthlyPanel';
import { FinancialProofsPanel } from './financial/FinancialProofsPanel';
import FinancialCockpitPanel from './financial/FinancialCockpitPanel';
import FinancialBudgetPanel from './financial/FinancialBudgetPanel';
import FinancialRefundsPanel from './financial/FinancialRefundsPanel';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { PaymentItemType, PaymentHistoryEntry, ExpenseItem, InstallmentEntry, InstallmentPlan, Currency, PaymentProof } from '../../../types';
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const paymentTypeLabels: Record<PaymentItemType, string> = {
  course: 'كورس', certificate: 'شهادة', consultation: 'استشارة',
  book: 'كتاب', carneh: 'كارنيه', other: 'أخرى',
};

const normalizeBranchId = (value?: string | null) =>
  String(value || '').trim().toUpperCase().replace(/[-\s]/g, '_');

const branchMatches = (value: string | undefined | null, filter?: string) => {
  if (!filter) return true;
  const branch = normalizeBranchId(value);
  const wanted = normalizeBranchId(filter);
  if (wanted === 'DAQQI') return branch === 'DAQQI' || branch === 'DQI';
  return branch === wanted;
};

export default function FinancialTab({ notify, branchFilter, onNavigateTab }: { notify: NotifyFn; branchFilter?: string; onNavigateTab?: (tab: string) => void }) {
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
  const [financialSubTab, setFinancialSubTab] = useState<'cockpit' | 'overview' | 'orders' | 'expenses' | 'pl' | 'installments' | 'monthly' | 'commissions' | 'proofs' | 'aging' | 'outstanding' | 'audit' | 'review' | 'period_closing' | 'budget' | 'refunds'>('cockpit');
  const [pendingProofsCount, setPendingProofsCount] = useState(0);
  const [orderMethodFilter, setOrderMethodFilter] = useState('');

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


  const exportCSV = (filename: string, rows: string[][], headers: string[]) => {
    const BOM = '\uFEFF';
    const escape = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))];
    const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  // Export comprehensive financial report (all data in one CSV)
  const exportFullReport = () => {
    const sarR = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
    const usdR = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
    const conv = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarR : amt * usdR;
    const sections: string[] = [];
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}`;
    const row = (...cols: (string|number)[]) => cols.map(esc).join(',');
    // ── Section 1: Overview ──
    sections.push('=== ملخص مالي ===');
    sections.push(row('الإيرادات الإجمالية (ج.م)', 'المصروفات الإجمالية (ج.م)', 'صافي الربح (ج.م)', 'هامش الربح %'));
    const pOrd = orders.filter(o => o.status === 'paid' && (o.paymentMethod === 'card' || o.paymentMethod === 'wallet' || o.paymentMethod === 'online_paymob' || (o as unknown as Record<string,unknown>)['source'] !== 'crm'));
    const mPay = subscribers.flatMap(s => (s.paymentHistory ?? []).filter(p => (!p.status || p.status === 'paid') && (p.paymentMethod || '') !== 'online_paymob' && !(p.paymentMethod || '').includes('Paymob')));
    const onlineRev = pOrd.reduce((s, o) => s + conv(o.amount, o.currency), 0);
    const manualRev = mPay.reduce((s, p) => s + conv(p.amount, p.currency), 0);
    const totalRev = onlineRev + manualRev;
    const totalExp = expenses.reduce((s, e) => s + conv(e.amount, e.currency), 0);
    const netP = totalRev - totalExp;
    sections.push(row(Math.round(totalRev), Math.round(totalExp), Math.round(netP), totalRev > 0 ? Math.round((netP / totalRev) * 100) + '%' : '0%'));
    sections.push('');
    // ── Section 2: All Payments ──
    sections.push('=== المدفوعات ===');
    sections.push(row('التاريخ', 'العميل', 'الخدمة', 'المبلغ (ج.م)', 'العملة', 'المبلغ المحوّل (ج.م)', 'القناة', 'الموظف', 'ملاحظة', 'النوع'));
    // Online (Paymob)
    for (const o of pOrd) {
      const sub = subscribers.find(s => s.email?.toLowerCase() === o.customerEmail?.toLowerCase());
      sections.push(row(
        (o.paidAt || o.createdAt || '').slice(0, 10),
        o.customerName || '—',
        o.itemTitle || '—',
        o.amount, o.currency,
        Math.round(conv(o.amount, o.currency)),
        'أونلاين Paymob',
        (o as unknown as Record<string,unknown>)['staffName'] as string || '—',
        o.transactionId ? '#' + o.transactionId : '—',
        'أونلاين'
      ));
      void sub;
    }
    // Manual
    for (const s of subscribers) {
      for (const p of (s.paymentHistory ?? []).filter(p => (!p.status || p.status === 'paid') && (p.paymentMethod || '') !== 'online_paymob' && !(p.paymentMethod || '').includes('Paymob'))) {
        sections.push(row(
          (p.at || '').slice(0, 10),
          s.name,
          p.paymentType || 'دفعة',
          p.amount, p.currency || 'EGP',
          Math.round(conv(p.amount, p.currency || 'EGP')),
          p.paymentMethod || 'غير محدد',
          p.staffName || '—',
          p.note || '—',
          'يدوي'
        ));
      }
    }
    sections.push('');
    // ── Section 3: Expenses ──
    sections.push('=== المصروفات ===');
    sections.push(row('التاريخ', 'الفئة', 'الوصف', 'المبلغ', 'العملة', 'المبلغ المحوّل (ج.م)'));
    for (const e of expenses) {
      sections.push(row(e.date, e.category, e.description, e.amount, e.currency, Math.round(conv(e.amount, e.currency))));
    }
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + sections.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تقرير-مالي-شامل-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Excel export: all payments ────────────────────────────────────────────
  const exportPaymentsExcel = () => {
    const sarR = parseFloat(content['exchange.sar_to_egp'] || '13') || 13;
    const usdR = parseFloat(content['exchange.usd_to_egp'] || '50') || 50;
    const conv = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarR : amt * usdR;
    type PayRow = { date: string; client: string; service: string; amount: string; currency: string; egp: string; channel: string; staff: string; note: string; };
    const rows: PayRow[] = [];
    // manual payments
    for (const s of subscribers) {
      for (const p of (s.paymentHistory ?? []).filter(p => !p.status || p.status === 'paid')) {
        rows.push({ date: (p.at || '').slice(0, 10), client: s.name, service: p.paymentType || 'دفعة', amount: String(p.amount), currency: p.currency || 'EGP', egp: String(Math.round(conv(p.amount, p.currency || 'EGP'))), channel: p.paymentMethod || '—', staff: p.staffName || '—', note: p.note || '' });
      }
    }
    // online orders
    for (const o of orders.filter(x => x.status === 'paid')) {
      rows.push({ date: (o.paidAt || o.createdAt || '').slice(0, 10), client: o.customerName || '—', service: o.itemTitle || '—', amount: String(o.amount), currency: o.currency, egp: String(Math.round(conv(o.amount, o.currency))), channel: 'Paymob', staff: '—', note: o.transactionId ? '#' + o.transactionId : '' });
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    exportToExcel(rows, [
      { header: 'التاريخ', key: 'date', width: 12 },
      { header: 'العميل', key: 'client', width: 25 },
      { header: 'الخدمة', key: 'service', width: 20 },
      { header: 'المبلغ', key: 'amount', width: 12 },
      { header: 'العملة', key: 'currency', width: 8 },
      { header: 'بالجنيه', key: 'egp', width: 14 },
      { header: 'القناة', key: 'channel', width: 14 },
      { header: 'الموظف', key: 'staff', width: 18 },
      { header: 'ملاحظة', key: 'note', width: 25 },
    ], { filename: `المدفوعات-${new Date().toISOString().slice(0,10)}`, title: 'تقرير المدفوعات' });
  };

  // ── PDF export: expenses ──────────────────────────────────────────────────
  const exportExpensesPDF = () => {
    type ExpRow = { date: string; category: string; description: string; amount: string; currency: string; };
    const rows: ExpRow[] = expenses.map(e => ({ date: fmtDate(e.date), category: e.category, description: e.description, amount: fmtCurrency(e.amount, e.currency), currency: e.currency }));
    exportToPDF(rows, [
      { header: 'التاريخ', key: 'date', width: 14 },
      { header: 'الفئة', key: 'category', width: 16 },
      { header: 'الوصف', key: 'description', width: 40 },
      { header: 'المبلغ', key: 'amount', width: 18 },
    ], {
      filename: `المصروفات-${new Date().toISOString().slice(0,10)}`,
      title: 'تقرير المصروفات',
      subtitle: `إجمالي: ${expenses.length} بند`,
    });
  };

  const allPaymentHistoryEarly = subscribers.flatMap(s => s.paymentHistory ?? []);
  const pendingReviewCount = allPaymentHistoryEarly.filter(p => p.status === 'pending').length;
  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const [isMethodsEditing, setIsMethodsEditing] = useState(false);
  const [newMethodDraft, setNewMethodDraft] = useState('');
  const [incomeDraft, setIncomeDraft] = useState({
    subscriberId: '', amount: 0, currency: 'EGP' as 'EGP' | 'SAR' | 'USD',
    paymentType: 'course' as PaymentItemType, paymentMethod: '',
    transactionId: '', fromAccountNumber: '',
    date: new Date().toISOString().slice(0, 10), note: '',
    courseId: '', isInstallment: false,
  });

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
    setIncomeDraft({ subscriberId: '', amount: 0, currency: 'EGP', paymentType: 'course', paymentMethod: '', transactionId: '', fromAccountNumber: '', date: new Date().toISOString().slice(0, 10), note: '', courseId: '', isInstallment: false });
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

  // Helper: get payment method from entry (new field first, then scan note for compat)
  const DEFAULT_METHODS = ['خزنة الدقي', 'خزنة الفرع', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'احمد السعودية'];
  const PAYMENT_METHODS: string[] = content['finance.payment_methods']
    ? content['finance.payment_methods'].split('||').map(s => s.trim()).filter(Boolean)
    : DEFAULT_METHODS;
  const savePaymentMethods = (methods: string[]) =>
    setContentValue('finance.payment_methods', methods.join('||'));
  const getMethod = (p: { paymentMethod?: string; note?: string }) =>
    p.paymentMethod || PAYMENT_METHODS.find(m => (p.note || '').includes(m)) || '';

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
        <div className="flex gap-2 flex-wrap">
          {([['cockpit','🎯 لوحة القيادة',BarChart3],['budget','📊 الميزانية',TrendingDown],['refunds','↩️ الاسترجاعات',XCircle],['overview','نظرة مالية',BarChart3],['orders','الإيرادات',CreditCard],['expenses','المصروفات',Wallet],['pl','الأرباح والخسائر',PieChart],['installments','الأقساط والمديونيات',CalendarDays],['aging','تقرير التقادم',AlertCircle],['outstanding','أرصدة مستحقة',TrendingDown],['monthly','التقرير الشهري',BarChart3],['commissions','عمولات الفريق',Percent],['proofs','إيصالات التحويل',Receipt],['audit','سجل التدقيق',AlertCircle],['review','مراجعة الدفعات',Eye],['period_closing','إقفال الفترة',CheckCircle2]] as [string, string, React.ElementType][]).map(([k, lbl, Ic]) => (
            <button key={k} onClick={() => setFinancialSubTab(k as typeof financialSubTab)} className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${financialSubTab === k ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/30' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              <Ic size={15} />{lbl}{k === 'proofs' && pendingProofsCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pendingProofsCount}</span>}{k === 'review' && pendingReviewCount > 0 && <span className="bg-amber-500 text-white text-[10px] font-extrabold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pendingReviewCount}</span>}
            </button>
          ))}
        </div>
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
            onClick={() => { setIsIncomeFormOpen(true); setIncomeDraft({ subscriberId: '', amount: 0, currency: 'EGP', paymentType: 'course', paymentMethod: '', transactionId: '', fromAccountNumber: '', date: new Date().toISOString().slice(0, 10), note: '', courseId: '', isInstallment: false }); }}
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

      {/* Income modal */}
      {isIncomeFormOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsIncomeFormOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" dir="rtl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">إضافة دخل يدوي</h3>
            <p className="text-sm text-gray-500 mb-4">يُضاف للمشترك المحدد في سجل المدفوعات</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">العميل <span className="text-red-500">*</span></label>
                <select value={incomeDraft.subscriberId} onChange={(e) => setIncomeDraft({ ...incomeDraft, subscriberId: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر العميل —</option>
                  {[...subscribers].sort((a, b) => a.name.localeCompare(b.name, 'ar')).map((s) => (
                    <option key={s.id} value={s.id}>{s.name} {s.phone ? `(${s.phone})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">نوع الدفع</label>
                <select value={incomeDraft.paymentType} onChange={(e) => setIncomeDraft({ ...incomeDraft, paymentType: e.target.value as PaymentItemType })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {(Object.entries(paymentTypeLabels) as [PaymentItemType, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {incomeDraft.paymentType === 'course' && (
                <>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">الكورس (اختياري)</label>
                    <select value={incomeDraft.courseId} onChange={(e) => setIncomeDraft({ ...incomeDraft, courseId: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                      <option value="">— اختر كورس —</option>
                      {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={incomeDraft.isInstallment}
                      onChange={(e) => setIncomeDraft({ ...incomeDraft, isInstallment: e.target.checked })}
                      className="w-4 h-4 rounded accent-primary-600" />
                    <span className="text-sm text-gray-700">دفعة قسط (يُفتح 15 فيديو عند أول قسط)</span>
                  </label>
                </>
              )}
              <div>
                <label className="text-xs text-gray-600 mb-1 block">وسيلة الدفع</label>
                <select value={incomeDraft.paymentMethod} onChange={(e) => setIncomeDraft({ ...incomeDraft, paymentMethod: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">— اختر وسيلة الدفع —</option>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">رقم العملية</label>
                <input value={incomeDraft.transactionId} onChange={(e) => setIncomeDraft({ ...incomeDraft, transactionId: e.target.value })}
                  placeholder="رقم العملية / المرجع..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">رقم الحساب / المحفظة المحوَّل منه</label>
                <input value={incomeDraft.fromAccountNumber} onChange={(e) => setIncomeDraft({ ...incomeDraft, fromAccountNumber: e.target.value })}
                  placeholder="اختياري — مثال: 01012345678" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">المبلغ <span className="text-red-500">*</span></label>
                  <input type="number" min={0} value={incomeDraft.amount || ''}
                    onChange={(e) => setIncomeDraft({ ...incomeDraft, amount: Number(e.target.value) })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">العملة</label>
                  <select value={incomeDraft.currency} onChange={(e) => setIncomeDraft({ ...incomeDraft, currency: e.target.value as 'EGP' | 'SAR' | 'USD' })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="EGP">ج.م</option><option value="SAR">ر.س</option><option value="USD">$</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">التاريخ</label>
                <input type="date" value={incomeDraft.date} onChange={(e) => setIncomeDraft({ ...incomeDraft, date: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">ملاحظة</label>
                <input value={incomeDraft.note} onChange={(e) => setIncomeDraft({ ...incomeDraft, note: e.target.value })}
                  placeholder="مثال: دفعة أولى..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={handleAddIncome} disabled={!incomeDraft.subscriberId || !incomeDraft.amount}
                  className="flex-1 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-50">
                  حفظ الدخل
                </button>
                <button onClick={() => setIsIncomeFormOpen(false)} className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-xl text-sm hover:bg-gray-300">إلغاء</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {financialSubTab === 'cockpit' && (
        <FinancialCockpitPanel
          notify={(msg, t) => notify(t === 'error' ? 'error' : 'success', msg)}
          onNavigate={(tab) => {
            const dashboardTabs = ['leads', 'hr', 'daqqi_accounting', 'daqqi_schedule'];
            if (dashboardTabs.includes(tab)) onNavigateTab?.(tab);
            else setFinancialSubTab(tab as typeof financialSubTab);
          }}
        />
      )}

      {financialSubTab === 'budget' && (
        <FinancialBudgetPanel
          notify={(msg, t) => notify(t === 'error' ? 'error' : 'success', msg)}
        />
      )}

      {financialSubTab === 'refunds' && (
        <FinancialRefundsPanel
          notify={(msg, t) => notify(t === 'error' ? 'error' : 'success', msg)}
        />
      )}

      {financialSubTab === 'overview' && (
        <div className="space-y-5">
          {/* ── Date range filter ── */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center gap-3" dir="rtl">
            <CalendarDays size={16} className="text-primary-600 flex-shrink-0" />
            <span className="text-sm font-bold text-gray-700">فلتر الفترة الزمنية:</span>
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs text-gray-500">من</label>
              <input type="date" value={globalDateFrom} onChange={e => setGlobalDateFrom(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700" />
              <label className="text-xs text-gray-500">إلى</label>
              <input type="date" value={globalDateTo} onChange={e => setGlobalDateTo(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700" />
              {isGlobalFiltered && (
                <button onClick={() => { setGlobalDateFrom(''); setGlobalDateTo(''); }}
                  className="text-xs text-red-500 hover:text-red-700 font-bold border border-red-200 rounded-lg px-2 py-1 hover:bg-red-50 transition">
                  مسح الفلتر
                </button>
              )}
            </div>
            {isGlobalFiltered && (
              <span className="text-xs text-primary-600 font-bold bg-primary-50 border border-primary-200 rounded-lg px-2 py-1 mr-auto">
                عرض نتائج مفلترة
              </span>
            )}
          </div>

          {/* ── Export Toolbar ── */}
          <div className="flex flex-wrap items-center gap-2" dir="rtl">
            <span className="text-xs font-bold text-gray-500 ml-1">تصدير التقارير:</span>
            <button onClick={exportFullReport}
              className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-gray-800 border border-gray-300 hover:bg-gray-50 rounded-lg px-3 py-1.5 transition">
              <Download size={13} /> CSV شامل
            </button>
            <button onClick={exportPaymentsExcel}
              className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-900 border border-emerald-300 hover:bg-emerald-50 rounded-lg px-3 py-1.5 transition">
              <FileText size={13} /> Excel — المدفوعات
            </button>
            <button onClick={exportExpensesPDF}
              className="flex items-center gap-1.5 text-xs font-bold text-red-600 hover:text-red-800 border border-red-300 hover:bg-red-50 rounded-lg px-3 py-1.5 transition">
              <FileText size={13} /> PDF — المصروفات
            </button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { lbl: 'إجمالي الإيرادات', val: (isGlobalFiltered ? gRevenue : totalRevenueEGP).toLocaleString('ar-EG') + ' ج.م', icon: ArrowUpRight, bg: 'bg-emerald-50', txt: 'text-emerald-700', br: 'border-emerald-200' },
              { lbl: 'إجمالي المصروفات', val: (isGlobalFiltered ? gExpenses : totalExpensesEGP).toLocaleString('ar-EG') + ' ج.م', icon: ArrowDownRight, bg: 'bg-red-50', txt: 'text-red-700', br: 'border-red-200' },
              { lbl: 'صافي الربح', val: (isGlobalFiltered ? gProfit : netProfitEGP).toLocaleString('ar-EG') + ' ج.م', icon: TrendingUp, bg: (isGlobalFiltered ? gProfit : netProfitEGP) >= 0 ? 'bg-blue-50' : 'bg-orange-50', txt: (isGlobalFiltered ? gProfit : netProfitEGP) >= 0 ? 'text-blue-700' : 'text-orange-700', br: (isGlobalFiltered ? gProfit : netProfitEGP) >= 0 ? 'border-blue-200' : 'border-orange-200' },
              { lbl: 'هامش الربح', val: (isGlobalFiltered ? gMargin : profitMargin) + '%', icon: Percent, bg: 'bg-violet-50', txt: 'text-violet-700', br: 'border-violet-200' },
            ].map(c => { const Ic = c.icon; return (
              <article key={c.lbl} className={`${c.bg} border ${c.br} rounded-2xl p-4 flex items-center gap-3 shadow-sm`}>
                <div className={`w-10 h-10 rounded-xl ${c.bg} border ${c.br} flex items-center justify-center flex-shrink-0`}><Ic size={20} className={c.txt} /></div>
                <div><p className="text-xs text-gray-500">{c.lbl}</p><p className={`text-xl font-extrabold ${c.txt}`}>{c.val}</p></div>
              </article>
            );})}
          </div>
          {/* Revenue breakdown bars */}
          <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Receipt size={16} className="text-primary-600" />توزيع الإيرادات حسب النوع</h4>
            <div className="space-y-3">
              {([['كورسات', revenueByType.course, 'bg-primary-500'],['مسارات', revenueByType.bundle, 'bg-emerald-500'],['استشارات', revenueByType.consultation, 'bg-amber-500'],['شهادات', revenueByType.certificate, 'bg-orange-500'],['كتب', revenueByType.book, 'bg-teal-500'],['كارنيهات', revenueByType.carneh, 'bg-indigo-500'],['أخرى', revenueByType.other, 'bg-gray-400']] as [string, number, string][]).filter(([,v]) => v > 0).map(([lbl, val, color]) => {
                const pct = totalRevenueEGP > 0 ? Math.round((val / totalRevenueEGP) * 100) : 0;
                return (
                  <div key={lbl}>
                    <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">{lbl}</span><span className="text-gray-500">{val.toLocaleString('ar-EG')} ج.م ({pct}%)</span></div>
                    <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </article>
          {/* Expense breakdown */}
          <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><TrendingDown size={16} className="text-red-500" />توزيع المصروفات حسب الفئة</h4>
            {Object.keys(expenseByCategory).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">لا توجد مصروفات مسجّلة بعد</p>
            ) : (
              <div className="space-y-3">
                {(Object.entries(expenseByCategory) as [string, number][]).sort((a,b)=>b[1]-a[1]).map(([cat, val]) => {
                  const pct = totalExpensesEGP > 0 ? Math.round((val / totalExpensesEGP) * 100) : 0;
                  return (
                    <div key={cat}>
                      <div className="flex justify-between text-sm mb-1"><span className="font-medium text-gray-700">{cat}</span><span className="text-gray-500">{val.toLocaleString()} ج.م ({pct}%)</span></div>
                      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-red-400 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>
          {/* Payment method breakdown */}
          <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
              <h4 className="font-bold text-gray-800 flex items-center gap-2"><Wallet size={16} className="text-primary-600" />الخزنة ووسائل الدفع</h4>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 font-bold">الشهر:</label>
                <input type="month" value={vaultMonth} onChange={e => setVaultMonth(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-gray-700" />
                {vaultMonth !== currentMonth && (
                  <button onClick={() => setVaultMonth(currentMonth)} className="text-xs text-primary-600 hover:underline">الشهر الحالي</button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {/* Online Paymob card — filtered by month */}
              {onlineRevenueFiltered > 0 && (
                <button
                  onClick={() => { setFinancialSubTab('orders'); setOrderMethodFilter('__online_paymob__'); }}
                  className="bg-blue-50 border border-blue-200 hover:border-blue-400 hover:bg-blue-100 rounded-2xl p-4 text-right transition group">
                  <p className="text-xs text-blue-600 font-bold mb-1">🌐 أونلاين (Paymob)</p>
                  <p className="text-xl font-extrabold text-blue-800">{Math.round(onlineRevenueFiltered).toLocaleString('ar-EG')} ج.م</p>
                  <p className="text-[10px] text-blue-500 mt-1 group-hover:text-blue-700">بطاقة / محفظة ← اضغط للتفاصيل</p>
                </button>
              )}
              {/* Manual payment channels — filtered by month */}
              {(Object.entries(revenueByMethodFiltered) as [string, number][]).sort((a,b)=>b[1]-a[1]).map(([method, total]) => (
                <button key={method}
                  onClick={() => { setFinancialSubTab('orders'); setOrderMethodFilter(method); }}
                  className="bg-emerald-50 border border-emerald-200 hover:border-emerald-400 hover:bg-emerald-100 rounded-2xl p-4 text-right transition group">
                  <p className="text-xs text-emerald-600 font-bold mb-1">{method}</p>
                  <p className="text-xl font-extrabold text-emerald-800">{Math.round(total).toLocaleString('ar-EG')} ج.م</p>
                  <p className="text-[10px] text-emerald-500 mt-1 group-hover:text-emerald-700">اضغط لعرض التفاصيل ←</p>
                </button>
              ))}
              {onlineRevenueFiltered === 0 && Object.keys(revenueByMethodFiltered).length === 0 && (
                <p className="col-span-3 text-sm text-gray-400 text-center py-4">لا توجد مدفوعات في {vaultMonth}</p>
              )}
            </div>
          </article>

          {/* ── Manage Payment Methods ── */}
          <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-gray-800 flex items-center gap-2"><CreditCard size={16} className="text-primary-600" />إدارة وسائل الدفع والخزن</h4>
              <button onClick={() => setIsMethodsEditing(v => !v)}
                className={`text-sm font-bold px-3 py-1.5 rounded-xl transition ${isMethodsEditing ? 'bg-gray-200 text-gray-700' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                {isMethodsEditing ? 'إغلاق' : '+ تعديل / إضافة'}
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {PAYMENT_METHODS.map(m => (
                <div key={m} className="flex items-center gap-1 bg-gray-100 rounded-xl px-3 py-1.5 text-sm font-bold text-gray-700">
                  {m}
                  {isMethodsEditing && (
                    <button onClick={() => savePaymentMethods(PAYMENT_METHODS.filter(x => x !== m))}
                      className="mr-1 text-red-400 hover:text-red-600 font-bold leading-none" title="حذف">×</button>
                  )}
                </div>
              ))}
            </div>
            {isMethodsEditing && (
              <div className="flex gap-2" dir="rtl">
                <input
                  value={newMethodDraft}
                  onChange={e => setNewMethodDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newMethodDraft.trim() && !PAYMENT_METHODS.includes(newMethodDraft.trim())) {
                      savePaymentMethods([...PAYMENT_METHODS, newMethodDraft.trim()]);
                      setNewMethodDraft('');
                    }
                  }}
                  placeholder="اسم الخزنة أو وسيلة الدفع الجديدة..."
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm"
                />
                <button
                  onClick={() => {
                    const t = newMethodDraft.trim();
                    if (!t || PAYMENT_METHODS.includes(t)) return;
                    savePaymentMethods([...PAYMENT_METHODS, t]);
                    setNewMethodDraft('');
                  }}
                  disabled={!newMethodDraft.trim() || PAYMENT_METHODS.includes(newMethodDraft.trim())}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 transition">
                  إضافة
                </button>
              </div>
            )}
          </article>

          {/* ── Revenue per Course ── */}
          {revenueByCourse.length > 0 && (
            <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-gray-800 flex items-center gap-2"><BarChart3 size={16} className="text-primary-600" />الإيرادات لكل كورس</h4>
                <button
                  onClick={() => exportCSV(
                    'revenue-by-course.csv',
                    revenueByCourse.map(c => [c.title, String(c.online), String(c.manual), String(c.total)]),
                    ['الكورس', 'أونلاين (ج.م)', 'يدوي (ج.م)', 'الإجمالي (ج.م)']
                  )}
                  className="flex items-center gap-1.5 text-xs font-bold text-primary-600 hover:text-primary-800 border border-primary-200 hover:bg-primary-50 rounded-lg px-2 py-1 transition">
                  <Download size={13} /> تصدير CSV
                </button>
              </div>
              <div className="space-y-3">
                {revenueByCourse.map(c => {
                  const pct = revenueByCourse[0].total > 0 ? Math.round((c.total / revenueByCourse[0].total) * 100) : 0;
                  return (
                    <div key={c.id}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-700 truncate max-w-[55%]">{c.title}</span>
                        <span className="text-gray-500 whitespace-nowrap">{c.total.toLocaleString('ar-EG')} ج.م</span>
                      </div>
                      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-primary-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
                      {(c.online > 0 || c.manual > 0) && (
                        <div className="flex gap-4 mt-1">
                          {c.online > 0 && <span className="text-[10px] text-blue-500">أونلاين: {c.online.toLocaleString('ar-EG')} ج.م</span>}
                          {c.manual > 0 && <span className="text-[10px] text-emerald-500">يدوي: {c.manual.toLocaleString('ar-EG')} ج.م</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          )}
        </div>
      )}
      {financialSubTab === 'orders' && (
        <FinancialOrdersPanel
          paidOrders={paidOrders}
          subscribers={subscribers}
          onlineRevenueEGP={onlineRevenueEGP}
          manualRevenueEGP={manualRevenueEGP}
          totalRevenueEGP={totalRevenueEGP}
          initialMethodFilter={orderMethodFilter}
        />
      )}

      {/* Expenses sub-tab */}
      {financialSubTab === 'expenses' && (
        <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-bold text-gray-800 flex items-center gap-2"><Wallet size={16} className="text-red-500" />سجل المصروفات</h4>
            <button onClick={() => { setIsExpenseFormOpen(v => !v); setEditingExpenseId(''); setExpenseDraft({ category: 'أخرى', description: '', amount: 0, currency: 'EGP', date: new Date().toISOString().slice(0,10), receiptUrl: '' }); }} className="flex items-center gap-1.5 bg-primary-600 text-white px-3 py-2 rounded-xl text-sm font-bold"><Plus size={14}/>{isExpenseFormOpen ? 'إغلاق' : 'إضافة مصروف'}</button>
          </div>
          {isExpenseFormOpen && (
            <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <select className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.category} onChange={e => setExpenseDraft(d => ({...d, category: e.target.value as ExpenseItem['category']}))}>
                  {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
                </select>
                <input type="number" min={0} placeholder="المبلغ" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.amount || ''} onChange={e => setExpenseDraft(d => ({...d, amount: +e.target.value}))} />
                <select className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.currency} onChange={e => setExpenseDraft(d => ({...d, currency: e.target.value as 'EGP'|'SAR'|'USD'}))}>
                  <option value="EGP">ج.م (EGP)</option><option value="SAR">ر.س (SAR)</option><option value="USD">$ (USD)</option>
                </select>
                <input type="date" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.date} onChange={e => setExpenseDraft(d => ({...d, date: e.target.value}))} />
                <input placeholder="رابط الإيصال (اختياري)" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.receiptUrl || ''} onChange={e => setExpenseDraft(d => ({...d, receiptUrl: e.target.value}))} />
                <input placeholder="وصف المصروف *" className="border border-gray-300 rounded-xl px-3 py-2" value={expenseDraft.description} onChange={e => setExpenseDraft(d => ({...d, description: e.target.value}))} />
              </div>
              <button
                onClick={() => {
                  if (!expenseDraft.description || expenseDraft.amount <= 0) return;
                  const now = new Date().toISOString();
                  if (editingExpenseId) {
                    updateExpense({ ...expenseDraft, id: editingExpenseId, createdAt: now });
                    setEditingExpenseId('');
                  } else {
                    addExpense({ ...expenseDraft, id: `exp-${Date.now()}`, createdAt: now });
                  }
                  setIsExpenseFormOpen(false);
                }}
                className="bg-primary-600 text-white px-5 py-2 rounded-xl font-bold"
              >{editingExpenseId ? 'تحديث' : 'إضافة مصروف'}</button>
            </div>
          )}
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <select className="border border-gray-300 rounded-xl px-3 py-2 text-sm" value={expenseCategoryFilter} onChange={e => setExpenseCategoryFilter(e.target.value)}>
              <option value="all">كل الفئات</option>
              {EXPENSE_CATS.map(c => <option key={c}>{c}</option>)}
            </select>
            <input type="date" className="border border-gray-300 rounded-xl px-3 py-2 text-sm" value={expenseDateFrom} onChange={e => setExpenseDateFrom(e.target.value)} />
            <input type="date" className="border border-gray-300 rounded-xl px-3 py-2 text-sm" value={expenseDateTo} onChange={e => setExpenseDateTo(e.target.value)} />
            <div className="mr-auto flex items-center gap-3 flex-wrap">
              <span className="text-sm text-gray-500">المجموع: <span className="font-bold text-red-600">{filteredExpenses.reduce((s,e)=>s+toEGP(e.amount,e.currency),0).toLocaleString('ar-EG')} ج.م</span></span>
              <button
                onClick={() => exportCSV(
                  'expenses.csv',
                  filteredExpenses.map(e => [e.category, e.description, String(e.amount), e.currency, e.date]),
                  ['الفئة', 'الوصف', 'المبلغ', 'العملة', 'التاريخ']
                )}
                className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl px-3 py-1.5 text-xs font-bold transition">
                <Download size={13} /> تصدير CSV
              </button>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-right border-b border-gray-100"><th className="py-2">الفئة</th><th className="py-2">الوصف</th><th className="py-2">المبلغ</th><th className="py-2">التاريخ</th><th className="py-2">إجراءات</th></tr></thead>
            <tbody>
              {filteredExpenses.map(e => (
                <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-2.5"><span className="bg-red-50 text-red-700 text-xs px-2 py-0.5 rounded-full border border-red-200">{e.category}</span></td>
                  <td className="py-2.5 text-gray-700">{e.description}</td>
                  <td className="py-2.5 font-bold text-red-600">{e.amount} {e.currency}</td>
                  <td className="py-2.5 text-gray-500 text-xs">{e.date}</td>
                  <td className="py-2.5 flex gap-2">
                    <button onClick={() => { setExpenseDraft({category:e.category,description:e.description,amount:e.amount,currency:e.currency,date:e.date,receiptUrl:e.receiptUrl||''}); setEditingExpenseId(e.id); setIsExpenseFormOpen(true); }} className="text-primary-600 text-xs font-bold">تعديل</button>
                    <button onClick={() => deleteExpense(e.id)} className="text-red-500 text-xs">حذف</button>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 && (<tr><td colSpan={5} className="py-6 text-center text-gray-400">لا توجد مصروفات مطابقة للفلاتر</td></tr>)}
            </tbody>
          </table>
        </article>
      )}

      {/* P&L sub-tab */}
      {financialSubTab === 'pl' && (
        <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h4 className="font-bold text-gray-800 flex items-center gap-2"><PieChart size={16} className="text-primary-600" />تقرير الأرباح والخسائر {isGlobalFiltered && <span className="text-xs bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full border border-primary-200">مفلتر</span>}</h4>
            <div className="flex gap-2">
              <button onClick={() => setFinancialSubTab('overview')}
                className="flex items-center gap-1.5 text-xs font-bold text-gray-600 hover:text-primary-700 border border-gray-200 hover:bg-gray-50 rounded-lg px-2 py-1 transition">
                <FileText size={13} /> تغيير الفترة
              </button>
              <button
                onClick={() => {
                  const w = window.open('', '_blank', 'width=720,height=960');
                  if (!w) return;
                  const rev = isGlobalFiltered ? gRevenue : totalRevenueEGP;
                  const exp = isGlobalFiltered ? gExpenses : totalExpensesEGP;
                  const profit = isGlobalFiltered ? gProfit : netProfitEGP;
                  const margin = isGlobalFiltered ? gMargin : profitMargin;
                  const period = (globalDateFrom || globalDateTo)
                    ? `${globalDateFrom || '—'} إلى ${globalDateTo || '—'}`
                    : 'الكل';
                  w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>تقرير الأرباح والخسائر</title><style>body{font-family:Arial,sans-serif;padding:48px;direction:rtl;color:#111}.title{font-size:22px;font-weight:900;color:#7c3aed;border-bottom:3px solid #7c3aed;padding-bottom:12px;margin-bottom:24px}.section{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px}.section h3{font-size:15px;font-weight:700;margin-bottom:12px}.row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid #f3f4f6}.row:last-child{border:none;font-weight:700;font-size:15px}.profit{background:#eff6ff;border-color:#bfdbfe;border-radius:12px;padding:16px;display:flex;justify-content:space-between;align-items:center}.profit-label{font-size:18px;font-weight:900;color:#1d4ed8}.profit-value{font-size:24px;font-weight:900;color:#2563eb}.meta{color:#888;font-size:12px;text-align:center;margin-top:32px}@media print{body{padding:24px}}</style></head><body><div class="title">تقرير الأرباح والخسائر</div><p style="color:#888;font-size:13px;margin-bottom:24px">الفترة: ${period} &nbsp;|&nbsp; تاريخ الطباعة: ${today}</p><div class="section" style="background:#f0fdf4;border-color:#bbf7d0"><h3 style="color:#166534">الإيرادات</h3>${Object.entries(revenueByType).map(([k,v])=>v>0?`<div class="row"><span>${{course:'كورسات',bundle:'مسارات',consultation:'استشارات',certificate:'شهادات',book:'كتب',carneh:'كارنيهات',other:'أخرى'}[k]||k}</span><span>${Number(v).toLocaleString('ar-EG')} ج.م</span></div>`:'').join('')}<div class="row" style="margin-top:8px"><span>إجمالي الإيرادات</span><span>${rev.toLocaleString('ar-EG')} ج.م</span></div></div><div class="section" style="background:#fff1f2;border-color:#fecdd3"><h3 style="color:#9f1239">المصروفات</h3>${Object.entries(expenseByCategory).map(([k,v])=>`<div class="row"><span>${k}</span><span>(${Number(v).toLocaleString('ar-EG')} ج.م)</span></div>`).join('')}<div class="row" style="margin-top:8px"><span>إجمالي المصروفات</span><span>(${exp.toLocaleString('ar-EG')} ج.م)</span></div></div><div class="profit"><span class="profit-label">صافي ${profit>=0?'الربح':'الخسارة'}</span><span class="profit-value">${Math.abs(profit).toLocaleString('ar-EG')} ج.م</span></div><p style="text-align:center;color:#7c3aed;font-size:12px;margin-top:8px">هامش الربح: ${margin}%</p><div class="meta">معهد الدراسات النفسية — mahadnafsy.com</div></body></html>`);
                  w.document.close();
                  setTimeout(() => w.print(), 500);
                }}
                className="flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-3 py-1.5 text-xs font-bold transition">
                <FileText size={13} /> طباعة PDF
              </button>
            </div>
          </div>
          <div className="max-w-lg mx-auto space-y-0">
            {/* Revenue section */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-t-2xl p-4">
              <p className="text-emerald-700 font-bold text-lg mb-3 flex items-center gap-2"><ArrowUpRight size={18}/>الإيرادات</p>
              <div className="space-y-2 text-sm">
                {([['كورسات', revenueByType.course],['مسارات', revenueByType.bundle],['استشارات', revenueByType.consultation],['شهادات', revenueByType.certificate],['كتب', revenueByType.book],['كارنيهات', revenueByType.carneh],['أخرى', revenueByType.other]] as [string,number][]).filter(([,v])=>v>0).map(([lbl,val])=>(
                  <div key={lbl} className="flex justify-between"><span className="text-emerald-700">{lbl}</span><span className="font-semibold">{val.toLocaleString('ar-EG')} ج.م</span></div>
                ))}
              </div>
              <div className="border-t border-emerald-300 mt-3 pt-3 flex justify-between font-extrabold text-emerald-800 text-base">
                <span>إجمالي الإيرادات</span><span>{(isGlobalFiltered ? gRevenue : totalRevenueEGP).toLocaleString('ar-EG')} ج.م</span>
              </div>
            </div>
            {/* Expense section */}
            <div className="bg-red-50 border border-red-200 border-t-0 p-4">
              <p className="text-red-700 font-bold text-lg mb-3 flex items-center gap-2"><ArrowDownRight size={18}/>المصروفات</p>
              <div className="space-y-2 text-sm">
                {(Object.entries(expenseByCategory) as [string, number][]).sort((a,b)=>b[1]-a[1]).map(([cat,val])=>(
                  <div key={cat} className="flex justify-between"><span className="text-red-700">{cat}</span><span className="font-semibold">({val.toLocaleString()} ج.م)</span></div>
                ))}
                {Object.keys(expenseByCategory).length === 0 && <p className="text-red-400 text-xs">لا توجد مصروفات مسجّلة</p>}
              </div>
              <div className="border-t border-red-300 mt-3 pt-3 flex justify-between font-extrabold text-red-800 text-base">
                <span>إجمالي المصروفات</span><span>({(isGlobalFiltered ? gExpenses : totalExpensesEGP).toLocaleString('ar-EG')} ج.م)</span>
              </div>
            </div>
            {/* Net profit */}
            {(() => { const p = isGlobalFiltered ? gProfit : netProfitEGP; const m = isGlobalFiltered ? gMargin : profitMargin; return (
            <div className={`border rounded-b-2xl border-t-0 p-5 ${p >= 0 ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
              <div className="flex justify-between items-center">
                <span className={`font-extrabold text-xl ${p >= 0 ? 'text-blue-800' : 'text-orange-800'}`}>صافي {p >= 0 ? 'الربح' : 'الخسارة'}</span>
                <span className={`font-extrabold text-2xl ${p >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{Math.abs(p).toLocaleString('ar-EG')} ج.م</span>
              </div>
              <p className={`text-sm mt-1 ${p >= 0 ? 'text-blue-600' : 'text-orange-600'}`}>هامش الربح: {m}%</p>
            </div>
            );})()}
          </div>
        </article>
      )}

      {/* ─── Installments sub-tab ─── */}
      {financialSubTab === 'installments' && (
        <FinancialInstallmentsPanel notify={notify} subscribers={subscribers} />
      )}

      {/* ─── Monthly Report sub-tab ─── */}
      {financialSubTab === 'monthly' && (
        <FinancialMonthlyPanel paidOrders={paidOrders} allManualPayments={allManualPayments} sarRate={sarRate} usdRate={usdRate} />
      )}

      {/* ─── Commissions sub-tab ─── */}
      {financialSubTab === 'commissions' && (
        <FinancialCommissionsPanel subscribers={subscribers} />
      )}

      {/* ─── Payment Proofs sub-tab ─── */}
      {financialSubTab === 'proofs' && (
        <FinancialProofsPanel notify={notify} subscribers={subscribers} updateSubscriber={updateSubscriber} staffMembers={staffMembers} authUser={authUser ?? null} onPendingCountChange={setPendingProofsCount} />
      )}

      {/* ─── Aging Report Tab ─── */}
      {financialSubTab === 'aging' && (
        <FinancialAgingPanel subscribers={subscribers} sarRate={sarRate} usdRate={usdRate} />
      )}

      {/* ─── Outstanding Balances Tab ─── */}
      {financialSubTab === 'outstanding' && <OutstandingPanel notify={notify} />}

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
