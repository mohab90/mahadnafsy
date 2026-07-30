import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Plus } from 'lucide-react';
import type { StaffMember } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Appraisal = {
  id: string;
  staff_name: string;
  period_month: number;
  period_year: number;
  overall_score: number;
  grade: string;
  status: 'draft' | 'submitted' | 'approved';
  reviewer_id?: string;
};

export default function HrAppraisalsPanel({ staff, notify }: { staff: StaffMember[]; notify: Notify }) {
  const [rows, setRows] = useState<Appraisal[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({
    staff_id: '',
    period: new Date().toISOString().slice(0, 7),
    kpi: 'الأداء العام',
    score: '80',
    evidence: '',
    notes: '',
  });
  const load = useCallback(async () => {
    try { setRows(await mysqlAdmin.adminGet<Appraisal[]>('/admin/hr/appraisals')); }
    catch { notify('error', 'تعذر تحميل تقييمات الأداء'); }
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    const [year, month] = form.period.split('-').map(Number);
    setBusy('create');
    try {
      await mysqlAdmin.adminPost('/admin/hr/appraisals', {
        staff_id: form.staff_id,
        period_month: month,
        period_year: year,
        kpi_scores: [{ kpi: form.kpi, target: 100, achieved: Number(form.score), score: Number(form.score) }],
        evidence_json: [{ label: 'دليل الأداء', url: form.evidence }],
        notes: form.notes,
      });
      await load();
      setOpen(false);
      notify('success', 'تم إنشاء مسودة التقييم');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إنشاء التقييم');
    } finally { setBusy(''); }
  };
  const transition = async (row: Appraisal) => {
    const next = row.status === 'draft' ? 'submitted' : 'approved';
    setBusy(row.id);
    try {
      await mysqlAdmin.adminPut(`/admin/hr/appraisals/${row.id}/status`, { status: next });
      await load();
      notify('success', next === 'submitted' ? 'تم إرسال التقييم للاعتماد' : 'تم اعتماد التقييم');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحديث التقييم');
    } finally { setBusy(''); }
  };

  return (
    <div className="bg-white border border-indigo-100 rounded-2xl p-4 shadow-sm mb-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><ClipboardCheck size={17} className="text-indigo-600" /> تقييمات موثقة</h3>
        <button onClick={() => setOpen(value => !value)} className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1"><Plus size={12} /> تقييم جديد</button>
      </div>
      {open && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 border-t pt-3">
          <select value={form.staff_id} onChange={event => setForm(value => ({ ...value, staff_id: event.target.value }))} className="border rounded-lg px-2 py-1.5 text-xs">
            <option value="">اختر الموظف</option>
            {staff.filter(member => member.status === 'active').map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
          <input type="month" value={form.period} onChange={event => setForm(value => ({ ...value, period: event.target.value }))} className="border rounded-lg px-2 py-1.5 text-xs" />
          <input value={form.kpi} onChange={event => setForm(value => ({ ...value, kpi: event.target.value }))} placeholder="مؤشر الأداء" className="border rounded-lg px-2 py-1.5 text-xs" />
          <input type="number" min={0} max={100} value={form.score} onChange={event => setForm(value => ({ ...value, score: event.target.value }))} placeholder="الدرجة" className="border rounded-lg px-2 py-1.5 text-xs" />
          <input value={form.evidence} onChange={event => setForm(value => ({ ...value, evidence: event.target.value }))} placeholder="رابط/مرجع الدليل" className="border rounded-lg px-2 py-1.5 text-xs" />
          <button onClick={create} disabled={busy === 'create' || !form.staff_id || !form.evidence} className="bg-indigo-600 text-white rounded-lg text-xs font-bold disabled:opacity-50">حفظ المسودة</button>
        </div>
      )}
      <div className="mt-3 space-y-1">
        {rows.slice(0, 10).map(row => (
          <div key={row.id} className="flex items-center gap-2 border-t border-gray-50 py-2 text-xs">
            <span className="font-bold">{row.staff_name}</span>
            <span>{row.period_month}/{row.period_year}</span>
            <span className="text-indigo-700">{row.overall_score}% ({row.grade})</span>
            <span className="text-gray-400">{row.status}</span>
            <span className="flex-1" />
            {row.status !== 'approved' && (
              <button disabled={busy === row.id} onClick={() => transition(row)} className="bg-slate-700 text-white px-2 py-1 rounded-lg disabled:opacity-50">
                {row.status === 'draft' ? 'إرسال' : 'اعتماد'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
