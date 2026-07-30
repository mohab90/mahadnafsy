import { useCallback, useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Loader2, RefreshCw, UserCheck } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
type Applicant = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  specialty?: string;
  applicant_type?: string;
  source: string;
  stage: Stage;
  job_title: string;
  job_branch?: string;
  hired_staff_id?: string;
  updated_at?: string;
};

const LABEL: Record<Stage, string> = {
  applied: 'تم الاستلام', screening: 'فرز أولي', interview: 'مقابلة',
  offer: 'عرض وظيفي', hired: 'تم التعيين', rejected: 'مرفوض',
};
const NEXT: Record<Stage, Stage[]> = {
  applied: ['screening', 'rejected'],
  screening: ['interview', 'rejected'],
  interview: ['offer', 'rejected'],
  offer: ['rejected'],
  rejected: ['screening'],
  hired: [],
};

export default function RecruitmentPipelinePanel({ notify }: { notify: Notify }) {
  const [rows, setRows] = useState<Applicant[]>([]);
  const [filter, setFilter] = useState<Stage | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/hr/applicants?stage=${filter}`, {
        credentials: 'include', headers: adminAuthHeaders(),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'تعذر تحميل المتقدمين');
      setRows(await response.json());
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل المتقدمين');
    } finally {
      setLoading(false);
    }
  }, [filter, notify]);

  useEffect(() => { void load(); }, [load]);
  const counts = useMemo(() => rows.reduce<Record<string, number>>((result, row) => {
    result[row.stage] = (result[row.stage] || 0) + 1;
    return result;
  }, {}), [rows]);

  const changeStage = async (applicant: Applicant, stage: Stage) => {
    setBusy(applicant.id);
    try {
      const response = await fetch(`/api/admin/hr/applicants/${applicant.id}`, {
        method: 'PUT', credentials: 'include', headers: adminAuthHeaders(true),
        body: JSON.stringify({ stage }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'فشل تحديث المرحلة');
      notify('success', `انتقل ${applicant.name} إلى "${LABEL[stage]}"`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل تحديث المرحلة');
    } finally {
      setBusy(null);
    }
  };

  const hire = async (applicant: Applicant) => {
    if (!window.confirm(`إنشاء سجل موظف غير نشط لـ${applicant.name}؟ التفعيل خطوة منفصلة.`)) return;
    setBusy(applicant.id);
    try {
      const response = await fetch(`/api/admin/hr/applicants/${applicant.id}/hire`, {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true),
        body: JSON.stringify({ branch_id: applicant.job_branch || undefined }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'فشل التعيين');
      notify('success', `تم إنشاء سجل ${applicant.name} كموظف غير نشط في انتظار التفعيل`);
      await load();
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل التعيين');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700"><BriefcaseBusiness size={16} /> مسار المتقدمين</h3>
          <p className="mt-0.5 text-xs text-gray-400">طلب الموقع ← فرز ← مقابلة ← عرض ← سجل موظف غير نشط.</p>
        </div>
        <button onClick={() => void load()} className="rounded-lg border border-gray-200 p-2 text-gray-500" title="تحديث"><RefreshCw size={14} /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setFilter('all')} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${filter === 'all' ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-600'}`}>الكل</button>
        {(Object.keys(LABEL) as Stage[]).map(stage => (
          <button key={stage} onClick={() => setFilter(stage)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${filter === stage ? 'bg-slate-700 text-white' : 'bg-gray-100 text-gray-600'}`}>
            {LABEL[stage]}{filter === 'all' && counts[stage] ? ` (${counts[stage]})` : ''}
          </button>
        ))}
      </div>
      {loading ? <Loader2 className="mx-auto my-8 animate-spin text-gray-400" /> : rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400">لا يوجد متقدمون في هذه المرحلة.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50 text-right text-xs text-gray-500">
              <th className="p-3">المتقدم</th><th className="p-3">الوظيفة</th><th className="p-3">المصدر</th><th className="p-3">المرحلة</th><th className="p-3">الإجراء</th>
            </tr></thead>
            <tbody className="divide-y">
              {rows.map(applicant => (
                <tr key={applicant.id}>
                  <td className="p-3"><strong>{applicant.name}</strong><div className="text-xs text-gray-400">{applicant.email || applicant.phone || '—'}</div></td>
                  <td className="p-3">{applicant.job_title}<div className="text-xs text-gray-400">{applicant.specialty || applicant.applicant_type || '—'}</div></td>
                  <td className="p-3 text-xs">{applicant.source === 'website' ? 'الموقع' : 'يدوي'}</td>
                  <td className="p-3"><span className="rounded-lg bg-indigo-50 px-2 py-1 text-xs font-bold text-indigo-700">{LABEL[applicant.stage]}</span></td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {NEXT[applicant.stage].map(stage => <button key={stage} disabled={busy === applicant.id} onClick={() => void changeStage(applicant, stage)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 disabled:opacity-40">{LABEL[stage]}</button>)}
                      {applicant.stage === 'offer' && <button disabled={busy === applicant.id} onClick={() => void hire(applicant)} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-40"><UserCheck size={12} /> تعيين</button>}
                      {applicant.stage === 'hired' && <span className="text-xs font-bold text-emerald-700">مرتبط بالموظف</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
