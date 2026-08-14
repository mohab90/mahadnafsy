import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Clock, RefreshCw, XCircle, Wrench, ArrowUpCircle,
  UserX, Trash2, BadgeCheck, Search,
} from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { useSiteData } from '../../../../context/SiteDataContext';

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
  course_total?: number | string;
  paid_total?: number | string;
  attended_count?: number;
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
const money = (value: unknown, currency = 'EGP') => `${num(value).toLocaleString('ar-EG')} ${currency}`;
const day = (value?: string) => (value ? String(value).slice(0, 10) : '—');

// `branch` scopes both the list and the decision: the finance tab renders this
// per branch, and the server checks the caller may act on that branch.
export default function FinancialRefundsPanel({ notify, branch }: { notify: Notify; branch?: string }) {
  const { staffMembers, isAdmin } = useSiteData();
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
      const res = await fetch(`/api/admin/finance/refunds${query}`, { credentials: 'include', headers: adminAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      notify('تعذر تحميل طلبات الاسترداد', 'error');
    } finally { setLoading(false); }
  }, [branch, notify]);

  useEffect(() => { void load(); }, [load]);

  const call = async (path: string, init: RequestInit, okMessage: string, id: string) => {
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

  const decide = (row: RefundRow, status: 'APPROVED' | 'REJECTED' | 'HANDLING') => {
    const requested = num(row.amount);
    let refundedAmount: number | undefined;
    let decisionNote = '';

    if (status === 'APPROVED') {
      const answer = window.prompt(`الموافقة على استرداد ${row.subscriber_name || ''}.\nطلب ${requested}. اكتب المبلغ الذي سيُرد فعلياً:`, String(requested));
      if (answer === null) return;
      refundedAmount = Number(answer);
      if (!Number.isFinite(refundedAmount) || refundedAmount <= 0 || refundedAmount > requested) {
        notify(`المبلغ المسترد لازم يكون بين 1 و ${requested}`, 'error');
        return;
      }
    } else {
      const label = status === 'REJECTED' ? 'اكتب سبب الرفض كاملاً:' : 'اكتب ما تم عمله في الطلب:';
      const answer = window.prompt(label);
      if (answer === null) return;
      decisionNote = answer.trim();
      if (!decisionNote) { notify(status === 'REJECTED' ? 'سبب الرفض مطلوب' : 'اكتب ما تم عمله', 'error'); return; }
    }

    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ status, refunded_amount: refundedAmount, decision_note: decisionNote, branch }),
    }, 'تم تسجيل القرار', row.id);
  };

  const escalate = (row: RefundRow) => {
    const note = window.prompt('رفع الطلب للإدارة العليا — اكتب سبب الرفع:');
    if (note === null) return;
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}/escalate`, {
      method: 'POST', body: JSON.stringify({ note }),
    }, 'تم رفع الطلب', row.id);
  };

  const blame = (row: RefundRow) => {
    const names = staffMembers.filter(s => s.status === 'active');
    const list = names.map((s, i) => `${i + 1}. ${s.name}`).join('\n');
    const answer = window.prompt(`تحديد الموظف المسؤول عن سبب الاسترداد.\nاكتب رقم الموظف، أو 0 لإلغاء التحديد:\n\n${list}`);
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
    const note = window.prompt(`ما الخطأ الذي حدث من ${picked.name}؟`) || '';
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}/blame`, {
      method: 'POST', body: JSON.stringify({ staff_id: picked.id, note }),
    }, 'تم تسجيل المسؤولية', row.id);
  };

  const markRefunded = (row: RefundRow) => {
    if (!window.confirm(`تأكيد أن المبلغ ${money(row.refunded_amount ?? row.amount, row.currency)} وصل للعميل فعلاً؟`)) return;
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}/mark-refunded`, { method: 'POST' },
      'تم تأكيد رد المبلغ', row.id);
  };

  const remove = (row: RefundRow) => {
    if (!window.confirm(`حذف طلب استرداد ${row.subscriber_name || ''}؟\nالحذف أرشفة — الطلب يفضل في السجل.`)) return;
    void call(`/api/admin/finance/refunds/${encodeURIComponent(row.id)}`, { method: 'DELETE' },
      'تم حذف الطلب', row.id);
  };

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(row => {
      if (statusFilter !== 'ALL' && normalizeStatus(row.status) !== statusFilter) return false;
      if (!q) return true;
      return [row.subscriber_name, row.subscriber_email, row.subscriber_phone, row.client_code, row.course_title]
        .some(field => String(field || '').toLowerCase().includes(q));
    });
  }, [rows, statusFilter, search]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { ALL: rows.length };
    rows.forEach(r => { const s = normalizeStatus(r.status); out[s] = (out[s] || 0) + 1; });
    return out;
  }, [rows]);

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
        {['ALL', 'PENDING', 'APPROVED', 'HANDLING', 'REJECTED', 'REFUNDED'].map(key => (
          <button key={key} onClick={() => setStatusFilter(key)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === key ? 'bg-slate-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {key === 'ALL' ? 'الكل' : STATUS_MAP[key]?.label} ({counts[key] || 0})
          </button>
        ))}
        <button onClick={() => void load()} className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-50 flex items-center gap-1">
          <RefreshCw size={12} /> تحديث
        </button>
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
                      <div className="font-bold text-gray-800">{row.subscriber_name || '—'}</div>
                      <div className="text-[11px] text-gray-400" dir="ltr">{row.client_code || row.subscriber_phone || row.subscriber_email || ''}</div>
                    </td>
                    <td className={`${td} text-gray-700`}>{row.course_title || '—'}</td>
                    <td className={`${td} text-gray-600`}>{row.subscriber_branch || '—'}</td>
                    <td className={td}>
                      <span className="font-bold text-gray-800">{num(row.paid_total).toLocaleString('ar-EG')}</span>
                      <span className="text-gray-400"> / {num(row.course_total).toLocaleString('ar-EG')}</span>
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
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {isPending && (
                          <>
                            <button disabled={working} onClick={() => decide(row, 'APPROVED')}
                              className="rounded-lg bg-emerald-600 px-2 py-1 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">مقبول</button>
                            <button disabled={working} onClick={() => decide(row, 'REJECTED')}
                              className="rounded-lg bg-red-600 px-2 py-1 font-bold text-white hover:bg-red-700 disabled:opacity-50">مرفوض</button>
                            <button disabled={working} onClick={() => decide(row, 'HANDLING')}
                              className="rounded-lg bg-blue-600 px-2 py-1 font-bold text-white hover:bg-blue-700 disabled:opacity-50">هنعالجه</button>
                          </>
                        )}
                        {status === 'APPROVED' && (
                          <button disabled={working} onClick={() => markRefunded(row)}
                            className="rounded-lg bg-teal-600 px-2 py-1 font-bold text-white hover:bg-teal-700 disabled:opacity-50 inline-flex items-center gap-1">
                            <BadgeCheck size={11} /> تم رد المبلغ
                          </button>
                        )}
                        {!row.escalated_at && status !== 'REFUNDED' && (
                          <button disabled={working} onClick={() => escalate(row)}
                            className="rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 font-bold text-purple-700 hover:bg-purple-100 disabled:opacity-50 inline-flex items-center gap-1">
                            <ArrowUpCircle size={11} /> رفع للإدارة
                          </button>
                        )}
                        {isAdmin && (
                          <button disabled={working} onClick={() => blame(row)}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-50 inline-flex items-center gap-1">
                            <UserX size={11} /> خطأ موظف
                          </button>
                        )}
                        {isAdmin && (
                          <button disabled={working} onClick={() => remove(row)}
                            className="rounded-lg border border-gray-200 px-2 py-1 font-bold text-gray-500 hover:bg-gray-100 disabled:opacity-50">
                            <Trash2 size={11} />
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
    </div>
  );
}
