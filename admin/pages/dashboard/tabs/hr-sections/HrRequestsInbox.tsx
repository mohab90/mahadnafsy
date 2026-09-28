import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CalendarDays, CheckCircle, Inbox, RefreshCw, Sunrise, Sunset, XCircle } from 'lucide-react';
import { cairoDay, cairoMonthStart } from '../../../../../shared/cairoDate';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import {
  ADVANCE_STATUS_COLORS, ADVANCE_STATUS_LABELS, LEAVE_STATUS_COLORS, LEAVE_STATUS_LABELS,
  LEAVE_TYPE_COLORS, LEAVE_TYPE_LABELS, ROLE_LABELS,
} from './hrLabels';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type LeaveRow = {
  id: string; staff_id: string; staff_name: string; role: string; type: string; status: string;
  start_date: string; end_date: string; start_time: string | null; end_time: string | null;
  total_days: number; reason: string | null; admin_note: string | null; approved_by_name: string | null; created_at: string;
};
type AdvanceRow = {
  id: string; staff_id: string; staff_name: string; role: string; amount: number; currency: string; reason: string | null;
  status: string; approved_by_name: string | null; created_at: string;
};
type Item =
  | { kind: 'leave'; row: LeaveRow; createdAt: string; status: string }
  | { kind: 'advance'; row: AdvanceRow; createdAt: string; status: string };

const getJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: 'include', headers: adminAuthHeaders() });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'تعذر تحميل الطلبات');
  return payload as T;
};

const KIND_FILTERS = [
  ['all', 'كل الطلبات', Inbox], ['leave', 'إجازات', CalendarDays], ['LATE_PERMIT', 'إذن صباحي', Sunrise],
  ['EARLY_LEAVE', 'إذن مسائي', Sunset], ['advance', 'سلف', Banknote],
] as const;
type KindFilter = (typeof KIND_FILTERS)[number][0];

const matchesKind = (item: Item, kind: KindFilter) => {
  if (kind === 'all') return true;
  if (kind === 'advance') return item.kind === 'advance';
  if (item.kind !== 'leave') return false;
  return kind === 'leave' ? !['LATE_PERMIT', 'EARLY_LEAVE'].includes(item.row.type) : item.row.type === kind;
};

/**
 * طلبات الموظفين — every request an employee sends from «ملفي ← طلباتي», in
 * one inbox: leave, the morning and evening permissions, and advances.
 *
 * They used to sit in two places HR had to know to open — leave under
 * الإجازات, advances three screens away under كشف الرواتب — and a permission
 * showed as «LATE_PERMIT» with no hours. The HR manager and the
 * administration read this same list, pending first.
 */
