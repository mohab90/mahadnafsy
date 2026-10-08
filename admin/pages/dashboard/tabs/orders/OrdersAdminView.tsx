// The full orders and payments desk: review, accepted, failed, transfers.
import { cairoDateOnly, cairoMonthOnly, cairoDay, cairoDaysAgo, cairoWeekStart } from '../../../../../shared/cairoDate';
import { CheckCircle, Clock, CreditCard, Download, Pencil, Plus, Search, TrendingUp, Trash2, Wallet, XCircle } from 'lucide-react';
import { useState } from 'react';
import { PaymentCorrectionModal } from '../../../../components/PaymentCorrectionModal';
import { toEgp } from '../../../../lib/money';
import { paymentMethodLabel, normalizePaymentMethod } from '../../../../../shared/paymentMethods';
import { CAIRO_TIME_ZONE } from '../../../../../shared/cairoDate';
import { BRANCH_LABELS_AR, normalizeBranch } from '../../../../constants/branches';
import { AddTransferModal, IncomingTransfersTable, type IncomingTransfer } from './IncomingTransfers';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { transferMatch } from '../../../../../shared/transferSheet';
import { ORDER_METHOD_FILTERS } from './ordersTypes';
import type { OrdersTabProps } from './ordersTypes';
import type { OrderItem } from '../../../../types';
import type { OrderActions } from './useOrderActions';

