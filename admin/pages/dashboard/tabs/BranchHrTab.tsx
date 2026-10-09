import { useCallback, useEffect, useState } from 'react';
import { CalendarX, Check, UserPlus, Users, X } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { Modal } from '../../../../shared/ui/Modal';
import { usePhysicalBranch } from '../../../lib/physicalBranch';
import { cairoDay } from '../../../../shared/cairoDate';

// «نضيف لحساب مدير الدقي نظام الموارد البشريه ولكن فقط علي موظفين الدقي يقدر
// ينشأ حساب ويقدر يشوف الاذونات والغيابات» (9 Oct 2026). The branch's staff, a new
// account for the branch, leave and permission requests, and the month's
// attendance — the server narrows each to the branch (api/lib/branchHr.js).
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Employee = { id: string; name: string; email: string; phone: string; role: string; is_active: number | boolean };
type Leave = { id: string; staff_name: string; type: string; start_date: string; end_date: string; total_days: number; reason: string | null; status: string };
type Summary = { id: string; name: string; present_days: number; absent_days: number; late_days: number; total_late_minutes: number; leave_days: number };

const LEAVE_TYPE: Record<string, string> = {
  ANNUAL: 'إجازة سنوية', SICK: 'مرضي', UNPAID: 'بدون مرتب', EMERGENCY: 'طارئة', MORNING_PERMIT: 'إذن صباحي', EVENING_PERMIT: 'إذن مسائي',
};
const ROLE_LABEL: Record<string, string> = {
  RECEPTION_DAQQI: 'استقبال الدقي', DAQQI_MANAGER: 'مدير الدقي', RECEPTION_TAGAMOA: 'استقبال التجمع', TAGAMOA_MANAGER: 'مدير التجمع',
};

