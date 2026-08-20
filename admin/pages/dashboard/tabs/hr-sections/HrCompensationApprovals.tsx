import { useCallback, useEffect, useState } from 'react';
import { BadgeDollarSign, Check, X } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Item = {
  id: string;
  staff_name: string;
  amount: number;
  currency: string;
  created_by_name?: string;
};
type Pending = { salaries: Item[]; adjustments: Item[]; fees: Item[]; rates: Item[] };
type Kind = keyof Pending;
const EMPTY: Pending = { salaries: [], adjustments: [], fees: [], rates: [] };
const LABEL: Record<Kind, string> = {
  salaries: 'تعديلات الرواتب',
  adjustments: 'المكافآت والخصومات',
  fees: 'أجور المدربين',
  rates: 'تعديلات أسعار المدربين',
};

export default function HrCompensationApprovals({ notify }: { notify: Notify }) {
  const [pending, setPending] = useState<Pending>(EMPTY);
  const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setPending(await mysqlAdmin.adminGet<Pending>('/admin/hr/compensation/pending')); }
    catch { notify('error', 'تعذر تحميل اعتمادات التعويضات'); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);
  const total = Object.values(pending).reduce((sum, rows) => sum + rows.length, 0);

  const review = async (kind: Kind, item: Item, approve: boolean) => {
    setBusy(item.id);
    try {
      if (kind === 'salaries') {
        await mysqlAdmin.adminPut(`/admin/hr/salary/${item.id}/status`, { status: approve ? 'APPROVED' : 'REJECTED' });
      } else if (kind === 'adjustments') {
        await mysqlAdmin.adminPut(`/admin/hr/bonuses/${item.id}/status`, { status: approve ? 'APPROVED' : 'REJECTED' });
      } else if (kind === 'fees') {
        await mysqlAdmin.adminPatch(`/admin/hr/instructor-fees/${item.id}`, { status: approve ? 'approved' : 'rejected' });
      } else {
        await mysqlAdmin.adminPut(`/admin/hr/instructor-rate-proposals/${item.id}/status`, { status: approve ? 'APPROVED' : 'REJECTED' });
      }
      await load();
      notify('success', approve ? 'تم الاعتماد' : 'تم الرفض');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تنفيذ المراجعة');
    } finally { setBusy(''); }
  };

  if (!total) {
    return <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-emerald-700">لا توجد تعديلات مالية معلقة للاعتماد.</div>;
  }
  return (
    <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm">
      <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-3">
        <BadgeDollarSign size={17} className="text-amber-600" />
        اعتمادات التعويضات المعلقة
        <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">{total}</span>
      </h3>
      <div className="space-y-3">
        {(Object.keys(pending) as Kind[]).map(kind => pending[kind].length > 0 && (
          <div key={kind}>
            <p className="text-xs font-bold text-gray-500 mb-1">{LABEL[kind]}</p>
            {pending[kind].map(item => (
              <div key={item.id} className="flex flex-wrap items-center gap-2 border-t border-gray-50 py-2 text-xs">
                <span className="font-bold text-gray-800">{item.staff_name}</span>
                <span className="text-gray-600">{Number(item.amount).toLocaleString('ar-EG-u-nu-latn')} {item.currency}</span>
                <span className="text-gray-400">{item.created_by_name ? `أنشأه ${item.created_by_name}` : ''}</span>
                <span className="flex-1" />
                <button disabled={busy === item.id} onClick={() => review(kind, item, false)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 text-red-700 disabled:opacity-50"><X size={12} /> رفض</button>
                <button disabled={busy === item.id} onClick={() => review(kind, item, true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white disabled:opacity-50"><Check size={12} /> اعتماد</button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
