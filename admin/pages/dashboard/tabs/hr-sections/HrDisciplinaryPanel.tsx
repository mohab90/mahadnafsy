import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gavel, Plus, Trash2, Check, X, ShieldAlert } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import type { StaffMember } from '../../../../types';

// The disciplinary API (list / issue / amend / resolve / withdraw) has been
// live the whole time with nothing in the admin app calling it — while the
// staff-facing settings panel already lets an employee acknowledge a record.
// So the loop was half-built: employees could acknowledge notices that HR had
// no way to issue. This is the missing half.

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

type Record_ = {
  id: string;
  staff_id: string;
  staff_name?: string;
  role?: string;
  type: string;
  severity: string;
  title: string;
  description?: string;
  incident_date?: string;
  action_taken?: string;
  status: string;
  acknowledged_at?: string | null;
  issued_by_name?: string;
  created_at?: string;
};

// Mirrors DISCIPLINARY_TYPES / DISCIPLINARY_SEVERITIES in api/routes/hr/records.js.
// Anything not in these sets is rejected with 400, so they must stay in step.
const TYPES: Record<string, string> = {
  verbal_warning: 'إنذار شفهي',
  written_warning: 'إنذار كتابي',
  warning: 'تنبيه',
  suspension: 'إيقاف عن العمل',
  termination: 'إنهاء خدمة',
  other: 'أخرى',
};
const SEVERITIES: Record<string, { label: string; cls: string }> = {
  low: { label: 'بسيطة', cls: 'bg-gray-100 text-gray-600' },
  medium: { label: 'متوسطة', cls: 'bg-amber-100 text-amber-700' },
  high: { label: 'جسيمة', cls: 'bg-red-100 text-red-700' },
};
const STATUS_LABEL: Record<string, string> = {
  open: 'مفتوحة',
  appealed: 'قيد التظلّم',
  resolved: 'منتهية',
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyDraft = () => ({
  staff_id: '', type: 'written_warning', severity: 'medium',
  title: '', description: '', incident_date: today(), action_taken: '',
});

export default function HrDisciplinaryPanel({ staff, notify }: { staff: StaffMember[]; notify: Notify }) {
  const [records, setRecords] = useState<Record_[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [staffFilter, setStaffFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await mysqlAdmin.adminGet<Record_[]>('/admin/hr/disciplinary');
      setRecords(Array.isArray(rows) ? rows : []);
    } catch {
      notify('error', 'تعذر تحميل السجلات التأديبية');
    } finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(
    () => (staffFilter ? records.filter(r => r.staff_id === staffFilter) : records),
    [records, staffFilter]
  );
  const openCount = records.filter(r => r.status === 'open').length;

  const issue = async () => {
    if (!draft.staff_id) { notify('error', 'اختر الموظف أولاً'); return; }
    if (!draft.title.trim()) { notify('error', 'اكتب عنوان المخالفة'); return; }
    setBusy('new');
    try {
      await mysqlAdmin.adminPost('/admin/hr/disciplinary', draft);
      setDraft(emptyDraft());
      setShowForm(false);
      await load();
      notify('success', 'تم تسجيل الإجراء التأديبي وإخطار الموظف');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تسجيل الإجراء');
    } finally { setBusy(''); }
  };

  // The server refuses to resolve anything that is not currently under appeal,
  // and refuses to edit a record once acknowledged — both are deliberate, so
  // the buttons only appear where the transition is actually allowed.
  const resolve = async (record: Record_) => {
    setBusy(record.id);
    try {
      await mysqlAdmin.adminPut(`/admin/hr/disciplinary/${record.id}`, { status: 'resolved' });
      await load();
      notify('success', 'تم إنهاء التظلّم');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إنهاء التظلّم');
    } finally { setBusy(''); }
  };

  const withdraw = async (record: Record_) => {
    if (!window.confirm(`سحب الإجراء التأديبي "${record.title}" الخاص بـ${record.staff_name || ''}؟`)) return;
    setBusy(record.id);
    try {
      await mysqlAdmin.adminDelete(`/admin/hr/disciplinary/${record.id}`);
      await load();
      notify('success', 'تم سحب الإجراء');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر سحب الإجراء');
    } finally { setBusy(''); }
  };

  const field = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm';

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm" dir="rtl">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h3 className="font-bold text-gray-800 flex items-center gap-2">
          <Gavel size={17} className="text-rose-600" />
          الجزاءات والإجراءات التأديبية
          {openCount > 0 && <span className="text-[10px] bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full">{openCount} مفتوحة</span>}
        </h3>
        <span className="flex-1" />
        <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs">
          <option value="">كل الموظفين</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700">
          <Plus size={13} /> تسجيل إجراء
        </button>
      </div>

      {showForm && (
        <div className="mb-4 rounded-xl border border-rose-100 bg-rose-50/50 p-3 space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <select value={draft.staff_id} onChange={e => setDraft(d => ({ ...d, staff_id: e.target.value }))} className={field}>
              <option value="">— اختر الموظف —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={draft.type} onChange={e => setDraft(d => ({ ...d, type: e.target.value }))} className={field}>
              {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={draft.severity} onChange={e => setDraft(d => ({ ...d, severity: e.target.value }))} className={field}>
              {Object.entries(SEVERITIES).map(([k, v]) => <option key={k} value={k}>درجة: {v.label}</option>)}
            </select>
            <input type="date" value={draft.incident_date} onChange={e => setDraft(d => ({ ...d, incident_date: e.target.value }))} className={field} />
          </div>
          <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
            placeholder="عنوان المخالفة (مطلوب)" className={field} />
          <textarea value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            rows={2} placeholder="تفاصيل الواقعة" className={`${field} resize-none`} />
          <textarea value={draft.action_taken} onChange={e => setDraft(d => ({ ...d, action_taken: e.target.value }))}
            rows={2} placeholder="الإجراء المتخذ (خصم، إيقاف، تعهد...)" className={`${field} resize-none`} />
          <div className="flex gap-2">
            <button disabled={busy === 'new'} onClick={issue}
              className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50">
              {busy === 'new' ? 'جارٍ الحفظ...' : 'تسجيل الإجراء'}
            </button>
            <button onClick={() => { setShowForm(false); setDraft(emptyDraft()); }}
              className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-10 text-center text-gray-400">
          <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-rose-600" />
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-xs text-emerald-700">
          لا توجد إجراءات تأديبية مسجّلة{staffFilter ? ' لهذا الموظف' : ''}.
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(record => {
            const sev = SEVERITIES[record.severity] || SEVERITIES.medium;
            return (
              <div key={record.id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldAlert size={15} className="text-rose-500" />
                  <span className="font-bold text-sm text-gray-800">{record.staff_name || '—'}</span>
                  <span className="text-xs text-gray-500">{TYPES[record.type] || record.type}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${sev.cls}`}>{sev.label}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{STATUS_LABEL[record.status] || record.status}</span>
                  {record.acknowledged_at
                    ? <span className="text-[10px] text-emerald-600 font-bold">✔ اطّلع الموظف</span>
                    : <span className="text-[10px] text-amber-600 font-bold">بانتظار اطّلاع الموظف</span>}
                  <span className="flex-1" />
                  {record.status === 'appealed' && (
                    <button disabled={busy === record.id} onClick={() => resolve(record)}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50">
                      <Check size={12} /> إنهاء التظلّم
                    </button>
                  )}
                  <button disabled={busy === record.id} onClick={() => withdraw(record)}
                    className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-50">
                    <Trash2 size={12} /> سحب
                  </button>
                </div>
                <p className="mt-1.5 text-sm text-gray-700 font-semibold">{record.title}</p>
                {record.description && <p className="mt-0.5 text-xs text-gray-500">{record.description}</p>}
                {record.action_taken && <p className="mt-0.5 text-xs text-rose-700">الإجراء: {record.action_taken}</p>}
                <p className="mt-1 text-[10px] text-gray-400">
                  {record.incident_date ? `تاريخ الواقعة ${String(record.incident_date).slice(0, 10)}` : ''}
                  {record.issued_by_name ? ` · بواسطة ${record.issued_by_name}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
