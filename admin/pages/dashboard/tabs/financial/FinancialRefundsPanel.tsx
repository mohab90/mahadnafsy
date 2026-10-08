import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2, Clock, RefreshCw, Plus, XCircle, Wrench, ArrowUpCircle,
  UserX, Trash2, BadgeCheck, Search, Phone, ExternalLink, ChevronDown, X,
} from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { useSiteData } from '../../../../context/SiteDataContext';
import { AddRefundModal } from './AddRefundModal';
import { confirmDialog } from '../../../../../shared/ui/confirmDialog';
import { promptDialog } from '../../../../../shared/ui/promptDialog';
import { cairoDateTime } from '../../../../../shared/cairoDate';
import { ClientContactDialog } from '../../../unified-client/ClientContactLog';
import { branchLabels, normBranchKey } from '../../../unified-client/constants';

// A refund is a money decision with a story: which course, at which branch, how
// much of it the customer had actually paid, how much they asked back, when
// they booked and when they asked, why, who is handling it, who sold it, and
// how much of the course they had used. This screen used to show four of those
// and offer approve/reject — so the reasoning behind every decision lived
// outside the system, and a partial refund could not be recorded at all.

interface RefundRow {
  id: string;
  subscriber_id: string;
  subscriber_name?: string;
  subscriber_email?: string;
  subscriber_phone?: string;
  client_code?: string;
  subscriber_branch?: string;
  assigned_sales_name?: string;
  assigned_cs_name?: string;
  payment_id?: string | null;
  amount: number | string;
  refunded_amount?: number | string | null;
  currency: string;
  reason?: string;
  status: string;
  admin_note?: string;
  admin_notes?: string;
  decision_note?: string;
  created_at: string;
  booking_date?: string;
  resolved_at?: string;
  refunded_at?: string;
  handler_name?: string;
  escalated_at?: string;
  escalated_by_name?: string;
  blamed_staff_name?: string;
  blame_note?: string;
  course_title?: string;
  course_item?: string | null;
  course_total?: number | string;
  paid_total?: number | string;
  attended_count?: number;
  /** The last contact about it since it was asked for, from the client's contact log. */
  last_contact?: { outcome?: string | null; notes?: string | null; at?: string; by?: string | null; type?: string } | null;
  contacts_count?: number;
}

// Matches the narrower notifier FinancialTab passes; every call here is a
// success or a failure, so 'info' was never needed.
type Notify = (message: string, tone?: 'success' | 'error') => void;

const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
  PENDING:  { label: 'قيد المراجعة', icon: <Clock size={12} />,       bg: 'bg-amber-100',   text: 'text-amber-800' },
  APPROVED: { label: 'مقبول',        icon: <CheckCircle2 size={12} />, bg: 'bg-emerald-100', text: 'text-emerald-800' },
  REJECTED: { label: 'مرفوض',        icon: <XCircle size={12} />,      bg: 'bg-red-100',     text: 'text-red-800' },
  HANDLING: { label: 'جارٍ معالجته', icon: <Wrench size={12} />,       bg: 'bg-blue-100',    text: 'text-blue-800' },
  REFUNDED: { label: 'تم رد المبلغ', icon: <BadgeCheck size={12} />,   bg: 'bg-teal-100',    text: 'text-teal-800' },
};

const normalizeStatus = (status?: string) => String(status || '').toUpperCase();
const num = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: unknown, currency = 'EGP') => `${num(value).toLocaleString('ar-EG-u-nu-latn')} ${currency}`;
const day = (value?: string) => (value ? String(value).slice(0, 10) : '—');
const branchName = (branch?: string) => (branch ? branchLabels[normBranchKey(branch)] || branch : '—');
const ownerOf = (row: RefundRow) => row.handler_name || row.assigned_cs_name || '';
// «واللي في الادارة»: raised to management, whatever its status.
const STATUS_FILTERS: Array<[string, string]> = [
  ['ALL', 'كل الحالات'], ['PENDING', 'قيد المراجعة'], ['APPROVED', 'مقبول'], ['REJECTED', 'مرفوض'],
  ['HANDLING', 'جارٍ معالجته'], ['REFUNDED', 'تم رد المبلغ'], ['ESCALATED', 'مرفوع للإدارة'],
];

