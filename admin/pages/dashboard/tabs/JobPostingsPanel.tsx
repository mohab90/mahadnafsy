import { useState, useEffect, useCallback, useMemo } from 'react';
import { Briefcase, Plus, Trash2, Pencil, X, Loader2, ExternalLink, Users } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { JobApplicantsPanel } from './JobApplicantsPanel';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
interface Job { id: string; title: string; branch: string | null; employment_type: string; description: string | null; requirements: string | null; salary_min: number | null; salary_max: number | null; status: string; applicant_count?: number; created_at?: string; }
const EMP_TYPES: [string, string][] = [['full_time', 'دوام كامل'], ['part_time', 'دوام جزئي'], ['contract', 'عقد'], ['intern', 'تدريب']];
const blank = (): Partial<Job> => ({ title: '', branch: null, employment_type: 'full_time', description: '', requirements: '', salary_min: null, salary_max: null, status: 'open' });

// Static fallback only — kept in case the branches table is ever empty
// (should not happen once seeded, but a job posting UI showing zero branch
// options with no explanation would be a confusing regression).
const FALLBACK_BRANCH_LABELS: Record<string, string> = {
  DAQQI: 'فرع الدقي', TAGAMOA: 'فرع التجمع', ONLINE_EGYPT: 'أونلاين محلي (مصر)',
  ONLINE_SAUDI: 'أونلاين سعودي', ONLINE_ABROAD: 'أونلاين دولي', OTHER: 'أخرى',
};

