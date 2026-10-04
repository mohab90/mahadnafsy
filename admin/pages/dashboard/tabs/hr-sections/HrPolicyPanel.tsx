import { useCallback, useEffect, useState } from 'react';
import { CalendarCog, ChevronDown, ChevronUp } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { cairoDaysAhead } from '../../../../../shared/cairoDate';

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
  // The attendance rules the fingerprint sheet is judged by (migration 243).
  work_start_time?: string;
  work_end_time?: string;
  morning_permit_minutes?: number;
  evening_permit_minutes?: number;
  morning_permits_per_month?: number;
  evening_permits_per_month?: number;
  late_tiers_json?: { over: number; days: number }[];
  early_leave_tiered?: number;
};
type Draft = Omit<Policy, 'id' | 'version' | 'effective_to'>;

const tomorrow = () => cairoDaysAhead(1);
const fromPolicy = (policy?: Policy): Draft => ({
  annual_leave_days: Number(policy?.annual_leave_days ?? 21),
  sick_leave_days: Number(policy?.sick_leave_days ?? 14),
  work_days_per_month: Number(policy?.work_days_per_month ?? 26),
  workday_minutes: Number(policy?.workday_minutes ?? 480),
  grace_minutes: Number(policy?.grace_minutes ?? 15),
  overtime_multiplier: Number(policy?.overtime_multiplier ?? 1.5),
  audit_retention_days: Number(policy?.audit_retention_days ?? 2555),
  weekend_days_json: policy?.weekend_days_json ?? [5],
  effective_from: tomorrow(),
  work_start_time: String(policy?.work_start_time ?? '11:00').slice(0, 5),
  work_end_time: String(policy?.work_end_time ?? '18:30').slice(0, 5),
  morning_permit_minutes: Number(policy?.morning_permit_minutes ?? 120),
  evening_permit_minutes: Number(policy?.evening_permit_minutes ?? 90),
  morning_permits_per_month: Number(policy?.morning_permits_per_month ?? 1),
  evening_permits_per_month: Number(policy?.evening_permits_per_month ?? 1),
  late_tiers_json: policy?.late_tiers_json ?? [{ over: 10, days: 0.25 }, { over: 30, days: 0.5 }, { over: 120, days: 1 }],
  early_leave_tiered: Number(policy?.early_leave_tiered ?? 1),
});
const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAY_FRACTIONS: [number, string][] = [[0.25, 'ربع يوم'], [0.5, 'نص يوم'], [0.75, 'تلات تربع'], [1, 'يوم كامل']];

