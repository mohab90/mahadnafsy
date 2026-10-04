// «بيانات الموظفين»: every employee's basic salary, fingerprint-device number
// and monthly target on one screen (GET/PUT /admin/hr/staff-basics).
//
// The salary here is what payroll uses when no salary structure is approved;
// the device number is what an uploaded fingerprint sheet is matched on; the
// target is counted in clients, bookings or money by the performance report.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Fingerprint, Save, Search } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { ROLE_LABELS } from './hrLabels';

type Notify = (type: 'success' | 'error' | 'info', message: string) => void;
type Row = {
  id: string; name: string; role: string;
  baseSalary: number | null; biometricNo: string;
  targetType: 'clients' | 'bookings' | 'egp' | null; targetValue: number | null; targetBonus: number | null;
};
type Draft = Partial<Pick<Row, 'baseSalary' | 'biometricNo' | 'targetType' | 'targetValue' | 'targetBonus'>>;

const TARGET_LABEL: Record<string, string> = { clients: 'عدد عملاء', bookings: 'عدد حجوزات', egp: 'فلوس (ج.م)' };

export default function HrStaffBasicsPanel({ notify, canEditSalary }: { notify: Notify; canEditSalary: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await mysqlAdmin.adminGet<Row[]>('/admin/hr/staff-basics')); setDrafts({}); }
    catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر تحميل الموظفين'); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);

  const value = <K extends keyof Draft>(row: Row, key: K): Row[K] => (key in (drafts[row.id] || {}) ? drafts[row.id][key] : row[key]) as Row[K];
  const change = (id: string, patch: Draft) => setDrafts(current => ({ ...current, [id]: { ...current[id], ...patch } }));
  const num = (text: string) => (text.trim() === '' ? null : Number(text));
  const changed = Object.keys(drafts).length;

  const shown = useMemo(() => {
    const q = search.trim();
    return q ? rows.filter(r => r.name.includes(q) || r.biometricNo.includes(q)) : rows;
  }, [rows, search]);
  const missing = rows.filter(r => !r.biometricNo).length;
  const noSalary = rows.filter(r => !(Number(r.baseSalary) > 0)).length;

  const save = async () => {
    setSaving(true);
    try {
      const payload = Object.entries(drafts).map(([id, draft]) => ({ id, ...draft }));
      const result = await mysqlAdmin.adminPut<{ updated: number }>('/admin/hr/staff-basics', { rows: payload });
      notify('success', `اتحفظ ${result.updated} موظف`);
      await load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'تعذر الحفظ'); }
    finally { setSaving(false); }
  };

  const cell = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm w-full focus:border-indigo-400 focus:outline-none';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
        <Fingerprint size={20} className="text-indigo-600" />
        <div className="flex-1 min-w-[200px]">
          <h3 className="font-bold text-gray-800">بيانات الموظفين</h3>
          <p className="text-xs text-gray-500">الراتب الأساسي، رقم البصمة على الجهاز، والتارجت الشهري لكل موظف.
            {(missing > 0 || noSalary > 0) && <span className="text-amber-700"> {missing > 0 && `${missing} من غير رقم بصمة`}{missing > 0 && noSalary > 0 && ' · '}{noSalary > 0 && `${noSalary} من غير راتب`}</span>}
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="دوّر باسم أو رقم بصمة" className="rounded-xl border border-gray-200 py-2 pl-3 pr-8 text-sm" />
        </div>
        <button type="button" onClick={save} disabled={!changed || saving}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
          <Save size={15} /> {saving ? 'جارٍ الحفظ...' : changed ? `حفظ (${changed})` : 'حفظ'}
        </button>
      </div>
      {!canEditSalary && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">تعديل الراتب محتاج صلاحية الحسابات — باقي الخانات متاحة.</p>}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50 text-right text-xs font-bold text-gray-500">
              <th className="px-3 py-2">الموظف</th>
              <th className="px-3 py-2 w-32">رقم البصمة</th>
              <th className="px-3 py-2 w-36">الراتب الأساسي (ج.م)</th>
              <th className="px-3 py-2 w-40">نوع التارجت</th>
              <th className="px-3 py-2 w-32">التارجت الشهري</th>
              <th className="px-3 py-2 w-32">مكافأة التارجت</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={6} className="py-10 text-center text-gray-400">جاري التحميل…</td></tr>
            ) : shown.map(row => (
              <tr key={row.id} className={drafts[row.id] ? 'bg-indigo-50/40' : ''}>
                <td className="px-3 py-2">
                  <div className="font-bold text-gray-800">{row.name}</div>
                  <div className="text-[11px] text-gray-400">{ROLE_LABELS[row.role?.toLowerCase?.()] || ROLE_LABELS[row.role] || row.role}</div>
                </td>
                <td className="px-3 py-2"><input dir="ltr" className={cell} value={value(row, 'biometricNo') ?? ''} onChange={e => change(row.id, { biometricNo: e.target.value.trim() })} placeholder="مثلاً 7" /></td>
                <td className="px-3 py-2"><input type="number" min={0} className={cell} disabled={!canEditSalary} value={value(row, 'baseSalary') ?? ''} onChange={e => change(row.id, { baseSalary: num(e.target.value) })} /></td>
                <td className="px-3 py-2">
                  <select className={cell} value={value(row, 'targetType') ?? ''} onChange={e => change(row.id, { targetType: (e.target.value || null) as Row['targetType'] })}>
                    <option value="">بدون تارجت</option>
                    {Object.entries(TARGET_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2"><input type="number" min={0} className={cell} value={value(row, 'targetValue') ?? ''} onChange={e => change(row.id, { targetValue: num(e.target.value) })} /></td>
                <td className="px-3 py-2"><input type="number" min={0} className={cell} value={value(row, 'targetBonus') ?? ''} onChange={e => change(row.id, { targetBonus: num(e.target.value) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