// `branch` scopes both the list and the decision: the finance tab renders this
// per branch, and the server checks the caller may act on that branch.
export default function FinancialRefundsPanel({ notify, branch }: { notify: Notify; branch?: string }) {
  const { staffMembers, isAdmin, authUser } = useSiteData();
  const navigate = useNavigate();
  // The callers pass notify inline, so it is a new function every render; read
  // through a ref, it no longer reloads the list each time the page renders.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const contactNotify = useCallback((type: 'success' | 'error' | 'info', message: string) =>
    notifyRef.current(message, type === 'error' ? 'error' : 'success'), []);
  // Customer service reads and escalates; accepting, rejecting, adding and
  // paying out are approve_refunds, which the server asks for each of them.
  const canDecide = isAdmin || authUser?.permissions === '*'
    || (Array.isArray(authUser?.permissions) && authUser.permissions.includes('approve_refunds'));
  const [addOpen, setAddOpen] = useState(false);
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [salesFilter, setSalesFilter] = useState('');
  const [menuFor, setMenuFor] = useState('');
  const [contactRow, setContactRow] = useState<RefundRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
      const res = await fetch(`/api/admin/finance/refunds${query}`, { credentials: 'include', headers: adminAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      notifyRef.current('تعذر تحميل طلبات الاسترداد', 'error');
    } finally { setLoading(false); }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, init: RequestInit, okMessage: string, id: string) => {
    setMenuFor('');
    setBusy(id);
    try {
      const res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...adminAuthHeaders(true) },
        ...init,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) throw new Error(body.error || 'تعذر تنفيذ الإجراء');
      notify(body.message || okMessage, 'success');
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء', 'error');
    } finally { setBusy(''); }
  };

  const decide = async (row: RefundRow, status: 'APPROVED' | 'REJECTED' | 'HANDLING') => {
    const requested = num(row.amount);
    let refundedAmount: number | undefined;
    let decisionNote = '';

    if (status === 'APPROVED') {
      // Typed, because it can now be less than the whole thing.
      //
      // This dialog asked for a figure once before and it was taken away on
      // purpose: partial refunds were refused everywhere, so every number other
      // than the full one came back a 409 after the desk had already filled the
      // form in. Asking for a figure that can only have one value was the bug
      // then; the reversal handles a part of it now, so the question is real
      // again — and the full amount is still one Enter away, because it is
      // still what most refunds are.
      const answer = await promptDialog({
        title: 'اعتماد الاسترداد',
        message: `المطلوب ${requested} ${row.currency || ''} لـ ${row.subscriber_name || 'العميل'}.`
          + '\nاكتب المبلغ اللي هيترد فعلاً — أقل من ده يبقى استرداد جزئي، والعميل يفضل مشترك في الكورس.',
        defaultValue: String(requested),
        placeholder: 'المبلغ المسترد',
        confirmLabel: 'اعتماد',
      });
      if (answer === null) return;
      const typed = Number(String(answer).trim());
      if (!Number.isFinite(typed) || typed <= 0 || typed > requested) {
        notify(`المبلغ لازم يكون بين 1 و ${requested}`, 'error');
        return;
      }
      refundedAmount = typed;
      if (typed < requested) {
        const note = await promptDialog({
          title: 'سبب الاسترداد الجزئي',
          message: `هيترد ${typed} من ${requested} ${row.currency || ''}. السبب بيتسجل على حركة الفلوس نفسها.`,
          placeholder: 'السبب',
          confirmLabel: 'تأكيد',
        });
        if (note === null) return;
        decisionNote = note.trim();
        if (!decisionNote) { notify('اكتب سبب الاسترداد الجزئي', 'error'); return; }
      }
    } else {
      const label = status === 'REJECTED' ? 'اكتب سبب الرفض كاملاً:' : 'اكتب ما تم عمله في الطلب:';
      const answer = await promptDialog(label);
      if (answer === null) return;
      decisionNote = answer.trim();
      if (!decisionNote) { notify(status === 'REJECTED' ? 'سبب الرفض مطلوب' : 'اكتب ما تم عمله', 'error'); return; }
    }

    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ status, refunded_amount: refundedAmount, decision_note: decisionNote, branch }),
    }, 'تم تسجيل القرار', row.id);
  };

  const escalate = async (row: RefundRow) => {
    const note = await promptDialog('رفع الطلب للإدارة العليا — اكتب سبب الرفع:');
    if (note === null) return;
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}/escalate`, {
      method: 'POST', body: JSON.stringify({ note }),
    }, 'تم رفع الطلب', row.id);
  };

  const blame = async (row: RefundRow) => {
    const names = staffMembers.filter(s => s.status === 'active');
    const list = names.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const answer = await promptDialog(`تحديد الموظف المسؤول عن سبب الاسترداد.\nاكتب رقم الموظف، أو 0 لإلغاء التحديد:\n\n${list}`);
    if (answer === null) return;
    const index = Number(answer);
    if (index === 0) {
      void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}/blame`, {
        method: 'POST', body: JSON.stringify({ staff_id: '' }),
      }, 'تم إلغاء التحديد', row.id);
      return;
    }
    const picked = names[index - 1];
    if (!picked) { notify('رقم غير صحيح', 'error'); return; }
    const note = await promptDialog(`ما الخطأ الذي حدث من ${picked.name}؟`) || '';
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}/blame`, {
      method: 'POST', body: JSON.stringify({ staff_id: picked.id, note }),
    }, 'تم تسجيل المسؤولية', row.id);
  };

  const markRefunded = async (row: RefundRow) => {
    if (!await confirmDialog(`تأكيد أن المبلغ ${money(row.refunded_amount ?? row.amount, row.currency)} وصل للعميل فعلاً؟`)) return;
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}/mark-refunded`, { method: 'POST' },
      'تم تأكيد رد المبلغ', row.id);
  };

  const remove = async (row: RefundRow) => {
    if (!await confirmDialog(`حذف طلب استرداد ${row.subscriber_name || ''}؟\nالحذف أرشفة — الطلب يفضل في السجل.`)) return;
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}`, { method: 'DELETE' },
      'تم حذف الطلب', row.id);
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter === 'ESCALATED' ? !row.escalated_at : statusFilter !== 'ALL' && normalizeStatus(row.status) !== statusFilter) return false;
      if (courseFilter && (row.course_title || '') !== courseFilter) return false;
      if (branchFilter && normBranchKey(row.subscriber_branch) !== branchFilter) return false;
      if (ownerFilter && ownerOf(row) !== ownerFilter) return false;
      if (salesFilter && (row.assigned_sales_name || '') !== salesFilter) return false;
      if (!q) return true;
      return [row.subscriber_name, row.subscriber_email, row.subscriber_phone, row.client_code, row.course_title]
        .some(field => String(field || '').toLowerCase().includes(q));
    });
  }, [rows, statusFilter, courseFilter, branchFilter, ownerFilter, salesFilter, search]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { ALL: rows.length, ESCALATED: rows.filter(r => r.escalated_at).length };
    rows.forEach(r => { const s = normalizeStatus(r.status); out[s] = (out[s] || 0) + 1; });
    return out;
  }, [rows]);
  const options = useMemo(() => {
    const distinct = (pick: (row: RefundRow) => string) => [...new Set(rows.map(pick).filter(Boolean))].sort();
    return {
      course: distinct(row => row.course_title || ''),
      branch: distinct(row => normBranchKey(row.subscriber_branch)),
      owner: distinct(ownerOf),
      sales: distinct(row => row.assigned_sales_name || ''),
    };
  }, [rows]);
  const hasFilters = statusFilter !== 'ALL' || courseFilter || branchFilter || ownerFilter || salesFilter || search;
  const selectCls = 'rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-xs font-bold text-gray-700';

  const th = 'px-3 py-2.5 text-right font-bold whitespace-nowrap';
  const td = 'px-3 py-2.5 align-top';

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الكود أو الكورس"
            className="w-full rounded-xl border border-gray-200 py-2 pr-9 pl-3 text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={selectCls} aria-label="الحالة">
          {STATUS_FILTERS.map(([key, label]) => <option key={key} value={key}>{label} ({counts[key] || 0})</option>)}
        </select>
        <select value={courseFilter} onChange={e => setCourseFilter(e.target.value)} className={selectCls} aria-label="الكورس">
          <option value="">كل الكورسات</option>
          {options.course.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className={selectCls} aria-label="الفرع">
          <option value="">كل الفروع</option>
          {options.branch.map(item => <option key={item} value={item}>{branchName(item)}</option>)}
        </select>
        <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} className={selectCls} aria-label="المسئول">
          <option value="">كل المسئولين</option>
          {options.owner.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={salesFilter} onChange={e => setSalesFilter(e.target.value)} className={selectCls} aria-label="السيلز">
          <option value="">كل السيلز</option>
          {options.sales.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        {hasFilters && (
          <button onClick={() => { setStatusFilter('ALL'); setCourseFilter(''); setBranchFilter(''); setOwnerFilter(''); setSalesFilter(''); setSearch(''); }}
            className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600 flex items-center gap-1"><X size={12} /> مسح</button>
        )}
        <button onClick={() => void load()} className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-1">
          <RefreshCw size={12} /> تحديث
        </button>
        {canDecide && <button onClick={() => setAddOpen(true)} className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 transition flex items-center gap-1">
          <Plus size={12} /> إضافة استرداد
        </button>}
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-slate-600" />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-700">
          لا توجد طلبات استرداد{statusFilter !== 'ALL' ? ' بهذه الحالة' : ''}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className={th}>العميل</th>
                <th className={th}>الكورس</th>
                <th className={th}>الفرع</th>
                <th className={th}>دفع / الإجمالي</th>
                <th className={th}>طلب استرداد</th>
                <th className={th}>الحجز / الطلب</th>
                <th className={th}>السبب</th>
                <th className={th}>المتابعة</th>
                <th className={th}>السيلز</th>
                <th className={th}>الحضور</th>
                <th className={th}>الحالة</th>
                <th className={th}>النتيجة</th>
                <th className={th}>آخر تواصل</th>
                <th className={th}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row => {
                const status = normalizeStatus(row.status);
                const badge = STATUS_MAP[status] || STATUS_MAP.PENDING;
                const isPending = status === 'PENDING';
                const working = busy === row.id;
                return (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                    <td className={td}>
                      {/* «لازم يكون في عمود اسم الكورس ويكون رقم الهاتف تحت اسم العميل». */}
                      <div className="font-bold text-gray-800 whitespace-nowrap">{row.subscriber_name || '—'}</div>
                      {row.subscriber_phone && <div className="text-[11px] text-gray-500 text-right" dir="ltr">{row.subscriber_phone}</div>}
                      {row.client_code && <div className="text-[10px] text-gray-400">{row.client_code}</div>}
                    </td>
                    <td className={`${td} font-bold text-indigo-700 min-w-[120px]`}>{row.course_title || 'كورس غير محدد'}</td>
                    <td className={`${td} text-gray-600 whitespace-nowrap`}>{branchName(row.subscriber_branch)}</td>
                    <td className={td}>
                      <span className="font-bold text-gray-800">{num(row.paid_total).toLocaleString('ar-EG-u-nu-latn')}</span>
                      <span className="text-gray-400"> / {num(row.course_total).toLocaleString('ar-EG-u-nu-latn')}</span>
                    </td>
                    <td className={`${td} font-bold text-amber-700`}>{money(row.amount, row.currency)}</td>
                    <td className={`${td} text-gray-500 whitespace-nowrap`}>
                      <div>{day(row.booking_date)}</div>
                      <div className="text-[11px]">↩ {day(row.created_at)}</div>
                    </td>
                    <td className={`${td} max-w-[180px] text-gray-600`}>{row.reason || '—'}</td>
                    <td className={`${td} text-gray-600`}>{row.handler_name || row.assigned_cs_name || '—'}</td>
                    <td className={`${td} text-gray-600`}>{row.assigned_sales_name || '—'}</td>
                    <td className={`${td} text-gray-600`}>{num(row.attended_count)} محاضرة</td>
                    <td className={td}>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${badge.bg} ${badge.text}`}>
                        {badge.icon} {badge.label}
                      </span>
                      {row.escalated_at && (
                        <div className="mt-1 text-[10px] font-bold text-purple-600">⚠ مرفوع للإدارة</div>
                      )}
                      {row.blamed_staff_name && (
                        <div className="mt-1 text-[10px] font-bold text-rose-600">خطأ: {row.blamed_staff_name}</div>
                      )}
                    </td>
                    <td className={td}>
                      {status === 'APPROVED' || status === 'REFUNDED' ? (
                        <span className="font-bold text-emerald-700">{money(row.refunded_amount ?? row.amount, row.currency)}</span>
                      ) : row.decision_note ? (
                        <span className="text-gray-600">{row.decision_note}</span>
                      ) : <span className="text-gray-300">—</span>}
                      {row.refunded_at && <div className="text-[10px] text-teal-600">رُدّ {day(row.refunded_at)}</div>}
                    </td>
                    <td className={`${td} min-w-[160px]`}>
                      {row.last_contact ? (
                        <div>
                          {row.last_contact.outcome && <div className="font-bold text-emerald-700">{row.last_contact.outcome}</div>}
                          {row.last_contact.notes && <div className="text-gray-600 line-clamp-2" title={row.last_contact.notes}>{row.last_contact.notes}</div>}
                          <div className="text-[10px] text-gray-400">
                            {row.last_contact.by || '—'} · {cairoDateTime(row.last_contact.at)}
                            {(row.contacts_count || 0) > 1 && <> · {row.contacts_count} تواصل</>}
                          </div>
                        </div>
                      ) : <span className="text-gray-300">لسه متواصلش</span>}
                    </td>
                    <td className={td}>
                      {/* «تواصل» and the client's file first; every decision
                          under «النتيجة»; raising to management on its own. */}
                      <div className="flex flex-nowrap items-center gap-1">
                        <button disabled={working} onClick={() => setContactRow(row)} title="تواصل وسجّل اللي حصل"
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50 inline-flex items-center gap-0.5 whitespace-nowrap bg-blue-600 text-white hover:bg-blue-700">
                          <Phone size={10} /> تواصل
                        </button>
                        <button onClick={() => navigate(`/client/${row.client_code || row.subscriber_id}`)} title="ملف العميل"
                          className="rounded-md px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50 inline-flex items-center gap-0.5 whitespace-nowrap border border-gray-200 bg-white text-gray-600 hover:bg-gray-100">
                          <ExternalLink size={10} /> الملف
                        </button>
                        {(canDecide || isAdmin) && (
                          <div className="relative">
                            <button disabled={working} onClick={() => setMenuFor(menuFor === row.id ? '' : row.id)}
                              className="rounded-md px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50 inline-flex items-center gap-0.5 whitespace-nowrap bg-slate-800 text-white hover:bg-slate-900">
                              النتيجة <ChevronDown size={10} />
                            </button>
                            {menuFor === row.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setMenuFor('')} />
                                <div className="absolute left-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                                  {isPending && canDecide && (
                                    <>
                                      <button onClick={() => { setMenuFor(''); void decide(row, 'APPROVED'); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-right font-bold text-emerald-700 hover:bg-emerald-50"><CheckCircle2 size={12} /> مقبول</button>
                                      <button onClick={() => { setMenuFor(''); void decide(row, 'REJECTED'); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-right font-bold text-red-700 hover:bg-red-50"><XCircle size={12} /> مرفوض</button>
                                      <button onClick={() => { setMenuFor(''); void decide(row, 'HANDLING'); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-right font-bold text-blue-700 hover:bg-blue-50"><Wrench size={12} /> هنعالجه</button>
                                    </>
                                  )}
                                  {status === 'APPROVED' && canDecide && (
                                    <button onClick={() => { setMenuFor(''); void markRefunded(row); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-right font-bold text-teal-700 hover:bg-teal-50"><BadgeCheck size={12} /> تم رد المبلغ</button>
                                  )}
                                  {isAdmin && (
                                    <button onClick={() => { setMenuFor(''); void blame(row); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-right font-bold text-rose-700 hover:bg-rose-50"><UserX size={12} /> خطأ موظف</button>
                                  )}
                                  {!isPending && status !== 'APPROVED' && !isAdmin && (
                                    <p className="px-3 py-1.5 text-gray-400">اتاخد فيه قرار</p>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        {!row.escalated_at && status !== 'REFUNDED' && (
                          <button disabled={working} onClick={() => escalate(row)}
                            title="رفع للإدارة" className="rounded-md px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50 inline-flex items-center gap-0.5 whitespace-nowrap border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100">
                            <ArrowUpCircle size={10} /> رفع للإدارة
                          </button>
                        )}
                        {isAdmin && (
                          <button disabled={working} onClick={() => void remove(row)} title="حذف الطلب"
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-bold disabled:opacity-50 inline-flex items-center gap-0.5 whitespace-nowrap border border-red-200 bg-red-50 text-red-700 hover:bg-red-100">
                            <Trash2 size={10} /> حذف
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* This panel's notify takes (message, tone); the modal uses the
          (type, text) shape the rest of the admin does. Adapted at the call
          site rather than changing either signature. */}
      {contactRow && (
        <ClientContactDialog
          subscriber={{ id: contactRow.subscriber_id, name: contactRow.subscriber_name || 'العميل' }}
          notify={contactNotify}
          onClose={() => { setContactRow(null); void load(); }}
        />
      )}

      {addOpen && (
        <AddRefundModal
          notify={(type, text) => notify(text, type === 'error' ? 'error' : 'success')}
          onClose={() => setAddOpen(false)}
          onCreated={() => void load()}
        />
      )}
    </div>
  );
}
