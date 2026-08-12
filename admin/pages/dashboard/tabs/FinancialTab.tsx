import React, { useMemo, useState } from 'react';
import {
  Plus, TrendingUp,
} from 'lucide-react';
import { FinancialSubTabs } from './financial/FinancialSubTabs';
import { FinancialOrdersControls } from './financial/FinancialOrdersControls';
import { FinancialOrdersTable } from './financial/FinancialOrdersTable';
import { useFinancialCommissionsData } from './financial/useFinancialCommissionsData';
import { useFinancialOrdersData } from './financial/useFinancialOrdersData';
import { usePaymentProofsReview } from './financial/usePaymentProofsReview';
import { exportCSV, exportExpensesPdfReport, exportFullFinancialReport, exportPaymentsExcelReport } from './financial/financialExports';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { PaymentHistoryEntry, ExpenseItem } from '../../../types';
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
const FinanceAdvancesPanel = React.lazy(() => import('./hr-sections/HrAdvancesPanel'));
const FinanceOperationsPanel = React.lazy(() => import('./financial/FinanceOperationsPanel'));

export default function FinancialTab({ notify, branchFilter }: { notify: NotifyFn; branchFilter?: string }) {
  const {
    orders: _allOrders, subscribers: _allSubscribers, recordSubscriberPayment, reloadSubscribers, staffMembers,
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
    notify,
    reloadSubscribers,
    branchFilter,
  });

  // ── FX rates refresh ──
  const [fxRefreshing, setFxRefreshing] = useState(false);
  const refreshFxRates = async () => {
    setFxRefreshing(true);
    try {
      const r = await mysqlAdmin.adminPost<{ ok: boolean; sar_to_egp: number; usd_to_egp: number }>('/admin/fx-rates/refresh', {});
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
  type LedgerPnl = { totalRevenue: number; totalExpenses: number; netProfit: number; margin: number };
  const [ledgerAllPnl, setLedgerAllPnl] = useState<LedgerPnl | null>(null);
  const [ledgerFilteredPnl, setLedgerFilteredPnl] = useState<LedgerPnl | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  React.useEffect(() => {
    let active = true;
    setLedgerLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const filteredFrom = globalDateFrom || '2000-01-01';
    const filteredTo = globalDateTo || today;
    Promise.all([
      mysqlAdmin.getFinancialPnl('2000-01-01', today, branchFilter || undefined),
      mysqlAdmin.getFinancialPnl(filteredFrom, filteredTo, branchFilter || undefined),
    ]).then(([allPnl, filteredPnl]) => {
      if (!active) return;
      setLedgerAllPnl(allPnl);
      setLedgerFilteredPnl(filteredPnl);
    }).catch(() => {
      if (!active) return;
      setLedgerAllPnl(null);
      setLedgerFilteredPnl(null);
    }).finally(() => {
      if (active) setLedgerLoading(false);
    });
    return () => { active = false; };
  }, [branchFilter, globalDateFrom, globalDateTo]);

  // ── Orders tab extra filters ──
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDateFrom, setOrderDateFrom] = useState('');
  const [orderDateTo, setOrderDateTo] = useState('');
  const [orderTypeFilter, setOrderTypeFilter] = useState('');
  const [ordersPage, setOrdersPage] = useState(1);
  const ORDERS_PAGE_SIZE = 50;

  const exportFullReport = () => {
    if (!ledgerAllPnl) return notify('error', 'تعذر التصدير: دفتر الأستاذ غير متاح.');
    try {
      exportFullFinancialReport({ content, orders, subscribers, expenses, officialTotals: ledgerAllPnl });
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تصدير التقرير المالي.');
    }
  };
  const exportPaymentsExcel = () => {
    try { exportPaymentsExcelReport({ content, orders, subscribers }); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تصدير المدفوعات.'); }
  };
  const exportExpensesPDF = () => exportExpensesPdfReport(expenses);

  const allPaymentHistoryEarly = subscribers.flatMap(s => s.paymentHistory ?? []);
  const pendingReviewCount = allPaymentHistoryEarly.filter(p => p.status === 'pending').length;
  const [orderMethodFilter, setOrderMethodFilter] = useState('');
  const [isIncomeFormOpen, setIsIncomeFormOpen] = useState(false);
  const [commissionMonth, setCommissionMonth] = useState(new Date().toISOString().slice(0, 7));
  const [commissionFrom, setCommissionFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return d.toISOString().slice(0, 7); });
  const [commissionTo, setCommissionTo] = useState(new Date().toISOString().slice(0, 7));
  const [commissionViewMode, setCommissionViewMode] = useState<'single' | 'range'>('single');
  const [dbPayments, setDbPayments] = useState<Array<{ id: string; subscriberId: string; subscriberName: string; amount: number; currency: string; paymentType: string; paymentMethod: string | null; transactionId: string | null; note: string | null; at: string; isInstallment: boolean; status?: string }> | null>(null);
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

  const handleAddIncome = async () => {
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
    try {
      const result = await recordSubscriberPayment(sub.id, entry as unknown as Record<string, unknown>);
      notify(
        'success',
        result.approvalRequired
          ? 'تم تسجيل الدفعة كمعلّقة وتنتظر اعتماد الإدارة المالية.'
          : 'تم تسجيل الدخل وحفظ القيد المحاسبي بنجاح.',
      );
      setIsIncomeFormOpen(false);
      setIncomeDraft(createBlankIncomeDraft());
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الدفعة.');
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const subscribersWithPlans = subscribers.filter(s => (s.installmentPlans?.length ?? 0) > 0);

  const fxUpdatedAt = new Date(content['exchange.updated_at'] || '').getTime();
  const fxFresh = Number.isFinite(fxUpdatedAt)
    && fxUpdatedAt <= Date.now()
    && Date.now() - fxUpdatedAt <= 48 * 3600000;
  const sarRate = fxFresh ? Number(content['exchange.sar_to_egp']) || 0 : 0;
  const usdRate = fxFresh ? Number(content['exchange.usd_to_egp']) || 0 : 0;
  const toEGP = (amt: number, cur: string) => cur === 'EGP' ? amt : cur === 'SAR' ? amt * sarRate : amt * usdRate;
  const paidOrders = orders.filter(o => o.status === 'paid' && (o.paymentMethod === 'card' || o.paymentMethod === 'wallet' || o.paymentMethod === 'online_paymob' || (o as unknown as Record<string,unknown>)['source'] !== 'crm'));
  const paidOrderRefs = new Set<string>();
  paidOrders.forEach(order => {
    paidOrderRefs.add(String(order.id));
    if (order.transactionId) paidOrderRefs.add(String(order.transactionId));
  });
  // All paymentHistory entries across subscribers — only confirmed/paid entries count toward revenue
  const allPaymentHistory = subscribers.flatMap(s => s.paymentHistory ?? []);
  // Truly manual payments: only paid status, exclude Paymob online entries (already in paidOrders above)
  const allManualPayments = allPaymentHistory.filter(p =>
    (!p.status || p.status === 'paid') &&
    !String(p.paymentMethod || '').toLowerCase().includes('paymob') &&
    !paidOrderRefs.has(String(p.id)) &&
    !(p.transactionId && paidOrderRefs.has(String(p.transactionId)))
  );
  const onlineRevenueEGP = paidOrders.reduce((s, o) => s + toEGP(o.amount, o.currency), 0);
  const manualRevenueEGP = allManualPayments.reduce((s, p) => s + toEGP(p.amount, p.currency), 0);
  // Official financial statements are ledger-only. Never replace an unavailable
  // ledger with browser-derived order/payment totals that can diverge by role.
  const totalRevenueEGP = ledgerAllPnl?.totalRevenue ?? 0;
  const totalExpensesEGP = ledgerAllPnl?.totalExpenses ?? 0;
  const netProfitEGP = ledgerAllPnl?.netProfit ?? 0;
  const profitMargin = ledgerAllPnl?.margin ?? 0;

  // ── فلتر فترة زمنية للنظرة العامة / الأرباح والخسائر ──
  const isGlobalFiltered = !!(globalDateFrom || globalDateTo);
  const gRevenue = ledgerFilteredPnl?.totalRevenue ?? 0;
  const gExpenses = ledgerFilteredPnl?.totalExpenses ?? 0;
  const gProfit = ledgerFilteredPnl?.netProfit ?? 0;
  const gMargin = ledgerFilteredPnl?.margin ?? 0;

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
            <span className={`font-bold ${fxFresh ? 'text-gray-800' : 'text-red-600'}`}>{fxFresh ? `${sarRate} ج.م` : 'غير متاح'}</span>
            <span className="text-gray-400">|</span>
            <span className="text-gray-500">$ =</span>
            <span className={`font-bold ${fxFresh ? 'text-gray-800' : 'text-red-600'}`}>{fxFresh ? `${usdRate} ج.م` : 'غير متاح'}</span>
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
          branch={branchFilter || undefined}
          onNavigate={(tab) => {
            if (tab === 'proofs' && !allProofs) loadAllProofs();
            setFinancialSubTab(tab as typeof financialSubTab);
          }}
        />
      )}

      {financialSubTab === 'budget' && (
        <FinancialBudgetPanel notify={notifyLegacy} branch={branchFilter || undefined} />
      )}

      {financialSubTab === 'refunds' && (
        <FinancialRefundsPanel notify={notifyLegacy} branch={branchFilter || undefined} />
      )}

      {financialSubTab === 'advances' && (
        <FinanceAdvancesPanel notify={notify} canDisburse financeMode />
      )}

      {financialSubTab === 'operations' && (
        <FinanceOperationsPanel notify={notifyLegacy} branch={branchFilter} />
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
          paymentMethods={PAYMENT_METHODS}
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
          notify={notify}
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
          today={today}
          toEGP={toEGP}
          exportCSV={exportCSV}
        />
      )}
      {!ledgerLoading && (!ledgerAllPnl || !ledgerFilteredPnl) && (
        <div className="rounded-2xl border border-red-300 bg-red-50 px-5 py-3 text-sm text-red-800">
          تعذر تحميل الدفتر المحاسبي. تم إيقاف عرض الإجماليات الرسمية بدل استخدام أرقام محلية غير معتمدة. أعد المحاولة بعد استعادة اتصال الـAPI/قاعدة البيانات.
        </div>
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
        <AgingReportPanel branchFilter={branchFilter} toEGP={toEGP} exportCSV={exportCSV} />
      )}

      {/* ─── Outstanding Balances Tab ─── */}
      {financialSubTab === 'outstanding' && <OutstandingPanel notify={notify} />}

      {financialSubTab === 'reconciliation' && <ReconciliationPanel branchFilter={branchFilter} />}

      {/* ── Audit Log ─────────────────────────────────────────────────── */}
      {financialSubTab === 'audit' && <AuditLogPanel />}

      {financialSubTab === 'review' && <PaymentReviewPanel notify={notify} branchFilter={branchFilter} subscribers={subscribers} reloadSubscribers={reloadSubscribers} actorEmail={authUser?.email} sarRate={sarRate} usdRate={usdRate} />}

      {/* ── Period Closing ──────────────────────────────────────────────── */}
      {financialSubTab === 'period_closing' && (
        <PeriodClosingPanel notify={notify} />
      )}
    </div>
  );
}