export default function HrPolicyPanel({ notify }: { notify: Notify }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(fromPolicy());
  const current = policies[0];
  // Automatic absence is a separate switch from the policy versions: it is not a
  // number that applies from a date, it is whether the system marks the day.
  const [autoAbsence, setAutoAbsence] = useState<boolean | null>(null);
  useEffect(() => {
    mysqlAdmin.adminGet<{ enabled: boolean }>('/admin/hr/auto-absence')
      .then(result => setAutoAbsence(Boolean(result.enabled)))
      .catch(() => setAutoAbsence(null));
  }, []);
  const toggleAutoAbsence = async () => {
    const next = !autoAbsence;
    try {
      await mysqlAdmin.adminPut('/admin/hr/auto-absence', { enabled: next });
      setAutoAbsence(next);
      notify('success', next ? 'تم تفعيل الغياب التلقائي — من الليلة بيتسجل غياب لأي يوم عمل محدش سجّل فيه حاجة' : 'تم إيقاف الغياب التلقائي');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تغيير الإعداد');
    }
  };
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
          العمل {String(current.work_start_time ?? '11:00').slice(0, 5)}–{String(current.work_end_time ?? '18:30').slice(0, 5)} · إجازة {(current.weekend_days_json || []).map(d => DAY_NAMES[d]).join(' و')} · سنوي {current.annual_leave_days} يوم · سارية من {String(current.effective_from).slice(0, 10)}
        </p>
      )}
      {open && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          {autoAbsence !== null && (
            <label className="flex items-start gap-2 text-xs text-gray-700 bg-gray-50 rounded-lg p-2 mb-3 cursor-pointer">
              <input type="checkbox" checked={autoAbsence} onChange={toggleAutoAbsence} className="mt-0.5" />
              <span>
                <b>غياب تلقائي</b> — أي موظف له جدول عمل ومسجّلش حضور ولا إجازة في يوم عمل يتسجل له «غياب» تلقائي ويتخصم في المسير.
                <span className="block text-gray-500">مقفول افتراضيًا. فعّله بعد ما كل الموظفين يبدأوا يسجلوا حضور، وإلا هيتخصم منهم أيام مش غايبينها.</span>
              </span>
            </label>
          )}
          <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">
            الحفظ ينشئ نسخة جديدة مؤرخة ولا يغيّر السياسات التاريخية المرتبطة بالطلبات السابقة.
          </p>
          <div className="mb-4 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
            <h4 className="text-sm font-bold text-gray-800">الحضور والانصراف (بيتحسب بيها شيت البصمة)</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <label className="text-xs text-gray-600">بداية العمل
                <input type="time" value={draft.work_start_time} onChange={e => setDraft(v => ({ ...v, work_start_time: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5" />
              </label>
              <label className="text-xs text-gray-600">نهاية العمل
                <input type="time" value={draft.work_end_time} onChange={e => setDraft(v => ({ ...v, work_end_time: e.target.value }))} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5" />
              </label>
              {numberField('morning_permit_minutes', 'الإذن الصباحي (دقيقة)')}
              {numberField('evening_permit_minutes', 'الإذن المسائي (دقيقة)')}
              {numberField('morning_permits_per_month', 'أذونات صباحية في الشهر')}
              {numberField('evening_permits_per_month', 'أذونات مسائية في الشهر')}
            </div>
            <div className="text-xs text-gray-600">
              أيام الإجازة الأسبوعية
              <div className="mt-1 flex flex-wrap gap-2">
                {DAY_NAMES.map((name, day) => (
                  <label key={day} className="flex items-center gap-1 rounded-lg bg-white px-2 py-1">
                    <input type="checkbox" checked={draft.weekend_days_json.includes(day)}
                      onChange={e => setDraft(v => ({ ...v, weekend_days_json: e.target.checked ? [...v.weekend_days_json, day].sort() : v.weekend_days_json.filter(d => d !== day) }))} />
                    {name}
                  </label>
                ))}
              </div>
            </div>
            <div className="text-xs text-gray-600">
              خصم التأخير
              <div className="mt-1 space-y-1.5">
                {(draft.late_tiers_json || []).map((tier, index) => (
                  <div key={index} className="flex flex-wrap items-center gap-2">
                    <span>تأخير أكتر من</span>
                    <input type="number" min={0} value={tier.over} className="w-20 border border-gray-200 rounded-lg px-2 py-1"
                      onChange={e => setDraft(v => ({ ...v, late_tiers_json: (v.late_tiers_json || []).map((t, i) => (i === index ? { ...t, over: Number(e.target.value) } : t)) }))} />
                    <span>دقيقة يخصم</span>
                    <select value={tier.days} className="border border-gray-200 rounded-lg px-2 py-1"
                      onChange={e => setDraft(v => ({ ...v, late_tiers_json: (v.late_tiers_json || []).map((t, i) => (i === index ? { ...t, days: Number(e.target.value) } : t)) }))}>
                      {DAY_FRACTIONS.map(([days, label]) => <option key={days} value={days}>{label}</option>)}
                    </select>
                    <button type="button" className="text-red-500" onClick={() => setDraft(v => ({ ...v, late_tiers_json: (v.late_tiers_json || []).filter((_, i) => i !== index) }))}>حذف</button>
                  </div>
                ))}
                {(draft.late_tiers_json || []).length < 6 && (
                  <button type="button" className="text-indigo-600" onClick={() => setDraft(v => ({ ...v, late_tiers_json: [...(v.late_tiers_json || []), { over: 60, days: 0.5 }] }))}>+ شريحة</button>
                )}
              </div>
              <label className="mt-2 flex items-center gap-1.5">
                <input type="checkbox" checked={Boolean(draft.early_leave_tiered)} onChange={e => setDraft(v => ({ ...v, early_leave_tiered: e.target.checked ? 1 : 0 }))} />
                نفس الخصم على الانصراف بدري
              </label>
            </div>
          </div>
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
