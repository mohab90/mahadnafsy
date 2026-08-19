import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle, CheckCircle2, Eye, FileText, Plus, XCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

// ── Bulk Stub Panel (reconcile historical enrollments with no payment records) ──
export function BulkStubPanel({ notify }: { notify: NotifyFn }) {
  const [preview, setPreview] = React.useState<{ count: number; sample: { name: string; email: string }[] } | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [running, setRunning] = React.useState(false);

  const runPreview = async () => {
    setLoading(true);
    try {
      const r = await mysqlAdmin.adminPost<{ count: number; sample: { name: string; email: string }[] }>(
        '/admin/payments/bulk-stub', { dryRun: true }
      );
      setPreview(r as { count: number; sample: { name: string; email: string }[] });
    } catch (e: unknown) { notify('error', (e as Error).message || 'خطأ'); }
    finally { setLoading(false); }
  };

  const runReal = async () => {
    if (!preview || preview.count === 0) return;
    if (!window.confirm(`سيتم إنشاء ${preview.count} سجل دفع تاريخي بقيمة صفر. هل تريد المتابعة؟`)) return;
    setRunning(true);
    try {
      const r = await mysqlAdmin.adminPost<{ created: number }>(
        '/admin/payments/bulk-stub', { dryRun: false }
      );
      notify('success', `تم إنشاء ${(r as { created: number }).created} سجل تاريخي ✅`);
      setPreview(null);
    } catch (e: unknown) { notify('error', (e as Error).message || 'خطأ'); }
    finally { setRunning(false); }
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <FileText size={16} className="text-blue-600" />
        <h4 className="font-bold text-blue-800">التسوية التاريخية</h4>
        <span className="text-xs text-blue-600 bg-blue-100 border border-blue-200 rounded-full px-2 py-0.5">
          تسجيلات بدون سجل دفع
        </span>
      </div>
      <p className="text-xs text-blue-700">
        ينشئ سجلات دفع بقيمة صفر للتسجيلات التاريخية التي لا يوجد لها سجل مدفوعات — مفيد للتسوية المحاسبية.
      </p>
      {preview && (
        <div className="bg-white border border-blue-200 rounded-lg p-3 text-sm">
          <p className="font-bold text-blue-800 mb-1">نتيجة المعاينة: <span className="text-red-600">{preview.count}</span> تسجيل بدون دفع</p>
          {preview.sample?.slice(0, 3).map((s, i) => (
            <p key={i} className="text-xs text-gray-500">{s.name} — {s.email}</p>
          ))}
          {preview.count > 3 && <p className="text-xs text-gray-400">...و {preview.count - 3} آخرين</p>}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <button onClick={runPreview} disabled={loading || running}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-60">
          {loading ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Eye size={14} />}
          معاينة
        </button>
        {preview && preview.count > 0 && (
          <button onClick={runReal} disabled={running || loading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-60">
            {running ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <CheckCircle size={14} />}
            تنفيذ ({preview.count} سجل)
          </button>
        )}
        {preview?.count === 0 && (
          <span className="flex items-center gap-1 text-sm text-emerald-700 font-bold">
            <CheckCircle2 size={14} /> جميع التسجيلات لها سجلات دفع ✅
          </span>
        )}
      </div>
    </div>
  );
}

// ── Period Closing Panel ───────────────────────────────────────────────────
type AccountingPeriod = {
  id: string;
  period_label: string;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  summary_json: string | null;
  status: 'open' | 'closed';
};
type CloseRequest = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'consumed';
  requested_by: string;
  reviewed_by?: string | null;
  created_at: string;
  checklist_snapshot?: { items?: Array<{ key: string; count: number; blocking: boolean }> } | string;
};

export function PeriodClosingPanel({ notify }: { notify: NotifyFn }) {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [closeRequests, setCloseRequests] = useState<CloseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<AccountingPeriod[]>('/admin/accounting-periods');
      const rows = Array.isArray(data) ? data : [];
      setPeriods(rows);
      const open = rows.find(period => period.status === 'open');
      setCloseRequests(open
        ? await mysqlAdmin.adminGet<CloseRequest[]>(`/admin/accounting-periods/${open.id}/close-requests`)
        : []);
    } catch { notify('error', 'فشل تحميل الفترات المحاسبية'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const createPeriod = async () => {
    const label = new Date().toISOString().slice(0, 7);
    if (!window.confirm(`إنشاء فترة محاسبية جديدة للشهر ${label}؟`)) return;
    setActionLoading('create');
    try {
      await mysqlAdmin.adminPost('/admin/accounting-periods', { label });
      notify('success', 'تم إنشاء الفترة المحاسبية');
      await load();
    } catch (e: unknown) { notify('error', (e as Error).message || 'فشل الإنشاء'); }
    finally { setActionLoading(''); }
  };

  const closePeriod = async (id: string, label: string) => {
    if (!window.confirm(`إقفال الفترة المحاسبية ${label}؟ لن يمكن التراجع إلا بصلاحية المدير.`)) return;
    setActionLoading(id + '_close');
    try {
      await mysqlAdmin.adminPost(`/admin/accounting-periods/${id}/close`, {});
      notify('success', `تم إقفال الفترة ${label}`);
      await load();
    } catch (e: unknown) { notify('error', (e as Error).message || 'فشل الإقفال'); }
    finally { setActionLoading(''); }
  };

  const requestClose = async (id: string, label: string) => {
    const note = window.prompt(`ملاحظة طلب إقفال الفترة ${label}:`)?.trim() || '';
    setActionLoading(id + '_request');
    try {
      await mysqlAdmin.adminPost(`/admin/accounting-periods/${id}/close-request`, { note });
      notify('success', 'تم إنشاء طلب الإقفال بعد اجتياز قائمة الفحص');
      await load();
    } catch (e: unknown) { notify('error', (e as Error).message || 'تعذر إنشاء طلب الإقفال'); }
    finally { setActionLoading(''); }
  };

  const reviewClose = async (periodId: string, requestId: string, decision: 'approve' | 'reject') => {
    const note = window.prompt(decision === 'approve' ? 'ملاحظة الاعتماد:' : 'سبب الرفض:')?.trim() || '';
    setActionLoading(requestId + '_review');
    try {
      await mysqlAdmin.adminPost(`/admin/accounting-periods/${periodId}/close-request/${requestId}/review`, { decision, note });
      notify('success', decision === 'approve' ? 'تم اعتماد طلب الإقفال' : 'تم رفض طلب الإقفال');
      await load();
    } catch (e: unknown) { notify('error', (e as Error).message || 'تعذرت مراجعة الطلب'); }
    finally { setActionLoading(''); }
  };

  const reopenPeriod = async (id: string, label: string) => {
    const reason = window.prompt(`اكتب سبب إعادة فتح الفترة ${label}:`)?.trim();
    if (!reason) {
      notify('info', 'تم إلغاء إعادة الفتح: السبب إلزامي لأغراض المراجعة.');
      return;
    }
    setActionLoading(id + '_reopen');
    try {
      await mysqlAdmin.adminPost(`/admin/accounting-periods/${id}/reopen`, { reason });
      notify('success', `تم إعادة فتح الفترة ${label}`);
      await load();
    } catch (e: unknown) { notify('error', (e as Error).message || 'فشل إعادة الفتح'); }
    finally { setActionLoading(''); }
  };

  const openPeriod = periods.find(p => p.status === 'open');
  const activeCloseRequest = closeRequests.find(request => ['pending', 'approved'].includes(request.status));

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">إقفال الفترات المحاسبية</h3>
          <p className="text-sm text-gray-500">إدارة الفترات المحاسبية الشهرية وإقفالها لمنع التعديل</p>
        </div>
        <button onClick={createPeriod} disabled={!!openPeriod || actionLoading === 'create'}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50">
          {actionLoading === 'create'
            ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            : <Plus size={14} />}
          فترة جديدة
        </button>
      </div>

      {openPeriod && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 size={20} className="text-emerald-600" />
            </div>
            <div>
              <p className="font-bold text-emerald-800">الفترة المفتوحة: {openPeriod.period_label}</p>
              <p className="text-xs text-emerald-600">فُتحت في {openPeriod.opened_at?.slice(0, 10)}</p>
            </div>
          </div>
          <button
            onClick={() => activeCloseRequest?.status === 'approved'
              ? closePeriod(openPeriod.id, openPeriod.period_label)
              : requestClose(openPeriod.id, openPeriod.period_label)}
            disabled={!!actionLoading || activeCloseRequest?.status === 'pending'}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition disabled:opacity-50">
            {actionLoading
              ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <XCircle size={14} />}
            {activeCloseRequest?.status === 'approved'
              ? 'تنفيذ الإقفال المعتمد'
              : activeCloseRequest?.status === 'pending'
                ? 'طلب الإقفال بانتظار المراجعة'
                : 'طلب إقفال الفترة'}
          </button>
        </div>
      )}

      {openPeriod && closeRequests.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <h4 className="mb-3 font-bold text-gray-800">طلبات إقفال الفترة</h4>
          <div className="space-y-2">
            {closeRequests.map(request => (
              <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-gray-50 p-3 text-sm">
                <div>
                  <p className="font-bold text-gray-800">{request.status} — {request.created_at?.slice(0, 16)}</p>
                  <p className="text-xs text-gray-500">طالب الإقفال: {request.requested_by}</p>
                </div>
                {request.status === 'pending' && (
                  <div className="flex gap-2">
                    <button onClick={() => reviewClose(openPeriod.id, request.id, 'approve')}
                      disabled={!!actionLoading}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                      اعتماد
                    </button>
                    <button onClick={() => reviewClose(openPeriod.id, request.id, 'reject')}
                      disabled={!!actionLoading}
                      className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50">
                      رفض
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <span className="w-7 h-7 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : periods.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">لا توجد فترات محاسبية. أنشئ فترة جديدة لبدء الإقفال الشهري.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs font-semibold">
                <th className="px-4 py-3 text-right">الفترة</th>
                <th className="px-4 py-3 text-right">الحالة</th>
                <th className="px-4 py-3 text-right">تاريخ الفتح</th>
                <th className="px-4 py-3 text-right">تاريخ الإقفال</th>
                <th className="px-4 py-3 text-right">بواسطة</th>
                <th className="px-4 py-3 text-right">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {periods.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 font-bold text-gray-900">{p.period_label}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${p.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.status === 'open' ? 'مفتوحة' : 'مقفلة'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.opened_at?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-gray-500">{p.closed_at?.slice(0, 10) || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{p.closed_by || '—'}</td>
                  <td className="px-4 py-3">
                    {p.status === 'closed' && (
                      <button onClick={() => reopenPeriod(p.id, p.period_label)}
                        disabled={actionLoading === p.id + '_reopen'}
                        className="text-xs px-2 py-1 rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition disabled:opacity-50">
                        إعادة فتح
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
