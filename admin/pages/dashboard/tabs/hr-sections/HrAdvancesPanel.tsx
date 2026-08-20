import { useCallback, useEffect, useState } from 'react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Advance = {
  id: string;
  staff_name: string;
  amount: number;
  currency: string;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'DISBURSED' | 'DEDUCTED' | 'REJECTED';
  deduct_month: number | null;
  deduct_year: number | null;
  created_at: string;
};

const LABELS: Record<Advance['status'], string> = {
  PENDING: 'بانتظار HR',
  APPROVED: 'بانتظار الصرف',
  DISBURSED: 'تم الصرف / بانتظار الخصم',
  DEDUCTED: 'تم الخصم',
  REJECTED: 'مرفوض',
};

export default function HrAdvancesPanel({
  notify,
  canDisburse,
  financeMode = false,
}: {
  notify: Notify;
  canDisburse: boolean;
  financeMode?: boolean;
}) {
  const nextMonth = new Date();
  nextMonth.setUTCDate(1);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const [deductPeriod, setDeductPeriod] = useState(nextMonth.toISOString().slice(0, 7));
  const [rows, setRows] = useState<Advance[]>([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch(financeMode ? '/api/admin/finance/salary-advances' : '/api/admin/hr/advances', {
        credentials: 'include',
        headers: adminAuthHeaders(),
      });
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error(payload.error || 'تعذر تحميل السلف');
      setRows(Array.isArray(payload) ? payload : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل السلف');
    }
  }, [financeMode, notify]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (advance: Advance, status: 'APPROVED' | 'REJECTED') => {
    setBusy(advance.id);
    try {
      const [year, month] = deductPeriod.split('-').map(Number);
      const response = await fetch(`/api/admin/hr/advances/${advance.id}/status`, {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ status, deduct_month: month, deduct_year: year }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر تحديث السلفة');
      notify('success', status === 'APPROVED' ? 'تم اعتماد السلفة' : 'تم رفض السلفة');
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث السلفة');
    } finally {
      setBusy('');
    }
  };

  const disburse = async (advance: Advance) => {
    setBusy(advance.id);
    try {
      const response = await fetch(`/api/admin/hr/advances/${advance.id}/disburse`, {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: '{}',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر صرف السلفة');
      notify('success', `تم صرف السلفة وترحيل القيد رقم ${payload.journal_entry_id}`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر صرف السلفة');
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900">{financeMode ? 'سلف جاهزة للصرف' : 'دورة السلف المحاسبية'}</h3>
          <p className="mt-1 text-xs text-gray-500">HR يعتمد، والحسابات تصرف بقيد مستقل، والخصم يتم فقط مع مسير مدفوع.</p>
        </div>
        {!financeMode && <label className="text-xs text-gray-500">
          شهر الخصم
          <input type="month" value={deductPeriod} onChange={event => setDeductPeriod(event.target.value)}
            className="mr-2 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"/>
        </label>}
      </div>
      {rows.length === 0 ? (
        <div className="py-5 text-center text-sm text-gray-400">لا توجد طلبات سلف</div>
      ) : (
        <div className="space-y-2">
          {rows.map(advance => (
            <div key={advance.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm">
              <div className="min-w-48 flex-1">
                <div className="font-bold text-gray-900">{advance.staff_name}</div>
                <div className="text-xs text-gray-500">{advance.reason || 'بدون سبب مسجل'}</div>
              </div>
              <div className="font-black text-gray-800">{Number(advance.amount).toLocaleString('ar-EG-u-nu-latn')} {advance.currency}</div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-gray-600">{LABELS[advance.status]}</span>
              {!financeMode && advance.status === 'PENDING' && (
                <div className="flex gap-2">
                  <button disabled={busy === advance.id || !deductPeriod} onClick={() => changeStatus(advance, 'APPROVED')}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">اعتماد</button>
                  <button disabled={busy === advance.id} onClick={() => changeStatus(advance, 'REJECTED')}
                    className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-50">رفض</button>
                </div>
              )}
              {advance.status === 'APPROVED' && canDisburse && (
                <button disabled={busy === advance.id} onClick={() => disburse(advance)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">صرف وترحيل القيد</button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
