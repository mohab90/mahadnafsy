import { useState } from 'react';
import { Search } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type AuditRow = {
  id: string; payment_id: string; action: 'create' | 'update' | 'delete';
  old_status: string | null; new_status: string | null; amount: number | null;
  subscriber_id: string | null; subscriber_name: string | null; client_code: string | null;
  actor: string; created_at: string;
};

export function AuditLogPanel() {
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditDateFrom, setAuditDateFrom] = useState('');
  const [auditDateTo, setAuditDateTo] = useState('');

  const loadAuditLog = async (page = 1) => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (auditActionFilter) params.set('action', auditActionFilter);
      if (auditDateFrom) params.set('dateFrom', auditDateFrom);
      if (auditDateTo) params.set('dateTo', auditDateTo);
      const data = await mysqlAdmin.adminGet<{ total: number; rows: AuditRow[] }>(`/api/admin/payment-audit?${params}`);
      setAuditRows(data.rows || []);
      setAuditTotal(data.total || 0);
      setAuditPage(page);
    } catch { /* silently fail */ } finally { setAuditLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">العملية</label>
            <select value={auditActionFilter} onChange={e => setAuditActionFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-300">
              <option value="">كل العمليات</option>
              <option value="create">إنشاء</option>
              <option value="update">تعديل</option>
              <option value="delete">حذف</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">من تاريخ</label>
            <input type="date" value={auditDateFrom} onChange={e => setAuditDateFrom(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">إلى تاريخ</label>
            <input type="date" value={auditDateTo} onChange={e => setAuditDateTo(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <button onClick={() => loadAuditLog(1)} disabled={auditLoading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 transition disabled:opacity-60">
            {auditLoading ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : <Search size={14} />}
            بحث
          </button>
          {(auditActionFilter || auditDateFrom || auditDateTo) && (
            <button onClick={() => { setAuditActionFilter(''); setAuditDateFrom(''); setAuditDateTo(''); }}
              className="px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-500 hover:bg-gray-200 transition">
              مسح الفلاتر
            </button>
          )}
          <span className="text-xs text-gray-400 self-end pb-2">إجمالي: {auditTotal} سجل</span>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-x-auto shadow-sm">
        {auditLoading ? (
          <div className="flex items-center justify-center py-16"><span className="w-8 h-8 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin" /></div>
        ) : auditRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">لا توجد سجلات تدقيق</p>
        ) : (
          <table className="w-full text-sm" dir="rtl">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-100">
                <th className="px-4 py-3 text-right font-semibold">التاريخ</th>
                <th className="px-4 py-3 text-right font-semibold">العميل</th>
                <th className="px-4 py-3 text-right font-semibold">العملية</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة القديمة</th>
                <th className="px-4 py-3 text-right font-semibold">الحالة الجديدة</th>
                <th className="px-4 py-3 text-right font-semibold">المبلغ</th>
                <th className="px-4 py-3 text-right font-semibold">المنفّذ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {auditRows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50 transition">
                  <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{new Date(row.created_at).toLocaleString('ar-EG')}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">{row.subscriber_name || '—'}</div>
                    {row.client_code && <div className="text-xs text-gray-400">{row.client_code}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${row.action === 'create' ? 'bg-emerald-100 text-emerald-700' : row.action === 'update' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                      {row.action === 'create' ? 'إنشاء' : row.action === 'update' ? 'تعديل' : 'حذف'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{row.old_status || '—'}</td>
                  <td className="px-4 py-3 text-xs">
                    {row.new_status ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-bold ${row.new_status === 'paid' ? 'bg-emerald-100 text-emerald-700' : row.new_status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                        {row.new_status}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-700">{row.amount != null ? row.amount.toLocaleString() + ' ج.م' : '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{row.actor || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {auditTotal > 50 && (
        <div className="flex items-center justify-center gap-3">
          <button onClick={() => loadAuditLog(auditPage - 1)} disabled={auditPage <= 1 || auditLoading}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-40">
            السابق
          </button>
          <span className="text-sm text-gray-500">صفحة {auditPage} من {Math.ceil(auditTotal / 50)}</span>
          <button onClick={() => loadAuditLog(auditPage + 1)} disabled={auditPage >= Math.ceil(auditTotal / 50) || auditLoading}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition disabled:opacity-40">
            التالي
          </button>
        </div>
      )}
    </div>
  );
}
