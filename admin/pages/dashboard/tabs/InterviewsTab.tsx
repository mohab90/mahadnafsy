import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, CalendarCheck, CalendarClock, GraduationCap, Briefcase,
  Plus, RefreshCw, Star, UserCheck, UserPlus, X, XCircle,
} from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import {
  PHONE_RESULTS, branchLabel, experienceRank, yearsLabel,
} from './hr-sections/applicantLabels';
import InterviewFilters, {
  InterviewFilterState, emptyInterviewFilters, interviewFiltersActive,
} from './interviews-sections/InterviewFilters';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
interface JobApplicant {
  id: string;
  job_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage: Stage;
  stage_notes: string | null;
  interview_rating: number | null;
  source: string;
  specialty: string | null;
  applicant_type: string | null;
  job_title: string;
  job_branch: string | null;
  hired_staff_id: string | null;
  created_at: string;
  updated_at: string;
  /** From the application form — see migration 204. */
  applicant_branch: string | null;
  education: string | null;
  experience_years: string | null;
  experience_places: string | null;
  phone_interview_result: 'passed' | 'failed' | 'no_answer' | null;
  interview_at: string | null;
}

const STARS = [1, 2, 3, 4, 5] as const;

interface JobOption { id: string; title: string; status: string; }

const emptyForm = () => ({ jobId: '', name: '', email: '', phone: '', specialty: '', notes: '' });

const fmtDateTime = (value: string | null) => {
  if (!value) return null;
  const d = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' });
};

/** Sort key: soonest scheduled interview first, undated candidates after. */
const scheduleKey = (row: JobApplicant): number => {
  if (!row.interview_at) return Number.MAX_SAFE_INTEGER;
  const t = new Date(row.interview_at.replace(' ', 'T')).getTime();
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
};

// Standalone entry point into the interview stage — before this, the only
// way in was طلبات الانضمام's "نقل للمقابلات", which requires a candidate to
// already exist as a website submission. Staff who source a candidate
// themselves (referral, LinkedIn, a walk-in) had no way to add them here
// directly. Reuses POST .../applicants?stage=interview (added alongside this)
// so it goes through the exact same applied→screening→interview hops as
// every other interview candidate, just in one step.
const AddInterviewModal: React.FC<{ notify: NotifyFn; onClose: () => void; onAdded: () => void }> = ({ notify, onClose, onAdded }) => {
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mysqlAdmin.listHrJobs()
      .then(all => setJobs((all as unknown as JobOption[]).filter(j => j.status === 'open' || j.status === 'draft')))
      .catch(() => notify('error', 'تعذر تحميل قائمة الوظائف'))
      .finally(() => setLoadingJobs(false));
  }, [notify]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.jobId || !form.name.trim()) { notify('error', 'اختر الوظيفة واكتب اسم المرشح'); return; }
    setSaving(true);
    try {
      await mysqlAdmin.createHrApplicant(form.jobId, {
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        notes: [form.specialty.trim() ? `التخصص: ${form.specialty.trim()}` : '', form.notes.trim()].filter(Boolean).join('\n') || undefined,
        stage: 'interview',
      });
      notify('success', `تمت إضافة ${form.name.trim()} مباشرة في مرحلة المقابلة`);
      onAdded();
      onClose();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّرت إضافة المرشح');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl space-y-3" dir="rtl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-bold text-gray-900"><UserPlus size={18} className="text-violet-600" /> إضافة انترفيو مباشر</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X size={16} /></button>
        </div>
        <p className="text-xs text-gray-500">لإضافة مرشح وصل لك مباشرة (توصية، LinkedIn، ...) — بدون المرور بطلبات الانضمام. يدخل الآن في مرحلة المقابلة مباشرة.</p>

        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">الوظيفة *</label>
          <select required value={form.jobId} onChange={e => setForm(f => ({ ...f, jobId: e.target.value }))}
            disabled={loadingJobs} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white disabled:opacity-50">
            <option value="">{loadingJobs ? 'جاري التحميل...' : 'اختر وظيفة'}</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
          {!loadingJobs && jobs.length === 0 && <p className="mt-1 text-xs text-amber-600">لا توجد وظائف مفتوحة حاليًا — أضف وظيفة من تبويب التوظيف أولًا.</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">اسم المرشح *</label>
          <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-600">الهاتف</label>
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} dir="ltr"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-600">البريد الإلكتروني</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} dir="ltr"
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">التخصص</label>
          <input value={form.specialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">ملاحظات</label>
          <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm resize-none" />
        </div>

        <button type="submit" disabled={saving || loadingJobs}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
          <Plus size={15} /> {saving ? 'جارٍ الإضافة...' : 'إضافة للمقابلة'}
        </button>
      </form>
    </div>
  );
};

