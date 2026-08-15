import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, EyeOff, Eye, Save } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

// Branches drive the pickers on booking, payment, lead capture and course
// interest, and until now they could only be changed in the database: the API
// was read-only. Adding one asked for a key, a type, a timezone and a currency
// before it would accept "فرع المعادي", which is what made it feel impossible.
// Here a name is the only required field.

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

type Branch = {
  id: string;
  branch_key: string;
  label: string;
  branch_type: 'online' | 'physical' | 'hybrid' | 'other';
  timezone?: string;
  currency?: string;
  is_active: number | boolean;
  internal_only: number | boolean;
};

const TYPE_LABEL: Record<string, string> = {
  physical: 'فرع بمقر',
  online: 'أونلاين',
  hybrid: 'مختلط',
  other: 'أخرى',
};

export default function BranchesSettingsTab({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<Branch['branch_type']>('physical');
  const [newCurrency, setNewCurrency] = useState('EGP');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mysqlAdmin.adminGet<Branch[]>('/admin/branches');
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل الفروع');
    } finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!newLabel.trim()) { notify('error', 'اكتب اسم الفرع'); return; }
    setBusy('new');
    try {
      const result = await mysqlAdmin.adminPost<{ ok: boolean; message?: string }>('/admin/branches', {
        label: newLabel.trim(), branch_type: newType, currency: newCurrency,
      });
      notify('success', result?.message || 'تمت إضافة الفرع');
      setNewLabel('');
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إضافة الفرع');
    } finally { setBusy(''); }
  };

  const patch = async (row: Branch, changes: Partial<Branch>, message: string) => {
    setBusy(row.id);
    try {
      await mysqlAdmin.adminPut(`/admin/branches/${encodeURIComponent(row.id)}`, changes);
      notify('success', message);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر حفظ التعديل');
    } finally { setBusy(''); }
  };

  const rename = (row: Branch) => {
    const label = window.prompt('اسم الفرع كما يظهر للعملاء:', row.label);
    if (label === null || !label.trim() || label.trim() === row.label) return;
    void patch(row, { label: label.trim() }, 'تم تغيير اسم الفرع');
  };

  const field = 'rounded-xl border border-gray-200 px-3 py-2 text-sm';

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-sky-700 to-cyan-600 p-5 text-white">
        <h2 className="flex items-center gap-2 text-xl font-black"><Building2 size={22} /> الفروع</h2>
        <p className="mt-1 text-sm text-sky-100">
          الفروع هنا هي اللي بتظهر في الحجز والدفع وتسجيل اهتمام العميل بالكورس. الفرع الداخلي مش بيظهر للعملاء.
        </p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-bold text-gray-700">إضافة فرع</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1 block text-xs font-bold text-gray-600">اسم الفرع *</label>
            <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
              placeholder="مثال: فرع المعادي" className={`${field} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-600">النوع</label>
            <select value={newType} onChange={e => setNewType(e.target.value as Branch['branch_type'])} className={field}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-600">العملة</label>
            <select value={newCurrency} onChange={e => setNewCurrency(e.target.value)} className={field}>
              {['EGP', 'SAR', 'USD'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button disabled={busy === 'new'} onClick={create}
            className="flex items-center gap-1.5 rounded-xl bg-sky-700 px-4 py-2 text-sm font-bold text-white hover:bg-sky-800 disabled:opacity-50">
            <Plus size={15} /> {busy === 'new' ? 'جارٍ الإضافة...' : 'إضافة'}
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-400">المفتاح البرمجي بيتولّد من الاسم تلقائياً، والمنطقة الزمنية بتاخد القاهرة افتراضياً.</p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-sky-600" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3 text-right font-bold">الاسم</th>
                <th className="px-4 py-3 text-right font-bold">المفتاح</th>
                <th className="px-4 py-3 text-right font-bold">النوع</th>
                <th className="px-4 py-3 text-right font-bold">العملة</th>
                <th className="px-4 py-3 text-right font-bold">الظهور</th>
                <th className="px-4 py-3 text-right font-bold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const active = Boolean(Number(row.is_active));
                const internal = Boolean(Number(row.internal_only));
                return (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-bold text-gray-800">{row.label}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-400" dir="ltr">{row.branch_key}</td>
                    <td className="px-4 py-3 text-gray-600">{TYPE_LABEL[row.branch_type] || row.branch_type}</td>
                    <td className="px-4 py-3 text-gray-600" dir="ltr">{row.currency || 'EGP'}</td>
                    <td className="px-4 py-3">
                      {!active ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold text-gray-500">موقوف</span>
                      ) : internal ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">داخلي — لا يظهر للعملاء</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">ظاهر للعملاء</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button disabled={busy === row.id} onClick={() => rename(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                          <Save size={11} /> تعديل الاسم
                        </button>
                        <button disabled={busy === row.id}
                          onClick={() => patch(row, { is_active: active ? 0 : 1 }, active ? 'تم إيقاف الفرع' : 'تم تفعيل الفرع')}
                          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold disabled:opacity-50 ${
                            active ? 'border border-gray-200 text-gray-600 hover:bg-gray-100' : 'bg-emerald-600 text-white hover:bg-emerald-700'}`}>
                          {active ? <><EyeOff size={11} /> إيقاف</> : <><Eye size={11} /> تفعيل</>}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
