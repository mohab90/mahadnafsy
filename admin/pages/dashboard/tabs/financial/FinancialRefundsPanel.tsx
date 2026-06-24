import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, XCircle, RefreshCw } from 'lucide-react';

interface RefundRow {
  id: string;
  subscriber_id: string;
  subscriber_name?: string;
  subscriber_email?: string;
  payment_id?: string;
  amount: number;
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
  PENDING:  { label: 'قيد المراجعة', icon: <Clock size={12} />, bg: 'bg-amber-100', text: 'text-amber-800' },
  APPROVED: { label: 'مقبول', icon: <CheckCircle2 size={12} />, bg: 'bg-emerald-100', text: 'text-emerald-800' },
  REJECTED: { label: 'مرفوض', icon: <XCircle size={12} />, bg: 'bg-red-100', text: 'text-red-800' },
};

const fmtDate = (s?: string) => s ? new Date(s).toLocaleDateString('ar-EG-u-nu-latn') : '—';
const fmtMoney = (n: number, cur = 'EGP') => `${Math.round(n).toLocaleString('ar-EG-u-nu-latn')} ${cur}`;

export default function FinancialRefundsPanel({ notify }: { notify: (msg: string, t?: 'success' | 'error') => void }) {
  const [rows, setRows]     = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [actionRow, setActionRow] = useState<RefundRow | null>(null);
  const [actionStatus, setActionStatus] = useState('approved');
  const [actionNote, setActionNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/finance/refunds', { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      setRows(await r.json());
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'فشل التحميل', 'error');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async () => {
    if (!actionRow) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/finance/refunds/${actionRow.id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: actionStatus, notes: actionNote }),
      });
      if (!r.ok) throw new Error(await r.text());
      notify(`تم تحديث الطلب: ${actionStatus === 'approved' ? 'مقبول' : 'مرفوض'}`, 'success');
      setActionRow(null);
      setActionNote('');
      await load();
    } catch (e: unknown) {
      notify(e instanceof Error ? e.message : 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const filtered = rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (r.subscriber_name || '').toLowerCase().includes(q)
        || (r.subscriber_email || '').toLowerCase().includes(q)
        || (r.reason || '').toLowerCase().includes(q);
    }
    return true;
  });

  const pending   = rows.filter(r => r.status === 'PENDING').length;
  const totalPending = rows.filter(r => r.status === 'PENDING').reduce((s, r) => s + r.amount, 0);
  const approved  = rows.filter(r => r.status === 'APPROVED').length;
  const totalApproved = rows.filter(r => r.status === 'APPROVED').reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">↩️ طلبات الاسترجاع</h2>
          <p className="text-sm text-gray-500 mt-0.5">مراجعة وإدارة طلبات استرداد الأموال من المشتركين</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
          <RefreshCw size={14} /> تحديث
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
          <p className="text-xs text-amber-600 mb-1">قيد المراجعة</p>
          <p className="text-xl font-extrabold text-amber-800">{pending}</p>
          <p className="text-xs text-amber-600 mt-0.5">{fmtMoney(totalPending)}</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
          <p className="text-xs text-emerald-600 mb-1">مقبول</p>
          <p className="text-xl font-extrabold text-emerald-800">{approved}</p>
          <p className="text-xs text-emerald-600 mt-0.5">{fmtMoney(totalApproved)}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
          <p className="text-xs text-red-600 mb-1">مرفوض</p>
          <p className="text-xl font-extrabold text-red-800">{rows.filter(r => r.status === 'REJECTED').length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
          <p className="text-xs text-gray-500 mb-1">إجمالي الطلبات</p>
          <p className="text-xl font-extrabold text-gray-800">{rows.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text" placeholder="بحث بالاسم أو البريد أو السبب..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm">
          <option value="">كل الحالات</option>
          <option value="PENDING">قيد المراجعة</option>
          <option value="APPROVED">مقبول</option>
          <option value="REJECTED">مرفوض</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">↩️</p>
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
              {filtered.map(row => {
                const st = STATUS_MAP[row.status] ?? { label: row.status, icon: null, bg: 'bg-gray-100', text: 'text-gray-800' };
                return (
                  <tr key={row.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{row.subscriber_name || '—'}</p>
                      <p className="text-[11px] text-gray-400">{row.subscriber_email || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-center font-bold text-gray-700">
                      {fmtMoney(row.amount, row.currency)}
                    </td>
                    <td className="px-4 py-3 max-w-[200px]">
                      <p className="text-gray-700 text-xs line-clamp-2">{row.reason || <span className="text-gray-300">—</span>}</p>
                      {(row.admin_note || row.admin_notes) && (
                        <p className="text-[10px] text-indigo-600 mt-0.5">ملاحظة: {row.admin_note || row.admin_notes}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${st.bg} ${st.text}`}>
                        {st.icon}{st.label}
                      </span>
                      {row.handler_name && (
                        <p className="text-[10px] text-gray-400 mt-0.5">{row.handler_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-gray-500">
                      <p>{fmtDate(row.created_at)}</p>
                      {row.resolved_at && <p className="text-[10px] text-gray-400">حُسم: {fmtDate(row.resolved_at)}</p>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.status === 'PENDING' ? (
                        <button
                          onClick={() => { setActionRow(row); setActionStatus('approved'); setActionNote(''); }}
                          className="px-2.5 py-1 bg-violet-600 text-white rounded-lg text-xs font-bold hover:bg-violet-700">
                          مراجعة
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action modal */}
      {actionRow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && setActionRow(null)}>
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-md w-full" dir="rtl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">مراجعة طلب الاسترجاع</h3>
            <p className="text-sm text-gray-500 mb-4">
              {actionRow.subscriber_name} — {fmtMoney(actionRow.amount, actionRow.currency)}
            </p>
            {actionRow.reason && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4 text-sm text-gray-700">
                <p className="text-xs text-gray-400 mb-1 font-medium">سبب الطلب:</p>
                {actionRow.reason}
              </div>
            )}
            <div className="flex gap-2 mb-4">
              {['approved', 'rejected'].map(s => (
                <button key={s} onClick={() => setActionStatus(s)}
                  className={`flex-1 py-2 rounded-xl font-bold text-sm border-2 transition ${actionStatus === s
                    ? s === 'approved' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                  {s === 'approved' ? '✅ قبول' : '❌ رفض'}
                </button>
              ))}
            </div>
            <textarea
              placeholder="ملاحظة إدارية (اختياري)..."
              value={actionNote} onChange={e => setActionNote(e.target.value)}
              rows={3} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
            <div className="flex gap-2">
              <button onClick={handleAction} disabled={saving}
                className="flex-1 py-2 bg-violet-600 text-white rounded-xl font-bold text-sm hover:bg-violet-700 disabled:opacity-50">
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
