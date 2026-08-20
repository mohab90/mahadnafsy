import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

interface ReconciliationCheck {
  key: string;
  severity: 'critical' | 'warning';
  count: number;
  rows: Record<string, unknown>[];
}

interface ReconciliationData {
  ok: boolean;
  criticalCount: number;
  checks: ReconciliationCheck[];
  checkedAt: string;
}

const labels: Record<string, string> = {
  paid_without_journal: 'مدفوعات بلا قيد محاسبي',
  unbalanced_journal: 'قيود غير متوازنة',
  paid_without_fx_snapshot: 'مدفوعات بلا تثبيت سعر صرف',
  payment_ledger_amount_mismatch: 'فرق بين الدفعة والقيد',
  paid_without_enrollment: 'مدفوعات بلا اشتراك في الكورس',
  converted_without_subscriber: 'Leads محولة بلا عميل',
  paid_order_without_payment: 'طلبات مدفوعة بلا حركة دفع',
  approved_proof_without_payment: 'إيصالات معتمدة بلا دفعة',
  paid_without_audit: 'مدفوعات بلا سجل تدقيق',
  commission_missing: 'عمولات مفقودة',
  instructor_fee_missing: 'حصص محاضرين مفقودة',
  dead_customer_messages: 'رسائل عملاء فشلت نهائيًا',
  failed_finance_events: 'أحداث مالية فشلت وتحتاج إعادة محاولة',
};

export default function ReconciliationPanel({ branchFilter }: { branchFilter?: string }) {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const query = branchFilter ? `?branch=${encodeURIComponent(branchFilter)}` : '';
    try { setData(await mysqlAdmin.adminGet<ReconciliationData>(`/admin/reconciliation-dashboard${query}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'تعذر تشغيل المطابقة'); }
    finally { setLoading(false); }
  }, [branchFilter]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <div><h3 className="font-extrabold text-gray-900">مطابقة المحاسبة ورحلة العميل</h3><p className="text-xs text-gray-500">المدفوعات والقيود والاشتراكات والتحويلات من نفس قاعدة البيانات.</p></div>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث</button>
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
      {data && <>
        <div className={`flex items-center gap-3 rounded-2xl border p-4 ${data.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {data.ok ? <CheckCircle2 className="text-green-600" /> : <AlertTriangle className="text-red-600" />}
          <div><div className="font-extrabold text-gray-900">{data.ok ? 'المطابقة سليمة' : `${data.criticalCount} مشكلة حرجة تحتاج مراجعة`}</div><div className="text-xs text-gray-500">آخر فحص: {new Date(data.checkedAt).toLocaleString('ar-EG-u-nu-latn')}</div></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.checks.map(check => <article key={check.key} className={`rounded-2xl border bg-white p-4 ${check.count ? (check.severity === 'critical' ? 'border-red-200' : 'border-amber-200') : 'border-gray-200'}`}>
            <div className="text-sm font-bold text-gray-700">{labels[check.key] || check.key}</div>
            <div className={`mt-2 text-3xl font-black ${check.count ? 'text-red-600' : 'text-green-600'}`}>{check.count}</div>
            {check.rows.slice(0, 3).map((row, index) => <div key={String(row.id || index)} className="mt-2 truncate rounded-lg bg-gray-50 px-2 py-1 text-[11px] text-gray-600">{String(row.id || row.name || row.item_title || 'سجل يحتاج مراجعة')}</div>)}
          </article>)}
        </div>
      </>}
    </section>
  );
}
