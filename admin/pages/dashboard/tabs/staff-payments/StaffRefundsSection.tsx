import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, BadgeCheck, CheckCircle2, Clock, Plus, RotateCcw, Wrench, XCircle } from 'lucide-react';
import { cairoDay } from '../../../../../shared/cairoDate';
import { promptDialog } from '../../../../../shared/ui/promptDialog';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import type { SubscriberItem } from '../../../../types';
import { AddRefundModal } from '../financial/AddRefundModal';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Refund = {
  id: string; subscriber_name?: string; client_code?: string; subscriber_phone?: string;
  amount: number | string; refunded_amount?: number | string | null; currency: string; reason?: string;
  status: string; decision_note?: string; created_at: string; refunded_at?: string; escalated_at?: string;
  course_title?: string; paid_total?: number | string; course_total?: number | string; handler_name?: string;
};

const STATUS: Record<string, { label: string; tone: string; icon: typeof Clock }> = {
  PENDING: { label: 'قيد المراجعة', tone: 'bg-amber-100 text-amber-800', icon: Clock },
  HANDLING: { label: 'جارٍ معالجته', tone: 'bg-blue-100 text-blue-800', icon: Wrench },
  APPROVED: { label: 'اتوافق عليه', tone: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
  REJECTED: { label: 'اترفض', tone: 'bg-red-100 text-red-800', icon: XCircle },
  REFUNDED: { label: 'المبلغ اترد', tone: 'bg-teal-100 text-teal-800', icon: BadgeCheck },
};
const num = (value: unknown) => Number(value ?? 0) || 0;
const money = (value: unknown, currency = 'EGP') => `${num(value).toLocaleString('ar-EG-u-nu-latn')} ${currency}`;

/**
 * الاستردادات — inside «مدفوعاتي», in its colours: the refunds of this
 * employee's own clients, asked for from here, followed from here.
 *
 * Deciding one — how much goes back, confirming it went — is the manager's and
 * stays on their screen (FinancialRefundsPanel). The employee asks, says they
 * are handling it, or raises it to the administration.
 */
export function StaffRefundsSection({ clients, notify }: { clients: SubscriberItem[]; notify: Notify }) {
  const [rows, setRows] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/finance/refunds', { credentials: 'include', headers: adminAuthHeaders() });
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error(payload?.error || 'تعذر تحميل الاستردادات');
      setRows(Array.isArray(payload) ? payload : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل الاستردادات');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const act = async (row: Refund, kind: 'handling' | 'escalate') => {
    const note = await promptDialog(kind === 'handling' ? 'اكتب اللي عملته في الطلب:' : 'رفع الطلب للإدارة — اكتب السبب:');
    if (note === null || !note.trim()) return;
    setBusy(row.id);
    try {
      const response = await fetch(
        kind === 'handling' ? `/api/admin/finance/refunds/${encodeURIComponent(row.id)}` : `/api/admin/finance/refunds/${encodeURIComponent(row.id)}/escalate`,
        {
          method: kind === 'handling' ? 'PUT' : 'POST', credentials: 'include', headers: adminAuthHeaders(true),
          body: JSON.stringify(kind === 'handling' ? { status: 'HANDLING', decision_note: note.trim() } : { note: note.trim() }),
        });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) throw new Error(payload.error || 'تعذر تنفيذ الإجراء');
      notify('success', kind === 'handling' ? 'اتسجل إنك بتعالجه' : 'اترفع للإدارة');
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء');
    } finally { setBusy(''); }
  };

  const open = useMemo(() => rows.filter(row => ['PENDING', 'HANDLING'].includes(String(row.status).toUpperCase())).length, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-extrabold text-gray-800">طلبات استرداد عملائي</span>
        {open > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">{open} مفتوح</span>}
        <button type="button" onClick={() => setAdding(true)}
          className="mr-auto flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"><Plus size={12} /> طلب استرداد</button>
      </div>
      {loading ? (
        <div className="py-12 text-center text-gray-400"><span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-teal-600" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-6 text-center text-sm text-emerald-700">
          <RotateCcw size={26} className="mx-auto mb-2 text-emerald-300" /> مفيش طلبات استرداد على عملائك.
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {rows.map(row => {
            const status = String(row.status || '').toUpperCase();
            const badge = STATUS[status] || STATUS.PENDING;
            const Icon = badge.icon;
            return (
              <div key={row.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-extrabold text-gray-900">{row.subscriber_name || '—'}</div>
                    <div className="text-[11px] text-gray-400" dir="ltr">{row.client_code || row.subscriber_phone || ''}</div>
                  </div>
                  <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.tone}`}><Icon size={11} /> {badge.label}</span>
                </div>
                <div className="mt-2 flex items-end justify-between gap-2 text-xs">
                  <div className="text-gray-500">
                    <div>{row.course_title || '—'}</div>
                    <div>دفع {num(row.paid_total).toLocaleString('ar-EG-u-nu-latn')} من {num(row.course_total).toLocaleString('ar-EG-u-nu-latn')} · اتطلب {cairoDay(row.created_at)}</div>
                  </div>
                  <div className="text-left">
                    <div className="text-[10px] text-gray-400">المطلوب</div>
                    <div className="text-base font-black text-rose-700">{money(row.amount, row.currency)}</div>
                  </div>
                </div>
                {row.reason && <p className="mt-2 rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">«{row.reason}»</p>}
                {(row.decision_note || status === 'REFUNDED' || status === 'APPROVED') && (
                  <p className="mt-1 text-[11px] font-semibold text-gray-500">
                    {status === 'APPROVED' || status === 'REFUNDED' ? `هيترد ${money(row.refunded_amount ?? row.amount, row.currency)}` : ''}
                    {row.decision_note ? ` ${row.decision_note}` : ''}{row.refunded_at ? ` · اترد ${cairoDay(row.refunded_at)}` : ''}
                  </p>
                )}
                {['PENDING', 'HANDLING'].includes(status) && (
                  <div className="mt-3 flex flex-wrap gap-1.5 border-t border-gray-100 pt-2">
                    {status === 'PENDING' && (
                      <button type="button" disabled={busy === row.id} onClick={() => void act(row, 'handling')}
                        className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"><Wrench size={11} /> بعالجه</button>
                    )}
                    {!row.escalated_at && (
                      <button type="button" disabled={busy === row.id} onClick={() => void act(row, 'escalate')}
                        className="flex items-center gap-1 rounded-lg bg-purple-50 px-2.5 py-1 text-[11px] font-bold text-purple-700 hover:bg-purple-100 disabled:opacity-50"><ArrowUpCircle size={11} /> رفع للإدارة</button>
                    )}
                    {row.escalated_at && <span className="text-[10px] font-bold text-purple-600">⚠ مرفوع للإدارة</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {adding && <AddRefundModal clients={clients} notify={notify} onClose={() => setAdding(false)} onCreated={() => void load()} />}
    </div>
  );
}