export default function HrRequestsInbox({ notify, canManage, onCount }: {
  notify: Notify; canManage: boolean; onCount?: (pending: number) => void;
}) {
  const [leaves, setLeaves] = useState<LeaveRow[]>([]);
  const [advances, setAdvances] = useState<AdvanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'PENDING' | 'all'>('PENDING');
  const [kind, setKind] = useState<KindFilter>('all');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  // An advance is approved against the payroll month it comes out of.
  const [deductPeriod, setDeductPeriod] = useState(() => cairoMonthStart(-1).slice(0, 7));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leaveRows, advanceRows] = await Promise.all([
        getJson<LeaveRow[]>('/api/admin/hr/leaves'),
        getJson<AdvanceRow[]>('/api/admin/hr/advances'),
      ]);
      setLeaves(Array.isArray(leaveRows) ? leaveRows : []);
      setAdvances(Array.isArray(advanceRows) ? advanceRows : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل الطلبات');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const items = useMemo<Item[]>(() => [
    ...leaves.map(row => ({ kind: 'leave' as const, row, createdAt: row.created_at, status: row.status })),
    ...advances.map(row => ({ kind: 'advance' as const, row, createdAt: row.created_at, status: row.status })),
  ].sort((a, b) => (a.status === 'PENDING' ? 0 : 1) - (b.status === 'PENDING' ? 0 : 1)
    || String(b.createdAt).localeCompare(String(a.createdAt))), [leaves, advances]);
  const pending = items.filter(item => item.status === 'PENDING').length;
  useEffect(() => { onCount?.(pending); }, [pending, onCount]);
  const shown = items.filter(item => (status === 'all' || item.status === 'PENDING') && matchesKind(item, kind));

  const answer = async (item: Item, decision: 'APPROVED' | 'REJECTED') => {
    setBusy(item.row.id);
    try {
      const [year, month] = deductPeriod.split('-').map(Number);
      const response = item.kind === 'leave'
        ? await fetch(`/api/admin/hr/leaves/${encodeURIComponent(item.row.id)}/status`, {
          method: 'PUT', credentials: 'include', headers: adminAuthHeaders(true),
          body: JSON.stringify({ status: decision, admin_note: notes[item.row.id] || undefined }),
        })
        : await fetch(`/api/admin/hr/advances/${encodeURIComponent(item.row.id)}/status`, {
          method: 'PUT', credentials: 'include', headers: adminAuthHeaders(true),
          body: JSON.stringify({ status: decision, deduct_month: month, deduct_year: year }),
        });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر حفظ الرد');
      notify('success', decision === 'APPROVED' ? 'اتوافق على الطلب ووصل للموظف' : 'اترفض الطلب ووصل للموظف');
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ الرد');
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="flex gap-1 rounded-xl bg-gray-100 p-1 text-xs font-bold">
          {([['PENDING', `المعلقة (${pending})`], ['all', 'الكل']] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setStatus(key)}
              className={`rounded-lg px-3 py-1.5 transition ${status === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {KIND_FILTERS.map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => setKind(key)}
              className={`flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-bold transition ${
                kind === key ? 'border-slate-800 bg-slate-800 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-slate-400'}`}>
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <label className="mr-auto flex items-center gap-2 text-xs text-gray-500">
          السلف تتخصم من مرتب
          <input type="month" value={deductPeriod} onChange={e => setDeductPeriod(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1 text-sm" />
        </label>
        <button type="button" onClick={() => void load()} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="تحديث">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white py-14 text-center text-sm text-gray-400">
          <Inbox size={34} className="mx-auto mb-2 text-gray-300" />
          {loading ? 'جاري التحميل…' : status === 'PENDING' ? 'مفيش طلبات مستنية رد 🎉' : 'مفيش طلبات'}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(item => {
            const { row } = item;
            const isLeave = item.kind === 'leave';
            const title = item.kind === 'leave' ? (LEAVE_TYPE_LABELS[item.row.type] || item.row.type) : 'طلب سلفة';
            const tone = item.kind === 'leave' ? (LEAVE_TYPE_COLORS[item.row.type] || 'bg-gray-100 text-gray-600') : 'bg-emerald-100 text-emerald-700';
            const when = item.kind === 'leave'
              ? (item.row.start_time
                ? `${cairoDay(item.row.start_date)} · من ${item.row.start_time} لـ ${item.row.end_time}`
                : `${cairoDay(item.row.start_date)}${cairoDay(item.row.end_date) !== cairoDay(item.row.start_date) ? ` ← ${cairoDay(item.row.end_date)}` : ''} · ${item.row.total_days} يوم`)
              : `${Number(item.row.amount).toLocaleString('ar-EG-u-nu-latn')} ${item.row.currency}`;
            const statusLabel = isLeave ? LEAVE_STATUS_LABELS[row.status] : ADVANCE_STATUS_LABELS[row.status];
            const statusTone = isLeave ? LEAVE_STATUS_COLORS[row.status] : ADVANCE_STATUS_COLORS[row.status];
            const reply = [row.approved_by_name, item.kind === 'leave' ? item.row.admin_note : null].filter(Boolean).join(' — ');
            return (
              <div key={`${item.kind}-${row.id}`}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${row.status === 'PENDING' ? 'border-amber-200' : 'border-gray-200'}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-black text-slate-700">
                    {String(row.staff_name || '؟').charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-gray-900">{row.staff_name}</span>
                      <span className="text-[11px] text-gray-400">{ROLE_LABELS[String(row.role || '').toLowerCase()] || row.role}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tone}`}>{title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusTone || 'bg-gray-100 text-gray-600'}`}>{statusLabel || row.status}</span>
                    </div>
                    <p className="mt-1 text-sm font-semibold text-gray-700">{when}</p>
                    {row.reason && <p className="mt-0.5 text-xs text-gray-500">«{row.reason}»</p>}
                    {row.status !== 'PENDING' && reply && <p className="mt-1 text-[11px] text-gray-400">الرد: {reply}</p>}
                  </div>
                  <span className="text-[10px] text-gray-400">اتبعت {cairoDay(item.createdAt)}</span>
                </div>
                {row.status === 'PENDING' && canManage && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                    {isLeave && (
                      <input value={notes[row.id] || ''} onChange={e => setNotes(n => ({ ...n, [row.id]: e.target.value }))}
                        placeholder="ملاحظة للموظف (اختياري)" className="min-w-[180px] flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs" />
                    )}
                    <button type="button" disabled={busy === row.id} onClick={() => void answer(item, 'APPROVED')}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle size={13} /> موافقة
                    </button>
                    <button type="button" disabled={busy === row.id} onClick={() => void answer(item, 'REJECTED')}
                      className="flex items-center gap-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50">
                      <XCircle size={13} /> رفض
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
