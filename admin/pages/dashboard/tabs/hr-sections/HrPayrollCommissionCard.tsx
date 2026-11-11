// «حوافز المبيعات التلقائية في المسير» (10 Nov 2026; api/lib/payrollCommission.js). Payroll adds no sales commission of its own unless it is switched on here:
// for the whole team, and — replacing the team's rule — for one department or one employee. A rule is worked out from the commission rules written at
// payment time, or as a percentage of the employee's course sales in the month. Saved, it applies from the next payroll calculation.
import { useCallback, useEffect, useState } from 'react';
import { Loader2, Percent, Plus, Save, Trash2 } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { fromCommissionSettings, toCommissionSettings, type CommissionException, type CommissionMode, type CommissionSettings } from './payrollCommissionForm';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Answer = { settings: CommissionSettings; departments: { id: string; name: string }[]; staff: { id: string; name: string; department_id: string | null }[] };

const MODE_LABELS: Record<CommissionMode, string> = {
  OFF: 'مقفولة',
  RULES: 'قواعد العمولات المسجّلة وقت الدفع',
  PERCENT: 'نسبة من مبيعات الموظف في الشهر',
};
const field = 'rounded-lg border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-50';

function ModeFields({ mode, rate, modes, disabled, onChange }: {
  mode: CommissionMode; rate: string; modes: CommissionMode[]; disabled: boolean; onChange: (patch: { mode?: CommissionMode; rate?: string }) => void;
}) {
  return (
    <>
      <select className={field} disabled={disabled} value={mode} onChange={e => onChange({ mode: e.target.value as CommissionMode })} aria-label="طريقة الحساب">
        {modes.map(value => <option key={value} value={value}>{MODE_LABELS[value]}</option>)}
      </select>
      {mode === 'PERCENT' && (
        <label className="flex items-center gap-1 text-xs text-gray-600">
          <input type="number" min={0.01} max={100} step={0.25} dir="ltr" disabled={disabled} className={`${field} w-20`} value={rate} onChange={e => onChange({ rate: e.target.value })} aria-label="النسبة" />
          <Percent size={12} />
        </label>
      )}
    </>
  );
}

export default function HrPayrollCommissionCard({ notify, canEdit }: { notify: Notify; canEdit: boolean }) {
  const [lists, setLists] = useState<Pick<Answer, 'departments' | 'staff'> | null>(null);
  const [team, setTeam] = useState<{ mode: CommissionMode; rate: string }>({ mode: 'OFF', rate: '' });
  const [exceptions, setExceptions] = useState<CommissionException[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const answer = await mysqlAdmin.adminGet<Answer>('/admin/hr/payroll-commission');
      const form = fromCommissionSettings(answer.settings);
      setTeam(form.team);
      setExceptions(form.exceptions);
      setLists({ departments: answer.departments, staff: answer.staff });
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر تحميل إعداد حوافز المسير'); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const built = toCommissionSettings({ team, exceptions });
    if ('error' in built) { notify('error', built.error); return; }
    setSaving(true);
    try {
      await mysqlAdmin.adminPut('/admin/hr/payroll-commission', { settings: built.settings });
      notify('success', 'اتحفظ إعداد حوافز المسير — هيسري من أول حساب مسير جاي');
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذّر الحفظ'); } finally { setSaving(false); }
  };

  if (!lists) return <div className="flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-400"><Loader2 size={16} className="animate-spin" /> جاري التحميل…</div>;
  const on = team.mode !== 'OFF';
  const disabled = !canEdit;
  const editException = (index: number, patch: Partial<CommissionException>) => setExceptions(rows => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-gray-900">حوافز المبيعات التلقائية في المسير</h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {on ? 'شغّالة: المسير بيضيف حوافز مبيعات بيحسبها هو، فوق مكافآت الروندات والمكافآت اليدوية.' : 'مقفولة: المسير بيضيف مكافآت الروندات المعتمدة والمكافآت اليدوية بس، ومش بيحسب حاجة من نفسه.'}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label="تشغيل حوافز المبيعات التلقائية للفريق كله" disabled={disabled}
          onClick={() => setTeam(current => ({ ...current, mode: on ? 'OFF' : 'RULES' }))}
          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-600' : 'bg-gray-300'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? 'right-0.5' : 'right-[1.375rem]'}`} />
        </button>
      </div>

      {on && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50/60 p-3">
          <span className="text-xs font-bold text-gray-700">الفريق كله بيتحسب بـ</span>
          <ModeFields mode={team.mode} rate={team.rate} modes={['RULES', 'PERCENT']} disabled={disabled} onChange={patch => setTeam(current => ({ ...current, ...patch }))} />
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs font-bold text-gray-700">قاعدة مختلفة لقسم أو لموظف</p>
        <p className="mt-0.5 text-[11px] text-gray-500">قاعدة الموظف بتغلب قاعدة قسمه، وقاعدة القسم بتغلب قاعدة الفريق. ينفع تشغّلها لشخص واحد والفريق مقفول، أو تقفلها لشخص والفريق شغّال.</p>
        <div className="mt-2 space-y-2">
          {exceptions.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 p-2">
              <select className={field} disabled={disabled} value={row.scope} onChange={e => editException(index, { scope: e.target.value as CommissionException['scope'], id: '' })} aria-label="قسم أو موظف">
                <option value="department">قسم</option>
                <option value="staff">موظف</option>
              </select>
              <select className={`${field} min-w-[11rem]`} disabled={disabled} value={row.id} onChange={e => editException(index, { id: e.target.value })} aria-label={row.scope === 'department' ? 'القسم' : 'الموظف'}>
                <option value="">اختر…</option>
                {(row.scope === 'department' ? lists.departments : lists.staff).map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
              <ModeFields mode={row.mode} rate={row.rate} modes={['OFF', 'RULES', 'PERCENT']} disabled={disabled} onChange={patch => editException(index, patch)} />
              {canEdit && <button type="button" onClick={() => setExceptions(rows => rows.filter((_, i) => i !== index))} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="حذف القاعدة"><Trash2 size={14} /></button>}
            </div>
          ))}
          {exceptions.length === 0 && <p className="text-xs text-gray-400">مفيش — الكل على قاعدة الفريق.</p>}
        </div>
      </div>

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setExceptions(rows => [...rows, { scope: 'department', id: '', mode: 'RULES', rate: '' }])} className="flex items-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-200"><Plus size={13} /> قاعدة لقسم أو موظف</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="flex items-center gap-1 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} حفظ
          </button>
        </div>
      )}
    </section>
  );
}
