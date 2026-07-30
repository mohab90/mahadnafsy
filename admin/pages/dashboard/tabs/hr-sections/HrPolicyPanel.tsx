import { useCallback, useEffect, useState } from 'react';
import { CalendarCog, ChevronDown, ChevronUp } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Policy = {
  id: string;
  version: number;
  annual_leave_days: number;
  sick_leave_days: number;
  work_days_per_month: number;
  workday_minutes: number;
  grace_minutes: number;
  overtime_multiplier: number;
  audit_retention_days: number;
  weekend_days_json: number[];
  effective_from: string;
  effective_to: string | null;
};
type Draft = Omit<Policy, 'id' | 'version' | 'effective_to'>;

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const fromPolicy = (policy?: Policy): Draft => ({
  annual_leave_days: Number(policy?.annual_leave_days ?? 21),
  sick_leave_days: Number(policy?.sick_leave_days ?? 14),
  work_days_per_month: Number(policy?.work_days_per_month ?? 26),
  workday_minutes: Number(policy?.workday_minutes ?? 480),
  grace_minutes: Number(policy?.grace_minutes ?? 15),
  overtime_multiplier: Number(policy?.overtime_multiplier ?? 1.5),
  audit_retention_days: Number(policy?.audit_retention_days ?? 2555),
  weekend_days_json: policy?.weekend_days_json ?? [5, 6],
  effective_from: tomorrow(),
});

export default function HrPolicyPanel({ notify }: { notify: Notify }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(fromPolicy());
  const current = policies[0];
  const load = useCallback(async () => {
    try {
      const rows = await mysqlAdmin.adminGet<Policy[]>('/admin/hr/policies');
      setPolicies(rows);
      setDraft(fromPolicy(rows[0]));
    } catch { notify('error', 'تعذر تحميل سياسة الموارد البشرية'); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await mysqlAdmin.adminPost('/admin/hr/policies', draft);
      await load();
      setOpen(false);
      notify('success', 'تم حفظ نسخة جديدة من سياسة الموارد البشرية');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ السياسة');
    } finally { setSaving(false); }
  };
  const numberField = (key: keyof Draft, label: string, step = 1) => (
    <label className="text-xs text-gray-600">
      {label}
      <input
        type="number"
        min={0}
        step={step}
        value={draft[key] as number}
        onChange={event => setDraft(value => ({ ...value, [key]: Number(event.target.value) }))}
        className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5"
      />
    </label>
  );

  return (
    <div className="bg-white border border-indigo-100 rounded-2xl p-4 shadow-sm">
      <button onClick={() => setOpen(value => !value)} className="w-full flex items-center justify-between text-right">
        <span className="flex items-center gap-2 font-bold text-gray-800">
          <CalendarCog size={17} className="text-indigo-600" />
          سياسة الحضور والإجازات
          {current && <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">نسخة {current.version}</span>}
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {current && !open && (
        <p className="text-xs text-gray-500 mt-2">
          سنوي {current.annual_leave_days} يوم · مرضي {current.sick_leave_days} يوم · سماح {current.grace_minutes} دقيقة · سارية من {String(current.effective_from).slice(0, 10)}
        </p>
      )}
      {open && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">
            الحفظ ينشئ نسخة جديدة مؤرخة ولا يغيّر السياسات التاريخية المرتبطة بالطلبات السابقة.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {numberField('annual_leave_days', 'الإجازة السنوية')}
            {numberField('sick_leave_days', 'الإجازة المرضية')}
            {numberField('work_days_per_month', 'أيام العمل/الشهر', 0.5)}
            {numberField('workday_minutes', 'دقائق يوم العمل')}
            {numberField('grace_minutes', 'دقائق السماح')}
            {numberField('overtime_multiplier', 'معامل الإضافي', 0.1)}
            {numberField('audit_retention_days', 'حفظ سجلات التدقيق/يوم')}
            <label className="text-xs text-gray-600 col-span-2">
              تاريخ السريان
              <input
                type="date"
                min={tomorrow()}
                value={draft.effective_from}
                onChange={event => setDraft(value => ({ ...value, effective_from: event.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5"
              />
            </label>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="mt-3 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50"
          >
            {saving ? 'جارٍ الحفظ...' : 'حفظ نسخة سياسة جديدة'}
          </button>
        </div>
      )}
    </div>
  );
}
