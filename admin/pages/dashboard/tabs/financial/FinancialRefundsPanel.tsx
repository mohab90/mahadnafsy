import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

interface RefundRow {
  id: string;
  subscriber_id: string;
  subscriber_name?: string;
  subscriber_email?: string;
  payment_id?: string | null;
  amount: number | string;
  currency: string;
  reason?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | string;
  admin_note?: string;
  admin_notes?: string;
  refund_method?: string;
  created_at: string;
  resolved_at?: string;
  handler_name?: string;
}

const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string }> = {
  PENDING: { label: 'قيد المراجعة', icon: <Clock size={12} />, bg: 'bg-amber-100', text: 'text-amber-800' },
  APPROVED: { label: 'مقبول', icon: <CheckCircle2 size={12} />, bg: 'bg-emerald-100', text: 'text-emerald-800' },
  REJECTED: { label: 'مرفوض', icon: <XCircle size={12} />, bg: 'bg-red-100', text: 'text-red-800' },
};

const normalizeStatus = (status?: string) => String(status || '').toUpperCase();
const toAmount = (amount: RefundRow['amount']) => {
  const n = Number(amount);
  return Number.isFinite(n) ? n : 0;
};
const fmtDate = (value?: string) => value ? new Date(value).toLocaleDateString('ar-EG') : '-';
const fmtMoney = (amount: RefundRow['amount'], currency = 'EGP') =>
  `${Math.round(toAmount(amount)).toLocaleString('ar-EG')} ${currency || 'EGP'}`;