// "الانترفيوهات" — a dedicated, nameable stop between طلبات الانضمام and
// الموظفون. The pipeline itself (applied→screening→interview→offer→hired)
// already existed (see hr-sections/RecruitmentPipelinePanel.tsx and
// api/routes/hr/{recruiting,talent}.js) — this page is a focused view on
// candidates who have actually reached an interview, with the one thing
// that pipeline view didn't have: a structured 1-5 rating recorded at the
// interview stage, not just free-text notes.
const InterviewsTab: React.FC<Props> = ({ notify }) => {
  const [rows, setRows] = useState<JobApplicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [filters, setFilters] = useState<InterviewFilterState>(emptyInterviewFilters);

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.listHrApplicants()
      .then(all => setRows((all as unknown as JobApplicant[]).filter(a => a.stage === 'interview' || a.stage === 'offer')))
      .catch(err => notify('error', err instanceof Error ? err.message : 'تعذر تحميل الانترفيوهات'))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    all: rows.length,
    interview: rows.filter(r => r.stage === 'interview').length,
    offer: rows.filter(r => r.stage === 'offer').length,
  }), [rows]);

  // The pickers only offer values that exist in the list, with their tallies.
  // A filter that can be set to something matching nobody is a filter that
  // wastes a click and then makes you wonder whether the screen is broken.
  const jobOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; count: number }>();
    rows.forEach(r => {
      const entry = map.get(r.job_id);
      if (entry) entry.count += 1;
      else map.set(r.job_id, { value: r.job_id, label: r.job_title || 'وظيفة محذوفة', count: 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [rows]);

  const branchOptions = useMemo(() => {
    const map = new Map<string, { value: string; label: string; count: number }>();
    rows.forEach(r => {
      const key = r.applicant_branch || r.job_branch;
      if (!key) return;
      const entry = map.get(key);
      if (entry) entry.count += 1;
      else map.set(key, { value: key, label: branchLabel(key), count: 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [rows]);

  const visible = useMemo(() => {
    const needle = filters.query.trim().toLowerCase();
    const min = filters.minExperience;
    return rows
      .filter(r => {
        if (filters.view !== 'all' && r.stage !== filters.view) return false;
        if (filters.jobId && r.job_id !== filters.jobId) return false;
        if (filters.branch && (r.applicant_branch || r.job_branch) !== filters.branch) return false;
        if (min === 'only_none') {
          if (r.experience_years !== 'none') return false;
        } else if (min) {
          const rank = experienceRank(r.experience_years);
          if (rank < 0 || rank < experienceRank(min)) return false;
        }
        if (needle) {
          const hay = `${r.name} ${r.phone || ''} ${r.email || ''} ${r.specialty || ''}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => scheduleKey(a) - scheduleKey(b));
  }, [rows, filters]);

  const setRating = async (row: JobApplicant, rating: number) => {
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { interview_rating: row.interview_rating === rating ? null : rating });
      notify('success', 'تم تسجيل التقييم');
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ التقييم');
    } finally {
      setBusyId(null);
    }
  };

  const saveNote = async (row: JobApplicant) => {
    const note = noteDraft[row.id];
    if (note === undefined) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { stage_notes: note });
      notify('success', 'تم حفظ ملاحظات المقابلة');
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ الملاحظات');
    } finally {
      setBusyId(null);
    }
  };

  const advance = async (row: JobApplicant, stage: 'offer' | 'rejected') => {
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { stage });
      notify('success', stage === 'offer' ? `${row.name} → عرض وظيفي` : `${row.name} → مرفوض`);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر تحديث المرحلة');
    } finally {
      setBusyId(null);
    }
  };

  const reschedule = async (row: JobApplicant, date: string) => {
    if (!date) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { interview_at: `${date} 10:00:00` });
      notify('success', `اتحدد ميعاد مقابلة ${row.name}`);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ الميعاد');
    } finally {
      setBusyId(null);
    }
  };

  const hire = async (row: JobApplicant) => {
    if (!window.confirm(`إنشاء سجل موظف غير نشط لـ${row.name}؟ التفعيل خطوة منفصلة من دليل الموظفين.`)) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.hireHrApplicant(row.id, { branch_id: row.applicant_branch || row.job_branch || undefined });
      notify('success', `تم إنشاء سجل ${row.name} كموظف — فعّله من دليل الموظفين`);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'فشل التعيين');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarCheck size={22} className="text-violet-600" />
            الانترفيوهات
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            مرشحون وصلوا لمرحلة المقابلة — قيّمهم، سجّل ملاحظاتك، وانقلهم لعرض وظيفي أو تعيين. النقل من طلبات الانضمام بزرار "نقل للمقابلات" هناك.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-violet-600 text-white hover:bg-violet-700 transition"
          >
            <UserPlus size={14} />
            إضافة انترفيو
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>
      </div>

      {showAddModal && <AddInterviewModal notify={notify} onClose={() => setShowAddModal(false)} onAdded={load} />}

      {!loading && rows.length > 0 && (
        <InterviewFilters
          value={filters}
          onChange={setFilters}
          jobs={jobOptions}
          branches={branchOptions}
          counts={counts}
          shown={visible.length}
        />
      )}

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
          جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-gray-400">
          لا يوجد مرشحون في مرحلة المقابلة أو العرض الوظيفي حاليًا.
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-gray-500" dir="rtl">
          مفيش مرشح مطابق للفلاتر دي.
          {interviewFiltersActive(filters) && (
            <button onClick={() => setFilters(emptyInterviewFilters())} className="mr-2 font-bold text-violet-600 hover:underline">
              اعرض الكل
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(row => {
            const scheduled = fmtDateTime(row.interview_at);
            const phone = row.phone_interview_result ? PHONE_RESULTS[row.phone_interview_result] : null;
            const branch = row.applicant_branch || row.job_branch;
            return (
              <article key={row.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${row.stage === 'offer' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>
                        {row.stage === 'offer' ? 'عرض وظيفي' : 'مقابلة'}
                      </span>
                      <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{row.job_title}</span>
                      {row.source === 'website' && <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs text-blue-700">من الموقع</span>}
                      {phone && <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${phone.tone}`}>{phone.label}</span>}
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">{row.name}</h3>
                    <p className="text-sm text-gray-600">{row.specialty || row.applicant_type || '—'}</p>
                    <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-500">
                      {row.email && <span dir="ltr">{row.email}</span>}
                      {row.phone && <span dir="ltr">{row.phone}</span>}
                    </div>

                    {/* What the application actually said. Without it, deciding
                        between two candidates meant opening the job's applicant
                        list in another screen to read their form back. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5" dir="rtl">
                      <span className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                        <Briefcase size={11} /> {yearsLabel(row.experience_years)}
                      </span>
                      {branch && (
                        <span className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                          <Building2 size={11} /> {branchLabel(branch)}
                        </span>
                      )}
                      {row.education && (
                        <span className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                          <GraduationCap size={11} /> {row.education}
                        </span>
                      )}
                      {scheduled && (
                        <span className="flex items-center gap-1 rounded-lg bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                          <CalendarClock size={11} /> {scheduled}
                        </span>
                      )}
                    </div>
                    {row.experience_places && (
                      <p className="mt-1.5 text-[11px] text-gray-500" dir="rtl">
                        اشتغل قبل كده: {row.experience_places}
                      </p>
                    )}

                    {/* Rating */}
                    <div className="mt-3 flex items-center gap-1">
                      <span className="text-xs font-bold text-gray-500 ml-1">التقييم:</span>
                      {STARS.map(n => (
                        <button
                          key={n}
                          disabled={busyId === row.id}
                          onClick={() => setRating(row, n)}
                          title={`${n} من 5`}
                          className="disabled:opacity-40"
                        >
                          <Star size={18} className={(row.interview_rating || 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
                        </button>
                      ))}
                    </div>

                    {/* Notes */}
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        value={noteDraft[row.id] ?? row.stage_notes ?? ''}
                        onChange={e => setNoteDraft(d => ({ ...d, [row.id]: e.target.value }))}
                        placeholder="ملاحظات المقابلة..."
                        className="flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-sm"
                      />
                      <button
                        onClick={() => saveNote(row)}
                        disabled={busyId === row.id || noteDraft[row.id] === undefined}
                        className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-40"
                      >
                        حفظ
                      </button>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-2">
                    {/* Interviews get moved. Without this the only way to change
                        a date was to go back to the job's applicant list, where
                        this candidate no longer appears. */}
                    <label className="flex items-center gap-1 rounded-xl border border-gray-200 px-2 py-1.5 text-[11px] font-bold text-gray-600">
                      <CalendarClock size={12} className="text-indigo-600" />
                      <input
                        type="date"
                        disabled={busyId === row.id}
                        onChange={e => reschedule(row, e.target.value)}
                        className="w-[7.5rem] border-0 p-0 text-[11px] focus:outline-none disabled:opacity-40"
                      />
                    </label>
                    {row.stage === 'interview' && (
                      <button disabled={busyId === row.id} onClick={() => advance(row, 'offer')}
                        className="flex items-center justify-center gap-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-40">
                        عرض وظيفي
                      </button>
                    )}
                    {row.stage === 'offer' && (
                      <button disabled={busyId === row.id} onClick={() => hire(row)}
                        className="flex items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                        <UserCheck size={13} /> تعيين
                      </button>
                    )}
                    <button disabled={busyId === row.id} onClick={() => advance(row, 'rejected')}
                      className="flex items-center justify-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                      <XCircle size={13} /> رفض
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InterviewsTab;
