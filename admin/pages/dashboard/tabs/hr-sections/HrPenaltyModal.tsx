// «ضيف زر فوق اضيف فيه خصم جزاء من المدير»: a penalty the manager orders for one employee's month, as an amount or as days at the day's pay (a thirtieth of the
// basic salary), with the reason. The owner's order is final at once; anyone else's waits for a second person's approval.
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../../../../../shared/ui/Modal';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { fmtMoney } from './hrFormat';

const PAY_MONTH_DAYS = 30; // api/lib/payrollCalc.js
const field = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm';

export default function HrPenaltyModal({ employees, month, notify, onClose, onSaved }: {
  employees: { id: string; name: string; base_salary?: number | null }[]; month: string;
  notify: (type: 'success' | 'error' | 'info', message: string) => void; onClose: () => void; onSaved: () => void;
}) {
  const [staffId, setStaffId] = useState('');
  const [by, setBy] = useState<'days' | 'amount'>('days');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const employee = employees.find(row => row.id === staffId);
  const preview = by === 'days' && employee?.base_salary && Number(value) > 0 ? (Number(employee.base_salary) / PAY_MONTH_DAYS) * Number(value) : null;

  const save = async () => {
    const [y, m] = month.split('-');
    if (!staffId) { notify('error', 'اختار الموظف'); return; }
    if (!(Number(value) > 0)) { notify('error', by === 'days' ? 'اكتب عدد الأيام' : 'اكتب المبلغ'); return; }
    if (!reason.trim()) { notify('error', 'اكتب سبب الجزاء'); return; }
    setSaving(true);
    try {
      const result = await mysqlAdmin.adminPost<{ amount: number; status: string }>('/admin/hr/month-penalties', {
        staffId, month: parseInt(m, 10), year: Number(y), reason: reason.trim(), ...(by === 'days' ? { days: Number(value) } : { amount: Number(value) }),
      });
      notify('success', result.status === 'APPROVED'
        ? `اتخصم ${fmtMoney(result.amount)} من ${employee?.name} وبيدخل في مسير ${month}`
        : `الجزاء (${fmtMoney(result.amount)}) اتسجل وبيستنى اعتماد حد تاني`);
      onSaved();
      onClose();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الجزاء');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={`خصم جزاء من المدير — ${month}`} size="md">
      <div className="space-y-3" dir="rtl">
        <label className="block text-xs text-gray-600">الموظف
          <select className={field} value={staffId} onChange={e => setStaffId(e.target.value)}>
            <option value="">اختار الموظف</option>
            {employees.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">الخصم بـ
            <select className={field} value={by} onChange={e => setBy(e.target.value as 'days' | 'amount')}>
              <option value="days">أيام (يوم = ١/٣٠ من الراتب)</option><option value="amount">مبلغ (ج.م)</option></select></label>
          <label className="text-xs text-gray-600">{by === 'days' ? 'عدد الأيام' : 'المبلغ'}
            <input type="number" min={0} step={by === 'days' ? 0.25 : 1} className={field} value={value} onChange={e => setValue(e.target.value)} /></label>
        </div>
        {by === 'days' && employee && !employee.base_salary && <p className="text-xs font-bold text-red-600">الراتب الأساسي لـ {employee.name} فاضي — اخصم بمبلغ.</p>}
        {preview !== null && <p className="text-xs text-gray-500">هيتخصم حوالي {fmtMoney(Math.round(preview * 100) / 100)} من راتب {employee?.name}.</p>}
        <label className="block text-xs text-gray-600">السبب (بيظهر للموظف)
          <textarea className={`${field} min-h-[70px]`} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-gray-100 px-4 py-2 text-xs font-bold text-gray-700">إلغاء</button>
          <button type="button" disabled={saving} onClick={() => void save()} className="flex items-center gap-1 rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {saving && <Loader2 size={13} className="animate-spin" />} تسجيل الجزاء
          </button>
        </div>
      </div>
    </Modal>
  );
}