export default function FinancialRefundsPanel({ notify, branch }: { notify: (msg: string, tone?: 'success' | 'error') => void; branch?: string }) {
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [actionRow, setActionRow] = useState<RefundRow | null>(null);
  const [actionStatus, setActionStatus] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [actionNote, setActionNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
      const response = await fetch(`/api/admin/finance/refunds${query}`, {
        credentials: 'include',
        headers: adminAuthHeaders(),
      });
      if (!response.ok) throw new Error(await response.text());
      setRows(await response.json());
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : 'فشل التحميل', 'error');
    } finally {
      setLoading(false);
    }
  }, [branch, notify]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async () => {
    if (!actionRow) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/finance/refunds/${encodeURIComponent(actionRow.id)}`, {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ status: actionStatus, notes: actionNote, branch }),
      });
      if (!response.ok) throw new Error(await response.text());
      notify(`تم تحديث الطلب: ${actionStatus === 'APPROVED' ? 'مقبول' : 'مرفوض'}`, 'success');
      setActionRow(null);
      setActionNote('');
      await load();
    } catch (error: unknown) {
      notify(error instanceof Error ? error.message : 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => rows.filter((row) => {
    const status = normalizeStatus(row.status);
    if (statusFilter && status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase().trim();
    return (row.subscriber_name || '').toLowerCase().includes(q)
      || (row.subscriber_email || '').toLowerCase().includes(q)
      || (row.reason || '').toLowerCase().includes(q);
  }), [rows, search, statusFilter]);

  const pendingRows = rows.filter((row) => normalizeStatus(row.status) === 'PENDING');
  const approvedRows = rows.filter((row) => normalizeStatus(row.status) === 'APPROVED');
  const rejectedRows = rows.filter((row) => normalizeStatus(row.status) === 'REJECTED');

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">طلبات الاسترجاع</h2>
          <p className="text-sm text-gray-500 mt-0.5">مراجعة وإدارة طلبات استرداد الأموال من المشتركين</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={14} /> تحديث
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
          <p className="text-xs text-amber-600 mb-1">قيد المراجعة</p>
          <p className="text-xl font-extrabold text-amber-800">{pendingRows.length}</p>
          <p className="text-xs text-amber-600 mt-0.5">{fmtMoney(pendingRows.reduce((sum, row) => sum + toAmount(row.amount), 0))}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
          <p className="text-xs text-emerald-600 mb-1">مقبول</p>
          <p className="text-xl font-extrabold text-emerald-800">{approvedRows.length}</p>
          <p className="text-xs text-emerald-600 mt-0.5">{fmtMoney(approvedRows.reduce((sum, row) => sum + toAmount(row.amount), 0))}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
          <p className="text-xs text-red-600 mb-1">مرفوض</p>
          <p className="text-xl font-extrabold text-red-800">{rejectedRows.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">إجمالي الطلبات</p>
          <p className="text-xl font-extrabold text-gray-800">{rows.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="بحث بالاسم أو البريد أو السبب..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">كل الحالات</option>
          <option value="PENDING">قيد المراجعة</option>
          <option value="APPROVED">مقبول</option>
          <option value="REJECTED">مرفوض</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="font-medium">{rows.length === 0 ? 'لا توجد طلبات استرجاع' : 'لا توجد نتائج مطابقة'}</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs font-semibold text-right border-b border-gray-100">
                <th className="px-4 py-3">المشترك</th>
                <th className="px-4 py-3 text-center">المبلغ</th>
                <th className="px-4 py-3">السبب</th>
                <th className="px-4 py-3 text-center">الحالة</th>
                <th className="px-4 py-3 text-center">تاريخ الطلب</th>
                <th className="px-4 py-3 text-center">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const status = normalizeStatus(row.status);
                const statusUi = STATUS_MAP[status] ?? { label: status || 'غير محدد', icon: null, bg: 'bg-gray-100', text: 'text-gray-800' };
                return (
                  <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{row.subscriber_name || '-'}</p>
                      <p className="text-[11px] text-gray-400">{row.subscriber_email || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-gray-700">
                      {fmtMoney(row.amount, row.currency)}
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      <p className="text-gray-700 text-xs line-clamp-2">{row.reason || <span className="text-gray-300">-</span>}</p>
                      {(row.admin_note || row.admin_notes) && (
                        <p className="text-[10px] text-indigo-600 mt-0.5">ملاحظة: {row.admin_note || row.admin_notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${statusUi.bg} ${statusUi.text}`}>
                        {statusUi.icon}{statusUi.label}
                      </span>
                      {row.handler_name && <p className="text-[10px] text-gray-400 mt-0.5">{row.handler_name}</p>}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      <p>{fmtDate(row.created_at)}</p>
                      {row.resolved_at && <p className="text-[10px] text-gray-400">حسم: {fmtDate(row.resolved_at)}</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {status === 'PENDING' ? (
                        <button
                          onClick={() => { setActionRow(row); setActionStatus('APPROVED'); setActionNote(''); }}
                          className="px-2.5 py-1 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700"
                        >
                          مراجعة
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {actionRow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(event) => event.target === event.currentTarget && setActionRow(null)}>
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full" dir="rtl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">مراجعة طلب الاسترجاع</h3>
            <p className="text-sm text-gray-500 mb-4">
              {actionRow.subscriber_name} - {fmtMoney(actionRow.amount, actionRow.currency)}
            </p>
            {actionRow.reason && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 text-sm text-gray-700">
                <p className="text-xs text-gray-400 mb-1 font-medium">سبب الطلب:</p>
                {actionRow.reason}
              </div>
            )}
            <div className="flex gap-2 mb-4">
              {(['APPROVED', 'REJECTED'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setActionStatus(status)}
                  className={`flex-1 py-2 rounded-xl font-bold text-sm border-2 transition ${actionStatus === status
                    ? status === 'APPROVED' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                >
                  {status === 'APPROVED' ? 'قبول' : 'رفض'}
                </button>
              ))}
            </div>
            <textarea
              placeholder="ملاحظة إدارية اختيارية..."
              value={actionNote}
              onChange={(event) => setActionNote(event.target.value)}
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <div className="flex gap-2">
              <button onClick={handleAction} disabled={saving} className="flex-1 py-2 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 disabled:opacity-50">
                {saving ? 'جاري الحفظ...' : 'تأكيد القرار'}
              </button>
              <button onClick={() => setActionRow(null)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
