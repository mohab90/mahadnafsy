import React, { useEffect, useState, useCallback } from 'react';
import { UserPlus, RefreshCw, UserCheck, UserX } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { RegistrationItem } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

// Self-registered accounts (/api/user/signup) that staff haven't triaged yet
// — neither a CRM lead nor an online client. Two explicit outcomes per row:
// promote to a paying-track online client, or send to the CRM as a lead.
const RegistrationsTab: React.FC<Props> = ({ notify }) => {
  const [rows, setRows] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.listRegistrations()
      .then(setRows)
      .catch(err => notify('error', err instanceof Error ? err.message : 'تعذر تحميل التسجيلات'))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const convert = async (id: string, kind: 'online' | 'lead') => {
    setBusyId(id);
    try {
      if (kind === 'online') await mysqlAdmin.convertRegistrationToOnline(id);
      else await mysqlAdmin.convertRegistrationToLead(id);
      notify('success', kind === 'online' ? 'تم التحويل لعميل أونلاين' : 'تم الإرجاع لعميل محتمل');
      setRows(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر التحويل');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <UserPlus size={22} className="text-primary-600" />
            التسجيلات
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            حسابات سجّلت بنفسها ولسه معملتش أي حاجة — مش عميل محتمل ومش عميل أونلاين. حوّلها للاتجاه الصح.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          تحديث
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
          جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-gray-400">
          لا توجد تسجيلات بانتظار التصنيف حاليًا.
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-2.5 font-bold">الاسم</th>
                <th className="px-4 py-2.5 font-bold">البريد الإلكتروني</th>
                <th className="px-4 py-2.5 font-bold">رقم الهاتف</th>
                <th className="px-4 py-2.5 font-bold">تاريخ التسجيل</th>
                <th className="px-4 py-2.5 font-bold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-3 font-medium text-gray-800">{r.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">{r.email || '—'}</td>
                  <td className="px-4 py-3 text-gray-600" dir="ltr">{r.phone || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.created_at).toLocaleString('ar-EG')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => convert(r.id, 'online')}
                        disabled={busyId === r.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition disabled:opacity-40"
                      >
                        <UserCheck size={13} /> عميل أونلاين
                      </button>
                      <button
                        onClick={() => convert(r.id, 'lead')}
                        disabled={busyId === r.id}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 hover:bg-amber-100 transition disabled:opacity-40"
                      >
                        <UserX size={13} /> عميل محتمل
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default RegistrationsTab;