export function OrdersAdminView({ props, actions }: { props: OrdersTabProps; actions: OrderActions }) {
  const { isAdmin, canManageFinancial, notify, courses, bundles, effectiveOrders, filteredOrders, ordersStats, orderSearch, setOrderSearch, setOrderStatusFilter, orderTypeFilter, setOrderTypeFilter, orderMethodFilter, setOrderMethodFilter, orderDateFrom, setOrderDateFrom, orderDateTo, setOrderDateTo, orderStaffFilter, setOrderStaffFilter, orderReviewTab, setOrderReviewTab, showAddTransfer, setShowAddTransfer, linkTransferModal, setLinkTransferModal, linkOrderModal, setLinkOrderModal, deleteOrder, reloadOrders, reloadSubscribers, exportFilteredOrdersCsv } = props;
  const { paymentBoxes, navigate, ledger, linkQuery, setLinkQuery, matchesQuery, approveMethod, setApproveMethod, canAcceptDirectly, isDeskPayment, storedMethodOf, handleConfirmOrder, handleRejectOrder, confirmWithTransfer } = actions;
  // A recorded payment is voided or corrected by a manager through the payments
  // route, which reverses its books; the orders route only archives an unpaid order.
  const [correcting, setCorrecting] = useState<{ row: OrderItem; mode: 'edit' | 'void' } | null>(null);
  // A transfer a manager corrects (canAcceptDirectly is the manager's line).
  const [editingTransfer, setEditingTransfer] = useState<IncomingTransfer | null>(null);
  const deleteTransfer = async (transfer: IncomingTransfer) => {
    if (!await confirmDialog(`حذف تحويل ${Number(transfer.amount).toLocaleString('ar-EG-u-nu-latn')} ${transfer.currency} رقم ${transfer.reference || '—'}؟ بيتسجل في سجل المراجعة.`)) return;
    try {
      await mysqlAdmin.adminDelete(`/admin/incoming-transfers/${encodeURIComponent(transfer.id)}`);
      notify('success', 'اتحذف التحويل');
      await ledger.reload();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر حذف التحويل'); }
  };
              const todayStr     = cairoDateOnly();
              const thisMonthStr = cairoMonthOnly();
              const toEGP = (r: { amount: number; currency?: string }) =>
                toEgp(r.amount, r.currency);

              const paidAll    = effectiveOrders.filter(r => r.status === 'paid');
              const pendingAll = effectiveOrders.filter(r => r.status === 'pending');
              const failedAll  = effectiveOrders.filter(r => r.status === 'failed' || r.status === 'refunded');

              const todayRevEGP  = paidAll.filter(r => cairoDay(r.createdAt) === todayStr).reduce((s, r) => s + toEGP(r), 0);
              const monthRevEGP  = paidAll.filter(r => cairoDay(r.createdAt).startsWith(thisMonthStr)).reduce((s, r) => s + toEGP(r), 0);

              // last 7 days daily revenue for mini-chart
              const last7 = Array.from({ length: 7 }, (_, i) => {
                const ds = cairoDaysAgo(6 - i);
                const rev = paidAll.filter(r => cairoDay(r.createdAt) === ds).reduce((s, r) => s + toEGP(r), 0);
                const label = new Date(ds).toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'short', timeZone: CAIRO_TIME_ZONE });
                return { ds, rev, label };
              });
              const maxRev = Math.max(...last7.map(d => d.rev), 1);

              // unique staff names for filter
              const staffNames = Array.from(new Set(effectiveOrders.map(r => r.staffName).filter(Boolean))) as string[];

              const tabRows = orderReviewTab === 'review'
                ? filteredOrders.filter(r => r.status === 'pending' && r.type !== 'transfer')
                : orderReviewTab === 'accepted'
                  ? filteredOrders.filter(r => (r.status === 'paid' || !r.status) && r.type !== 'transfer')
                  : orderReviewTab === 'transfers'
                    ? []
                    : filteredOrders.filter(r => (r.status === 'failed' || r.status === 'refunded') && r.type !== 'transfer');

              const tabTotal = tabRows.reduce((s, r) => s + toEGP(r), 0);

              const clearFilters = () => {
                setOrderSearch(''); setOrderTypeFilter('all'); setOrderMethodFilter('all');
                setOrderStaffFilter('all'); setOrderDateFrom(''); setOrderDateTo(''); setOrderStatusFilter('all');
              };
              const hasFilters = orderSearch || orderTypeFilter !== 'all' || orderMethodFilter !== 'all'
                || orderStaffFilter !== 'all' || orderDateFrom || orderDateTo;

              // The wording comes from shared/paymentMethods, which is also
              // what the customer's own screens read. This list used to be its
              // own eight entries and had no 'bank_transfer' — one of the four
              // rails the manual-payment flow actually writes — so a customer
              // who paid by transfer showed here as the bare token. Only the
              // colour is decided locally now.
              // 'manual' is not a rail — it is how the payment was taken —
              // but orders carry it, so it stays filterable.
              const PAY_METHOD_CLS: Record<string, string> = {
                cash: 'bg-gray-100 text-gray-700',
                bank_transfer: 'bg-blue-100 text-blue-700',
                vodafone_cash: 'bg-red-100 text-red-700',
                instapay: 'bg-purple-100 text-purple-700',
                online_paymob: 'bg-indigo-100 text-indigo-700',
                card: 'bg-cyan-100 text-cyan-700',
                wallet: 'bg-teal-100 text-teal-700',
                fawry: 'bg-amber-100 text-amber-700',
              };
              const payMethodBadge = (m: string | undefined) => {
                const code = normalizePaymentMethod(m) || (m || '').toLowerCase();
                const label = paymentMethodLabel(m) || '—';
                const cls = PAY_METHOD_CLS[code] || 'bg-gray-100 text-gray-500';
                return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{label}</span>;
              };

              const typeBadge = (t: string | undefined) => {
                const map: Record<string, { label: string; cls: string }> = {
                  course:       { label: 'كورس',       cls: 'bg-emerald-100 text-emerald-700' },
                  bundle:       { label: 'مسار',        cls: 'bg-violet-100 text-violet-700' },
                  consultation: { label: 'استشارة',    cls: 'bg-amber-100 text-amber-700' },
                  certificate:  { label: 'شهادة',      cls: 'bg-sky-100 text-sky-700' },
                };
                const info = map[t || ''] || { label: t || '—', cls: 'bg-gray-100 text-gray-500' };
                return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${info.cls}`}>{info.label}</span>;
              };

              return (
                <div className="space-y-4" dir="rtl">
                  {/* ── Header ── */}
                  <div className="bg-gradient-to-l from-emerald-600 to-teal-700 rounded-2xl px-5 py-4 text-white shadow-lg">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <h2 className="text-lg font-extrabold flex items-center gap-2">
                          <CreditCard size={20} /> الطلبات والمدفوعات
                        </h2>
                        <p className="text-emerald-100 text-xs mt-0.5">إجمالي {effectiveOrders.length} طلب مسجّل في النظام</p>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="text-center bg-white/10 rounded-xl px-4 py-2">
                          <div className="text-xs text-emerald-100">إيراد اليوم</div>
                          <div className="text-xl font-extrabold">{todayRevEGP.toLocaleString('ar-EG-u-nu-latn')} ج</div>
                        </div>
                        <div className="text-center bg-white/10 rounded-xl px-4 py-2">
                          <div className="text-xs text-emerald-100">إيراد الشهر</div>
                          <div className="text-xl font-extrabold">{monthRevEGP.toLocaleString('ar-EG-u-nu-latn')} ج</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── KPI Cards ── */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                      { label: 'إجمالي الطلبات', value: effectiveOrders.length, icon: CreditCard, bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', itext: 'text-slate-400' },
                      { label: 'مدفوعات مؤكدة',  value: paidAll.length,         icon: CheckCircle, bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', itext: 'text-emerald-400' },
                      { label: 'قيد المراجعة',   value: pendingAll.length,      icon: Clock,       bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   itext: 'text-amber-400' },
                      { label: 'فاشلة / مرتجع',  value: failedAll.length,       icon: XCircle,     bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     itext: 'text-red-400' },
                      { label: 'إيراد EGP',       value: `${ordersStats.revenueEGP.toLocaleString('ar-EG-u-nu-latn')} ج`, icon: Wallet, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', itext: 'text-blue-400' },
                      { label: 'إيراد SAR',       value: `${ordersStats.revenueSAR.toLocaleString('ar-EG-u-nu-latn')} ر.س`, icon: TrendingUp, bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', itext: 'text-violet-400' },
                    ].map(k => {
                      const Icon = k.icon;
                      return (
                        <div key={k.label} className={`${k.bg} ${k.border} border rounded-xl px-3 py-3 flex flex-col gap-1`}>
                          <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-semibold ${k.text}`}>{k.label}</span>
                            <Icon size={14} className={k.itext} />
                          </div>
                          <div className={`text-lg font-extrabold ${k.text}`}>{k.value}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* ── Mini Revenue Chart (last 7 days) ── */}
                  <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-xs font-bold text-gray-700 flex items-center gap-1.5"><TrendingUp size={13} className="text-emerald-500"/>الإيراد — آخر 7 أيام</h4>
                      <span className="text-[10px] text-gray-400">بالجنيه المصري (مكافئ)</span>
                    </div>
                    <div className="flex items-end gap-1.5 h-16">
                      {last7.map(d => {
                        const pct = maxRev > 0 ? Math.round((d.rev / maxRev) * 100) : 0;
                        const isToday = d.ds === todayStr;
                        return (
                          <div key={d.ds} className="flex-1 flex flex-col items-center gap-1" title={`${d.label}: ${d.rev.toLocaleString('ar-EG-u-nu-latn')} ج`}>
                            <div className="w-full flex flex-col justify-end h-12 relative group">
                              <div
                                className={`w-full rounded-t-md transition-all ${isToday ? 'bg-emerald-500' : 'bg-emerald-200 group-hover:bg-emerald-400'}`}
                                style={{ height: `${Math.max(pct, 4)}%` }}
                              />
                              {d.rev > 0 && (
                                <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[8px] text-gray-500 whitespace-nowrap hidden group-hover:block bg-white border border-gray-200 rounded px-1">
                                  {d.rev.toLocaleString('ar-EG-u-nu-latn')}
                                </div>
                              )}
                            </div>
                            <span className={`text-[9px] ${isToday ? 'font-bold text-emerald-600' : 'text-gray-400'}`}>{d.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Status Tabs + Add Transfer Button ── */}
                  <div className="flex flex-wrap items-center gap-2">
                    {([
                      { key: 'review'    as const, label: 'قيد المراجعة',   count: filteredOrders.filter(r => r.status === 'pending' && r.type !== 'transfer').length,   color: 'amber' },
                      { key: 'accepted'  as const, label: 'مدفوعات مؤكدة', count: filteredOrders.filter(r => (r.status === 'paid' || !r.status) && r.type !== 'transfer').length, color: 'green' },
                      { key: 'failed'    as const, label: 'فاشلة / مرتجع', count: filteredOrders.filter(r => (r.status === 'failed' || r.status === 'refunded') && r.type !== 'transfer').length, color: 'red' },
                      { key: 'transfers' as const, label: 'التحويلات',      count: ledger.transfers.length, color: 'blue' },
                    ]).map(({ key, label, count, color }) => {
                      const active = orderReviewTab === key;
                      const cls: Record<string, string> = {
                        amber: active ? 'bg-amber-500 text-white border-amber-500 shadow-amber-200 shadow-md' : 'text-amber-700 border-amber-200 hover:bg-amber-50',
                        green: active ? 'bg-emerald-600 text-white border-emerald-600 shadow-emerald-200 shadow-md' : 'text-emerald-700 border-emerald-200 hover:bg-emerald-50',
                        red:   active ? 'bg-red-600 text-white border-red-600 shadow-red-200 shadow-md' : 'text-red-700 border-red-200 hover:bg-red-50',
                        blue:  active ? 'bg-blue-600 text-white border-blue-600 shadow-blue-200 shadow-md' : 'text-blue-700 border-blue-200 hover:bg-blue-50',
                      };
                      return (
                        <button key={key} onClick={() => setOrderReviewTab(key)}
                          className={`px-5 py-2 rounded-full text-sm font-bold border transition ${cls[color]}`}>
                          {label}
                          <span className={`mr-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-white/25' : 'bg-gray-100 text-gray-600'}`}>{count}</span>
                        </button>
                      );
                    })}
                    <div className="flex-1" />
                    {/* ── Add Transfer Button ── */}
                    <button onClick={() => setShowAddTransfer(true)}
                      className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-full shadow-md shadow-blue-200 transition">
                      <Plus size={15} /> إضافة تحويل
                    </button>
                  </div>

                  {/* ── Filters ── */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm space-y-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      {/* Search */}
                      <div className="relative flex-1 min-w-[200px]">
                        <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input value={orderSearch} onChange={e => setOrderSearch(e.target.value)}
                          placeholder="بحث برقم الطلب، اسم العميل، المنتج..."
                          className="w-full border border-gray-200 rounded-xl pr-7 pl-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200" />
                      </div>
                      {/* Type */}
                      <select value={orderTypeFilter} onChange={e => setOrderTypeFilter(e.target.value as 'all'|'course'|'bundle'|'consultation')}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                        <option value="all">كل الأنواع</option>
                        <option value="course">كورس</option>
                        <option value="bundle">مسار تعليمي</option>
                        <option value="consultation">استشارة</option>
                        <option value="certificate">شهادة</option>
                      </select>
                      {/* Method */}
                      <select value={orderMethodFilter} onChange={e => setOrderMethodFilter(e.target.value)}
                        className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                        <option value="all">كل الوسائل</option>
                        {ORDER_METHOD_FILTERS.map(code => (
                          <option key={code} value={code}>{paymentMethodLabel(code)}</option>
                        ))}
                      </select>
                      {/* Staff */}
                      {staffNames.length > 0 && (
                        <select value={orderStaffFilter} onChange={e => setOrderStaffFilter(e.target.value)}
                          className="border border-gray-200 rounded-xl px-3 py-2 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
                          <option value="all">كل الموظفين</option>
                          {staffNames.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 items-center">
                      {/* Quick presets */}
                      {[
                        { label: 'اليوم',   from: todayStr, to: todayStr },
                        { label: 'هذا الأسبوع', from: cairoWeekStart(), to: todayStr },
                        { label: 'هذا الشهر', from: `${thisMonthStr}-01`, to: todayStr },
                      ].map(p => (
                        <button key={p.label} onClick={() => { setOrderDateFrom(p.from); setOrderDateTo(p.to); }}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition font-medium ${orderDateFrom === p.from && orderDateTo === p.to ? 'bg-emerald-600 text-white border-emerald-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                          {p.label}
                        </button>
                      ))}
                      <input type="date" value={orderDateFrom} onChange={e => setOrderDateFrom(e.target.value)}
                        className="border border-gray-200 rounded-xl px-2 py-1.5 text-xs bg-white focus:outline-none" title="من تاريخ" />
                      <span className="text-gray-400 text-xs">—</span>
                      <input type="date" value={orderDateTo} onChange={e => setOrderDateTo(e.target.value)}
                        className="border border-gray-200 rounded-xl px-2 py-1.5 text-xs bg-white focus:outline-none" title="إلى تاريخ" />
                      {hasFilters && (
                        <button onClick={clearFilters}
                          className="text-xs text-red-500 border border-red-200 rounded-lg px-2.5 py-1.5 bg-red-50 hover:bg-red-100 font-medium">
                          ✕ مسح الفلاتر
                        </button>
                      )}
                      <div className="flex-1" />
                      {/* Summary */}
                      <span className="text-xs text-gray-500 font-medium bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                        {tabRows.length} طلب · {tabTotal.toLocaleString('ar-EG-u-nu-latn')} ج
                      </span>
                      {/* Export — the active review tab's rows, matching the count shown above (PAY-12) */}
                      <button onClick={() => exportFilteredOrdersCsv(tabRows)} disabled={tabRows.length === 0}
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition ${tabRows.length === 0 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-gray-900 hover:bg-black text-white'}`}>
                        <Download size={12} /> تصدير CSV
                      </button>
                    </div>
                  </div>

                  {/* ── Transfers Table (separate view) ── */}
                  {orderReviewTab === 'transfers' ? (
                    <IncomingTransfersTable transfers={ledger.transfers} loading={ledger.loading} canLink={canManageFinancial}
                      onLink={row => { setLinkQuery(''); setLinkTransferModal({ row }); }} onAdd={() => setShowAddTransfer(true)}
                      canManage={canManageFinancial && canAcceptDirectly} onEdit={setEditingTransfer} onDelete={transfer => { void deleteTransfer(transfer); }} />
                  ) : (
                  /* ── Normal Orders Table ── */
                  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs min-w-[1080px] border-collapse">
                        <thead>
                          <tr className="bg-gradient-to-l from-emerald-50 to-white text-gray-700 border-b border-gray-200">
                            <th className="px-3 py-3 font-bold text-right border-l border-gray-100">#</th>
                            <th className="px-3 py-3 font-bold text-right border-l border-gray-100">العميل</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">الفرع</th>
                            <th className="px-3 py-3 font-bold text-right border-l border-gray-100">الدفعة خاصة بإيه</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">النوع</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">المبلغ</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">وسيلة الدفع</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">المنفذ</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">التاريخ</th>
                            <th className="px-3 py-3 font-bold text-center border-l border-gray-100">الحالة</th>
                            <th className="px-3 py-3 font-bold text-center">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tabRows.slice(0, 300).map((row, i) => {
                            const isPending  = row.status === 'pending';
                            const isFailed   = row.status === 'failed' || row.status === 'refunded';
                            const rowBg = isPending ? 'bg-amber-50/40 hover:bg-amber-50/70' : isFailed ? 'bg-red-50/30 hover:bg-red-50/60' : 'hover:bg-emerald-50/20';
                            const fmtDate = (() => {
                              if (!row.createdAt) return '—';
                              const d = new Date(row.createdAt.replace(' ', 'T'));
                              return isNaN(d.getTime()) ? row.createdAt : d.toLocaleString('ar-EG-u-nu-latn', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: CAIRO_TIME_ZONE });
                            })();
                            const productTitle = (() => {
                              const t = (row.itemTitle || '').toLowerCase().trim();
                              if (t === 'course') return 'كورس'; if (t === 'certificate') return 'شهادة';
                              if (t === 'consultation') return 'استشارة'; if (t === 'bundle') return 'مسار تعليمي';
                              return row.itemTitle || '—';
                            })();
                            // What the payment is for: the course or the track it names, else the title.
                            const heldCourse = row.courseId ? courses.find(course => course.id === row.courseId) : undefined;
                            const heldBundle = row.bundleId ? bundles.find(bundle => bundle.id === row.bundleId) : undefined;
                            const forTitle = heldBundle ? `📌 ${heldBundle.title}` : (heldCourse?.titleAr || heldCourse?.title || productTitle);
                            const branchKey = normalizeBranch(String(row.branchId || '').replace(/^branch-/i, '').replace(/-/g, '_'));
                            const branchText = branchKey ? BRANCH_LABELS_AR[branchKey] : '—';
                            return (
                              <tr key={row.id} className={`border-b border-gray-100 ${rowBg} transition-colors`}>
                                <td className="px-3 py-2.5 font-mono text-gray-400 border-l border-gray-100 whitespace-nowrap">
                                  <span className="text-[9px]">#{row.id.slice(-6)}</span>
                                  <div className="text-[8px] text-gray-300">{i + 1}</div>
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100">
                                  {row.subscriberId
                                    ? <button onClick={() => navigate(`/client/${row.subscriberId}`)}
                                        className="font-semibold text-gray-800 hover:text-emerald-700 text-[11px] text-right block hover:underline underline-offset-2">{row.customerName || '—'}</button>
                                    : <span className="text-gray-600 text-[11px]">{row.customerName || '—'}</span>}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] whitespace-nowrap">
                                  <span className="rounded px-1.5 py-0.5 bg-gray-100 text-gray-600">{branchText}</span>
                                </td>
                                {/* Which booking the money is for: the course or the track by name,
                                    and whether it is an instalment — the column used to say only
                                    «course» / «other» for every desk payment. */}
                                <td className="px-3 py-2.5 border-l border-gray-100 max-w-[200px]">
                                  <span className="text-[11px] font-semibold text-gray-800 line-clamp-2" title={forTitle}>{forTitle}</span>
                                  {(row.isInstallment || row.note) && (
                                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-gray-500">
                                      {row.isInstallment && <span className="rounded-full bg-blue-50 px-1.5 py-0.5 font-bold text-blue-700 border border-blue-200">قسط</span>}
                                      {row.note && <span className="line-clamp-1" title={String(row.note)}>{String(row.note)}</span>}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  {typeBadge(row.type)}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  <span className="font-extrabold text-emerald-700 text-[12px]">{row.amount?.toLocaleString('ar-EG-u-nu-latn')}</span>
                                  <span className="text-[9px] text-gray-400 mr-0.5">{row.currency || 'EGP'}</span>
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  {payMethodBadge(row.paymentMethod)}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500">
                                  {row.staffName || '—'}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center text-[10px] text-gray-500 whitespace-nowrap" dir="ltr">
                                  {fmtDate}
                                </td>
                                <td className="px-3 py-2.5 border-l border-gray-100 text-center">
                                  {isPending
                                    ? <span className="text-[10px] bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 font-bold">⏳ انتظار</span>
                                    : isFailed
                                      ? <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded-full px-2 py-0.5 font-bold">{row.status === 'refunded' ? '↩ مرتجع' : '✕ فاشلة'}</span>
                                      : <span className="text-[10px] bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-bold">✓ مؤكد</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {isPending && canManageFinancial && (
                                      <>
                                        {/* A desk payment with no method on its row asks for one, as the
                                            online manager's list does: approving is when it is known. */}
                                        {canAcceptDirectly && isDeskPayment(row) && !storedMethodOf(row) && (
                                          <select aria-label="طريقة الدفع" value={approveMethod[row.id] || ''}
                                            onChange={event => setApproveMethod(prev => ({ ...prev, [row.id]: event.target.value }))}
                                            className={`text-[10px] rounded-lg px-1 py-1 border-2 font-bold max-w-[110px] ${approveMethod[row.id] ? 'border-gray-200 bg-white' : 'border-amber-400 bg-amber-50 text-amber-800'}`}>
                                            <option value="">طريقة الدفع…</option>
                                            {paymentBoxes.map((method: string) => <option key={method} value={method}>{method}</option>)}
                                          </select>
                                        )}
                                        {canAcceptDirectly && (
                                          <button onClick={() => handleConfirmOrder(row)}
                                            className="text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded-lg font-bold transition">
                                            ✓ قبول
                                          </button>
                                        )}
                                        <button onClick={() => handleRejectOrder(row)}
                                          className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded-lg font-bold transition">
                                          ✕ رفض
                                        </button>
                                        <button onClick={() => { setLinkQuery(''); setLinkOrderModal({ row }); }}
                                          className="text-[10px] bg-violet-600 hover:bg-violet-700 text-white px-2 py-1 rounded-lg font-bold transition" title="ربط بتحويل وتأكيد">
                                          🔗 ربط
                                        </button>
                                      </>
                                    )}
                                    {canAcceptDirectly && isDeskPayment(row) && row.status !== 'refunded' && (
                                      <button type="button" onClick={() => setCorrecting({ row, mode: 'edit' })}
                                        className="text-indigo-400 hover:text-indigo-600 p-1 rounded-md hover:bg-indigo-50 transition" title="تعديل الدفعة" aria-label="تعديل الدفعة">
                                        <Pencil size={11} />
                                      </button>
                                    )}
                                    {canAcceptDirectly && (isDeskPayment(row) || row.status === 'paid') && row.status !== 'refunded' ? (
                                      <button type="button" onClick={() => setCorrecting({ row, mode: 'void' })}
                                        className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition" title="مسح الدفعة" aria-label="مسح الدفعة">
                                        <Trash2 size={11} />
                                      </button>
                                    ) : isAdmin && row.status !== 'paid' && row.status !== 'refunded' && (
                                      <button type="button" onClick={() => deleteOrder(row.id)}
                                        className="text-red-400 hover:text-red-600 p-1 rounded-md hover:bg-red-50 transition" title="حذف" aria-label="حذف">
                                        <Trash2 size={11} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                          {tabRows.length === 0 && (
                            <tr>
                              <td colSpan={11} className="py-12 text-center text-gray-400">
                                <div className="flex flex-col items-center gap-2">
                                  <CreditCard size={28} className="text-gray-200" />
                                  <span className="text-sm">لا توجد طلبات في هذا التصنيف</span>
                                </div>
                              </td>
                            </tr>
                          )}
                        </tbody>
                        {tabRows.length > 0 && (
                          <tfoot>
                            <tr className="bg-gradient-to-l from-emerald-50 to-white border-t-2 border-emerald-100">
                              <td colSpan={5} className="px-3 py-2.5 font-bold text-gray-600 text-xs">الإجمالي ({tabRows.length} طلب)</td>
                              <td className="px-3 py-2.5 text-center font-extrabold text-emerald-700 text-[12px]">{tabTotal.toLocaleString('ar-EG-u-nu-latn')} ج</td>
                              <td colSpan={5} />
                            </tr>
                          </tfoot>
                        )}
                      </table>
                    </div>
                    {tabRows.length > 300 && (
                      <div className="text-center text-xs text-gray-400 py-3 border-t border-gray-100">
                        يعرض أول 300 طلب. استخدم الفلاتر لتضييق النتائج.
                      </div>
                    )}
                  </div>
                  )} {/* end transfers ternary */}

                  {/* ══════════════════════════════════════════
                      LINK TRANSFER → PENDING ORDER MODAL
                  ══════════════════════════════════════════ */}
                  {linkTransferModal && (() => {
                    const transfer = linkTransferModal.row;
                    const pendingOrders = effectiveOrders.filter(r => r.status === 'pending' && r.type !== 'transfer');
                    const rankedOrders = pendingOrders
                      .filter(order => matchesQuery([order.customerName, order.itemTitle, order.amount, order.transactionId].join(' ')))
                      .map(order => ({ order, ...transferMatch({ amount: Number(order.amount), currency: order.currency, method: order.paymentMethod, reference: order.transactionId, customerName: order.customerName, date: order.createdAt }, transfer) }))
                      .sort((a, b) => b.score - a.score)
                      .slice(0, 100);
                    return (
                      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" dir="rtl">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLinkTransferModal(null)} />
                        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] flex flex-col">
                          <div className="flex items-center justify-between flex-shrink-0">
                            <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                              🔗 ربط التحويل بدفعة عميل
                            </h3>
                            <button onClick={() => setLinkTransferModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
                              <XCircle size={18} />
                            </button>
                          </div>
                          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm flex-shrink-0">
                            <div className="font-bold text-blue-800">التحويل المحدد</div>
                            <div className="text-blue-600 text-xs mt-1">{transfer.senderName || 'غير محدد'} — {transfer.method}{transfer.reference ? ` · #${transfer.reference}` : ''} — {Number(transfer.amount).toLocaleString('ar-EG-u-nu-latn')} {transfer.currency}</div>
                          </div>
                          <p className="text-xs text-gray-500 flex-shrink-0">اختر دفعة عميل قيد المراجعة لربطها بهذا التحويل وتأكيدها تلقائياً.</p>
                          {pendingOrders.length > 0 && (
                            <input value={linkQuery} onChange={e => setLinkQuery(e.target.value)} placeholder="بحث باسم العميل أو الكورس أو المبلغ…"
                              className="flex-shrink-0 w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200" />
                          )}
                          <div className="overflow-y-auto flex-1 space-y-2 min-h-0">
                            {pendingOrders.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 text-sm">لا توجد دفعات قيد المراجعة حالياً</div>
                            ) : rankedOrders.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 text-sm">مفيش دفعة بالبحث ده</div>
                            ) : rankedOrders.map(({ order, reasons }) => (
                              <button key={order.id}
                                onClick={async () => {
                                  try {
                                    await confirmWithTransfer(order, transfer);
                                    await Promise.all([reloadOrders(), reloadSubscribers(), ledger.reload()]);
                                    notify('success', `✅ تم ربط التحويل بدفعة ${order.customerName} (${order.itemTitle}) وتأكيدها`);
                                    setLinkTransferModal(null);
                                    setOrderReviewTab('accepted');
                                  } catch (error) {
                                    notify('error', error instanceof Error ? error.message : 'تعذر ربط التحويل');
                                  }
                                }}
                                className="w-full text-right border border-gray-200 hover:border-violet-400 hover:bg-violet-50 rounded-xl px-4 py-3 transition group">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-gray-800 text-sm group-hover:text-violet-700 truncate">{order.customerName}</div>
                                    <div className="text-xs text-gray-500 mt-0.5 truncate">{order.itemTitle} · {order.paymentMethod}</div>
                                    <div className="text-[10px] text-gray-400 mt-0.5 font-mono">#{order.id.slice(-8)}</div>
                                    {reasons.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {reasons.map(reason => <span key={reason} className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{reason}</span>)}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="font-extrabold text-emerald-700 text-sm">{order.amount?.toLocaleString('ar-EG-u-nu-latn')} {order.currency}</div>
                                    <div className="text-[10px] text-gray-400">{cairoDay(order.createdAt)}</div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                          <div className="flex-shrink-0 pt-2 border-t border-gray-100">
                            <button onClick={() => setLinkTransferModal(null)}
                              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                              إلغاء
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ══════════════════════════════════════════
                      LINK PENDING ORDER → TRANSFER MODAL
                  ══════════════════════════════════════════ */}
                  {linkOrderModal && (() => {
                    const order = linkOrderModal.row;
                    const availableTransfers = ledger.transfers.filter(transfer => !transfer.paymentId);
                    const payment = { amount: Number(order.amount), currency: order.currency, method: order.paymentMethod, reference: order.transactionId, customerName: order.customerName, date: order.createdAt };
                    const rankedTransfers = availableTransfers
                      .filter(transfer => matchesQuery([transfer.reference, transfer.senderName, transfer.senderPhone, transfer.note, transfer.amount].join(' ')))
                      .map(transfer => ({ transfer, ...transferMatch(payment, transfer) }))
                      .sort((a, b) => b.score - a.score)
                      .slice(0, 100);
                    return (
                      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" dir="rtl">
                        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setLinkOrderModal(null)} />
                        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] flex flex-col">
                          <div className="flex items-center justify-between flex-shrink-0">
                            <h3 className="text-base font-extrabold text-gray-900 flex items-center gap-2">
                              🔗 ربط الدفعة بتحويل وتأكيدها
                            </h3>
                            <button onClick={() => setLinkOrderModal(null)} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition">
                              <XCircle size={18} />
                            </button>
                          </div>
                          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm flex-shrink-0">
                            <div className="font-bold text-amber-800">الدفعة المحددة</div>
                            <div className="text-amber-600 text-xs mt-1">{order.customerName} — {order.itemTitle} — {order.amount?.toLocaleString('ar-EG-u-nu-latn')} {order.currency}</div>
                          </div>
                          <p className="text-xs text-gray-500 flex-shrink-0">اختر تحويلاً من القائمة لربط هذه الدفعة به. سيتم تأكيد الدفعة تلقائياً. الأقرب (نفس الرقم/المبلغ/الاسم) فوق.</p>
                          {availableTransfers.length > 0 && (
                            <input value={linkQuery} onChange={e => setLinkQuery(e.target.value)} placeholder="بحث برقم العملية أو المحوِّل أو الاسم أو المبلغ…"
                              className="flex-shrink-0 w-full border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-violet-200" />
                          )}
                          <div className="overflow-y-auto flex-1 space-y-2 min-h-0">
                            {availableTransfers.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 text-sm">لا توجد تحويلات متاحة — أضف تحويلاً أولاً من تبويب "التحويلات"</div>
                            ) : rankedTransfers.length === 0 ? (
                              <div className="text-center py-8 text-gray-400 text-sm">مفيش تحويل بالبحث ده</div>
                            ) : rankedTransfers.map(({ transfer, reasons }) => (
                              <button key={transfer.id}
                                onClick={async () => {
                                  try {
                                    await confirmWithTransfer(order, transfer);
                                    await Promise.all([reloadOrders(), reloadSubscribers(), ledger.reload()]);
                                    notify('success', `✅ تم ربط دفعة ${order.customerName} بالتحويل #${transfer.reference || ''} وتأكيدها`);
                                    setLinkOrderModal(null);
                                    setOrderReviewTab('accepted');
                                  } catch (error) {
                                    notify('error', error instanceof Error ? error.message : 'تعذر ربط التحويل');
                                  }
                                }}
                                className="w-full text-right border border-gray-200 hover:border-violet-400 hover:bg-violet-50 rounded-xl px-4 py-3 transition group">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="font-semibold text-gray-800 text-sm group-hover:text-violet-700 truncate">{transfer.senderName || transfer.senderPhone || 'غير محدد'}</div>
                                    <div className="text-xs text-gray-500 mt-0.5 truncate">{transfer.method}{transfer.reference ? ` · #${transfer.reference}` : ''}</div>
                                    {transfer.note && <div className="text-[10px] text-gray-400 mt-0.5 truncate">{transfer.note}</div>}
                                    {reasons.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {reasons.map(reason => <span key={reason} className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">{reason}</span>)}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <div className="font-extrabold text-blue-700 text-sm">{Number(transfer.amount).toLocaleString('ar-EG-u-nu-latn')} {transfer.currency}</div>
                                    <div className="text-[10px] text-gray-400">{cairoDay(transfer.receivedOn)}</div>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                          <div className="flex-shrink-0 pt-2 border-t border-gray-100">
                            <button onClick={() => setLinkOrderModal(null)}
                              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
                              إلغاء
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {correcting && (
                    <PaymentCorrectionModal
                      mode={correcting.mode}
                      payment={{ id: correcting.row.id, amount: Number(correcting.row.amount) || 0, currency: correcting.row.currency,
                        courseId: correcting.row.type === 'course' ? (correcting.row.courseId || correcting.row.itemId) : undefined,
                        bundleId: correcting.row.type === 'bundle' ? (correcting.row.bundleId || correcting.row.itemId) : undefined,
                        paymentMethod: storedMethodOf(correcting.row), transactionId: correcting.row.transactionId, note: correcting.row.note,
                        at: correcting.row.createdAt, clientName: correcting.row.customerName }}
                      courses={courses} bundles={bundles} notify={notify}
                      onClose={() => setCorrecting(null)}
                      onDone={async () => { await Promise.all([reloadOrders(), reloadSubscribers()]); }}
                    />
                  )}

                  {showAddTransfer && (
                    <AddTransferModal boxes={paymentBoxes} notify={notify} onClose={() => setShowAddTransfer(false)}
                      onSaved={async () => { setShowAddTransfer(false); setOrderReviewTab('transfers'); await ledger.reload(); }} />
                  )}
                  {editingTransfer && (
                    <AddTransferModal boxes={paymentBoxes} notify={notify} transfer={editingTransfer} onClose={() => setEditingTransfer(null)}
                      onSaved={async () => { setEditingTransfer(null); await ledger.reload(); }} />
                  )}
                </div>
              );
}