export default function JobPostingsPanel({ notify }: { notify: Notify }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Job> | null>(null);
  const [busy, setBusy] = useState(false);
  // The real `branches` table — includes internal-only ones (e.g. an
  // admin-only office) on purpose, since this dropdown IS the HR/staff
  // context they're meant for. Not content['institute.branches']: that's a
  // separate, customer-facing list this tenant has never populated.
  const [realBranches, setRealBranches] = useState<{ id: string; label: string; internal_only?: boolean }[]>([]);
  // Which job we are reviewing applicants for. The count on the card used
  // to be plain text with no way in, so every decision about a candidate
  // happened outside the system.
  const [reviewing, setReviewing] = useState<Job | null>(null);
  useEffect(() => {
    fetch('/api/admin/hr/branches', { credentials: 'include', headers: adminAuthHeaders() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setRealBranches(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);
  const branchOptions = useMemo(
    () => realBranches.length > 0
      ? realBranches.map(b => [b.id, b.internal_only ? `${b.label} (داخلي)` : b.label] as [string, string])
      : Object.entries(FALLBACK_BRANCH_LABELS),
    [realBranches],
  );
  const branchLabel = useMemo(() => Object.fromEntries(branchOptions), [branchOptions]);

  // Open postings are the live ones — they are what the public careers page
  // shows — and among those the ones with people waiting come first. Closed
  // postings stay reachable but stop competing for attention.
  const openJobs = useMemo(
    () => jobs.filter(j => j.status === 'open')
      .sort((a, b) => Number(b.applicant_count || 0) - Number(a.applicant_count || 0)),
    [jobs]);
  const closedJobs = useMemo(() => jobs.filter(j => j.status !== 'open'), [jobs]);
  const waiting = useMemo(
    () => openJobs.reduce((sum, j) => sum + Number(j.applicant_count || 0), 0),
    [openJobs]);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/hr/jobs', { credentials: 'include', headers: adminAuthHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || 'تعذر تحميل الوظائف');
        return r.json();
      })
      .then(d => setJobs(Array.isArray(d) ? d.filter((j: Job) => !j.id.startsWith('talent-')) : []))
      .catch(error => notify('error', error.message)).finally(() => setLoading(false));
  }, [notify]);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.title?.trim()) { notify('error', 'أدخل المسمى الوظيفي'); return; }
    setBusy(true);
    try {
      const isNew = !editing.id;
      const r = await fetch(isNew ? '/api/admin/hr/jobs' : `/api/admin/hr/jobs/${editing.id}`, {
        method: isNew ? 'POST' : 'PUT', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify(editing),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || 'فشل الحفظ');
      notify('success', isNew ? 'تم نشر الوظيفة' : 'تم التحديث'); setEditing(null); load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل الحفظ'); } finally { setBusy(false); }
  };
  const del = async (id: string) => {
    if (!window.confirm('حذف هذه الوظيفة؟')) return;
    try {
      const r = await fetch(`/api/admin/hr/jobs/${id}`, { method: 'DELETE', credentials: 'include', headers: adminAuthHeaders() });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        // A job with applicants is refused on purpose. Offer the thing the
        // refusal actually recommends instead of reporting a dead end.
        if (body?.code === 'JOB_HAS_APPLICANTS') {
          if (window.confirm(`${body.error}

تقفلها دلوقتي؟`)) {
            const closed = await fetch(`/api/admin/hr/jobs/${id}`, {
              method: 'PUT', credentials: 'include',
              headers: { ...adminAuthHeaders(), 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'closed' }),
            });
            if (!closed.ok) throw new Error('تعذر إقفال الوظيفة');
            notify('success', 'تم إقفال الوظيفة — مش هتظهر على الموقع، وسجل المتقدمين محفوظ');
            load();
            return;
          }
          return;
        }
        throw new Error(body?.error || 'فشل الحذف');
      }
      notify('success', 'تم الحذف'); load();
    } catch (error) { notify('error', error instanceof Error ? error.message : 'فشل الحذف'); }
  };

  const inp = 'w-full text-sm border border-gray-200 rounded-lg px-3 py-2';

  const renderJob = (j: Job) => {
    const count = Number(j.applicant_count || 0);
    const isOpen = j.status === 'open';
    return (
      <div key={j.id} className={`rounded-xl border p-3 ${isOpen ? 'border-gray-200 bg-white' : 'border-gray-100 bg-white/60'}`}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-800 text-sm">{j.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${isOpen ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {isOpen ? 'منشورة على الموقع' : 'مقفولة'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{EMP_TYPES.find(e => e[0] === j.employment_type)?.[1] || j.employment_type}</span>
              {j.branch && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">{branchLabel[j.branch] || j.branch}</span>}
              {(j.salary_min || j.salary_max) && <span className="text-[10px] text-gray-400">{j.salary_min || '?'}–{j.salary_max || '?'} ج.م</span>}
            </div>
            {j.description && <p className="text-xs text-gray-500 truncate mt-0.5">{j.description}</p>}
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button onClick={() => setReviewing(j)}
                className={`flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg font-bold transition ${
                  count > 0 ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                <Users size={11} /> {count > 0 ? `${count} متقدم — راجعهم` : 'مفيش متقدمين لسه'}
              </button>
              {isOpen && (
                <a href="/join-us" target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg font-bold bg-gray-100 text-gray-600 hover:bg-gray-200 transition">
                  <ExternalLink size={11} /> شوفها على الموقع
                </a>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => setEditing(j)} title="تعديل" className="text-gray-400 hover:text-indigo-600 p-1"><Pencil size={14} /></button>
            <button onClick={() => del(j.id)} title="حذف" className="text-gray-300 hover:text-red-500 p-1"><Trash2 size={14} /></button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2"><Briefcase size={16} /> الوظائف المتاحة (تظهر في صفحة التوظيف بالموقع)</h3>
        <button onClick={() => setEditing(blank())} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-white font-bold flex items-center gap-1"><Plus size={13} /> وظيفة جديدة</button>
      </div>
      {loading ? <div className="text-center py-6 text-gray-400"><Loader2 size={18} className="animate-spin mx-auto" /></div>
        : jobs.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl">
            لا توجد وظائف منشورة — اضغط "وظيفة جديدة" وهتظهر على صفحة التوظيف بالموقع فورًا.
          </div>
        ) : (
          <div className="space-y-3">
            {waiting > 0 && (
              <div className="flex items-center gap-1.5 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">
                <Users size={13} /> {waiting} متقدم مستني مراجعة على {openJobs.length} وظيفة مفتوحة
              </div>
            )}

            <div className="space-y-2">
              {openJobs.map(j => renderJob(j))}
              {openJobs.length === 0 && (
                <p className="text-xs text-amber-600">مفيش وظيفة مفتوحة دلوقتي — صفحة التوظيف بالموقع هتبان فاضية.</p>
              )}
            </div>

            {closedJobs.length > 0 && (
              <details className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
                <summary className="cursor-pointer text-xs font-bold text-gray-500">
                  وظائف مقفولة ({closedJobs.length}) — مش ظاهرة على الموقع
                </summary>
                <div className="mt-2 space-y-2">{closedJobs.map(j => renderJob(j))}</div>
              </details>
            )}
          </div>
        )}

      {reviewing && (
        <JobApplicantsPanel
          jobId={reviewing.id}
          jobTitle={reviewing.title || ''}
          onClose={() => setReviewing(null)}
          onChanged={load}
          notify={notify}
        />
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEditing(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-5 w-full max-w-lg max-h-[85vh] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between"><h4 className="font-bold text-gray-800">{editing.id ? 'تعديل وظيفة' : 'وظيفة جديدة'}</h4><button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button></div>
            <input className={inp} placeholder="المسمى الوظيفي *" value={editing.title || ''} onChange={e => setEditing({ ...editing, title: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inp} value={editing.employment_type || 'full_time'} onChange={e => setEditing({ ...editing, employment_type: e.target.value })}>
                {EMP_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <select className={inp} value={editing.status || 'open'} onChange={e => setEditing({ ...editing, status: e.target.value })}>
                <option value="open">مفتوحة</option><option value="closed">مغلقة</option>
              </select>
            </div>
            <select className={inp} value={editing.branch || ''} onChange={e => setEditing({ ...editing, branch: e.target.value || null })}>
              <option value="">كل الفروع (غير محدد بفرع)</option>
              {branchOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <textarea className={inp} rows={3} placeholder="وصف الوظيفة" value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} />
            <textarea className={inp} rows={2} placeholder="المتطلبات" value={editing.requirements || ''} onChange={e => setEditing({ ...editing, requirements: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <input className={inp} type="number" placeholder="أقل راتب" value={editing.salary_min ?? ''} onChange={e => setEditing({ ...editing, salary_min: e.target.value ? Number(e.target.value) : null })} />
              <input className={inp} type="number" placeholder="أعلى راتب" value={editing.salary_max ?? ''} onChange={e => setEditing({ ...editing, salary_max: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <button disabled={busy} onClick={save} className="w-full bg-slate-700 text-white rounded-lg py-2.5 text-sm font-bold disabled:opacity-50">{busy ? 'جارٍ الحفظ...' : 'حفظ'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