export default function BranchHrTab({ notify }: { notify: NotifyFn }) {
  const branch = usePhysicalBranch();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [busy, setBusy] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    mysqlAdmin.adminGet<Employee[]>('/admin/hr/employees').then(rows => setEmployees(Array.isArray(rows) ? rows : [])).catch(() => setEmployees([]));
    mysqlAdmin.adminGet<Leave[]>('/admin/hr/leaves').then(rows => setLeaves(Array.isArray(rows) ? rows : [])).catch(() => setLeaves([]));
    mysqlAdmin.adminGet<Summary[]>('/admin/hr/attendance/summary').then(rows => setSummary(Array.isArray(rows) ? rows : [])).catch(() => setSummary([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (leave: Leave, status: 'APPROVED' | 'REJECTED') => {
    setBusy(leave.id);
    try {
      await mysqlAdmin.adminPut(`/admin/hr/leaves/${encodeURIComponent(leave.id)}/status`, { status });
      notify('success', status === 'APPROVED' ? 'اتوافق على الطلب' : 'اترفض الطلب');
      load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحفظ'); } finally { setBusy(''); }
  };

  const pending = leaves.filter(leave => leave.status === 'PENDING');
  const card = 'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm';
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-extrabold text-gray-900"><Users size={20} className="text-teal-600" /> موارد بشرية {branch.label}</h2>
        <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-xl bg-teal-600 px-3 py-2 text-xs font-bold text-white hover:bg-teal-700"><UserPlus size={14} /> حساب موظف جديد</button>
      </div>

      <section className={card}>
        <h3 className="mb-2 text-sm font-bold text-gray-800">طلبات الإجازات والأذونات {pending.length ? <span className="rounded-full bg-amber-100 px-2 text-amber-800">{pending.length} مستني</span> : null}</h3>
        {leaves.length === 0 ? <p className="text-xs text-gray-400">مفيش طلبات.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500"><tr>{['الموظف', 'النوع', 'من', 'لحد', 'الأيام', 'السبب', 'الحالة', ''].map(title => <th key={title} className="px-2 py-1.5 text-right">{title}</th>)}</tr></thead>
              <tbody>
                {leaves.slice(0, 60).map(leave => (
                  <tr key={leave.id} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 font-bold">{leave.staff_name}</td>
                    <td className="px-2 py-1.5">{LEAVE_TYPE[leave.type] || leave.type}</td>
                    <td className="px-2 py-1.5">{cairoDay(leave.start_date)}</td>
                    <td className="px-2 py-1.5">{cairoDay(leave.end_date)}</td>
                    <td className="px-2 py-1.5">{leave.total_days}</td>
                    <td className="max-w-[200px] px-2 py-1.5 text-gray-600">{leave.reason || '—'}</td>
                    <td className="px-2 py-1.5">{leave.status === 'PENDING' ? 'مستني' : leave.status === 'APPROVED' ? 'اتوافق' : leave.status === 'REJECTED' ? 'اترفض' : 'اتلغى'}</td>
                    <td className="px-2 py-1.5">
                      {leave.status === 'PENDING' && (
                        <div className="flex flex-nowrap gap-1">
                          <button disabled={busy === leave.id} onClick={() => void decide(leave, 'APPROVED')} className="inline-flex items-center gap-0.5 rounded-md bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-50"><Check size={10} /> موافقة</button>
                          <button disabled={busy === leave.id} onClick={() => void decide(leave, 'REJECTED')} className="inline-flex items-center gap-0.5 rounded-md border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700 disabled:opacity-50"><X size={10} /> رفض</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-800"><CalendarX size={15} className="text-rose-600" /> الحضور والغياب الشهر ده</h3>
        {summary.length === 0 ? <p className="text-xs text-gray-400">مفيش سجلات حضور الشهر ده.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-gray-500"><tr>{['الموظف', 'حضر', 'غاب', 'اتأخر', 'دقايق تأخير', 'إجازات'].map(title => <th key={title} className="px-2 py-1.5 text-right">{title}</th>)}</tr></thead>
              <tbody>
                {summary.map(row => (
                  <tr key={row.id} className="border-t border-gray-100">
                    <td className="px-2 py-1.5 font-bold">{row.name}</td>
                    <td className="px-2 py-1.5">{Number(row.present_days)}</td>
                    <td className={`px-2 py-1.5 font-bold ${Number(row.absent_days) ? 'text-rose-700' : ''}`}>{Number(row.absent_days)}</td>
                    <td className="px-2 py-1.5">{Number(row.late_days)}</td>
                    <td className="px-2 py-1.5">{Number(row.total_late_minutes)}</td>
                    <td className="px-2 py-1.5">{Number(row.leave_days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={card}>
        <h3 className="mb-2 text-sm font-bold text-gray-800">موظفين {branch.label} ({employees.length})</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {employees.map(employee => (
            <div key={employee.id} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
              <div className="font-bold text-gray-800">{employee.name} {!Number(employee.is_active) && <span className="text-[10px] text-gray-400">(موقوف)</span>}</div>
              <div className="text-gray-500">{ROLE_LABEL[String(employee.role).toUpperCase()] || employee.role}</div>
              <div className="text-gray-400" dir="ltr">{employee.phone || employee.email}</div>
            </div>
          ))}
        </div>
      </section>

      {adding && <NewBranchAccount role={branch.key === 'TAGAMOA' ? 'RECEPTION_TAGAMOA' : 'RECEPTION_DAQQI'} notify={notify} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} />}
    </div>
  );
}

// An account for a job of the branch — reception; the server allows a branch
// manager nothing else (api/routes/auth/staffAccounts.js).
function NewBranchAccount({ role, notify, onClose, onSaved }: { role: string; notify: NotifyFn; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm(current => ({ ...current, [key]: event.target.value }));
  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-200';
  const ready = form.name.trim() && /\S+@\S+\.\S+/.test(form.email) && form.password.length >= 8;
  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/staff-account', { ...form, name: form.name.trim(), email: form.email.trim(), role });
      notify('success', `اتعمل حساب ${form.name.trim()}`);
      onSaved();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر إنشاء الحساب'); } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="حساب موظف جديد" subtitle={ROLE_LABEL[role]} size="sm">
      <div className="space-y-2 text-sm" dir="rtl">
        <input value={form.name} onChange={set('name')} placeholder="الاسم" className={field} />
        <input value={form.phone} onChange={set('phone')} placeholder="الموبايل" dir="ltr" className={field} />
        <input value={form.email} onChange={set('email')} placeholder="الإيميل (للدخول)" dir="ltr" className={field} />
        <input value={form.password} onChange={set('password')} type="password" placeholder="كلمة سر (8 حروف على الأقل)" dir="ltr" className={field} autoComplete="new-password" />
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2 hover:bg-gray-50">إلغاء</button>
          <button disabled={!ready || saving} onClick={() => void save()} className="flex-1 rounded-xl bg-teal-600 py-2 font-bold text-white hover:bg-teal-700 disabled:opacity-50">{saving ? '⏳…' : 'إنشاء الحساب'}</button>
        </div>
      </div>
    </Modal>
  );
}
