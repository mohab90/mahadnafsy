import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2, CalendarCheck, CalendarClock, GraduationCap, Briefcase,
  Phone, Plus, RefreshCw, Trash2, UserCheck, UserPlus, X, XCircle,
} from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import PromptModal from '../../../../shared/ui/PromptModal';
import HireModal from './interviews-sections/HireModal';
import {
  PHONE_RESULTS, branchLabel, fmtDateTime, matchesMinExperience, yearsLabel,
} from './hr-sections/applicantLabels';
import InterviewFilters, {
  InterviewFilterState, emptyInterviewFilters, interviewFiltersActive, isPastInterview,
} from './interviews-sections/InterviewFilters';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type Stage = 'applied' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected';
const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'R', 'W'] as const;
type Grade = typeof GRADES[number];

const GRADE_TINT: Record<Grade, string> = {
  'A+': 'bg-emerald-50 text-emerald-700', A: 'bg-emerald-50 text-emerald-600',
  'B+': 'bg-sky-50 text-sky-700', B: 'bg-sky-50 text-sky-600',
  'C+': 'bg-amber-50 text-amber-700', C: 'bg-amber-50 text-amber-600',
  R: 'bg-red-50 text-red-600', W: 'bg-gray-100 text-gray-500',
};

const GRADE_STYLE: Record<Grade, string> = {
  'A+': 'bg-emerald-600 text-white',
  A: 'bg-emerald-500 text-white',
  'B+': 'bg-sky-600 text-white',
  B: 'bg-sky-500 text-white',
  'C+': 'bg-amber-500 text-white',
  C: 'bg-amber-400 text-white',
  R: 'bg-red-600 text-white',
  W: 'bg-gray-500 text-white',
};

interface JobApplicant {
  id: string;
  job_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage: Stage;
  stage_notes: string | null;
  interview_grade: Grade | null;
  second_interview_grade: Grade | null;
  interviewed_by_name: string | null;
  second_interviewed_by_name: string | null;
  interviewed_at: string | null;
  second_interviewed_at: string | null;
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

interface JobOption { id: string; title: string; status: string; }

// Mirrors what the public application form collects, so a candidate added by
// hand carries the same detail as one who applied through the website — and
// shows up correctly under the experience and branch filters.
const emptyForm = () => ({ jobId: '', name: '', email: '', phone: '', specialty: '',
  education: '', experienceYears: '', experiencePlaces: '', branch: '', notes: '' });

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
        // Sent as real columns rather than glued into the notes text, so the
        // experience and branch filters can actually see a hand-added candidate.
        specialty: form.specialty.trim() || undefined,
        education: form.education.trim() || undefined,
        experience_years: form.experienceYears || undefined,
        experience_places: form.experiencePlaces.trim() || undefined,
        branch: form.branch.trim() || undefined,
        notes: form.notes.trim() || undefined,
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
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-600">المؤهل</label>
            <input value={form.education} onChange={e => setForm(f => ({ ...f, education: e.target.value }))}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold text-gray-600">سنين الخبرة</label>
            <select value={form.experienceYears} onChange={e => setForm(f => ({ ...f, experienceYears: e.target.value }))}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              <option value="none">بدون خبرة</option>
              <option value="under_1">أقل من سنة</option>
              <option value="1_3">1 – 3 سنوات</option>
              <option value="3_5">3 – 5 سنوات</option>
              <option value="5_10">5 – 10 سنوات</option>
              <option value="over_10">أكثر من 10 سنوات</option>
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">أماكن الخبرة السابقة</label>
          <input value={form.experiencePlaces} onChange={e => setForm(f => ({ ...f, experiencePlaces: e.target.value }))}
            placeholder="مثال: شركة كذا، مركز كذا"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold text-gray-600">الفرع</label>
          <input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))}
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
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all' | 'none'>('all');
  const [gradeFor, setGradeFor] = useState<{ row: JobApplicant; grade: Grade; round: 1 | 2 } | null>(null);
  const [hireFor, setHireFor] = useState<JobApplicant | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.listHrApplicants()
      .then(all => setRows((all as unknown as JobApplicant[]).filter(a => a.stage === 'interview' || a.stage === 'offer')))
      .catch(err => notify('error', err instanceof Error ? err.message : 'تعذر تحميل الانترفيوهات'))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  // Counted against the open tab, so "في المقابلات ٣" describes the three rows
  // actually on screen rather than three that may all be in the other list.
  const inTimeline = useMemo(
    () => rows.filter(r => isPastInterview(r.interview_at) === (filters.timeline === 'past')),
    [rows, filters.timeline]);

  const counts = useMemo(() => ({
    all: inTimeline.length,
    interview: inTimeline.filter(r => r.stage === 'interview').length,
    offer: inTimeline.filter(r => r.stage === 'offer').length,
  }), [inTimeline]);

  // The tab tallies are counted over everything, never over the open tab —
  // otherwise the tab you are not looking at would always read 0.
  const timelineCounts = useMemo(() => {
    const past = rows.filter(r => isPastInterview(r.interview_at)).length;
    return { upcoming: rows.length - past, past };
  }, [rows]);

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
    return inTimeline
      .filter(r => {
        if (filters.view !== 'all' && r.stage !== filters.view) return false;
        if (filters.jobId && r.job_id !== filters.jobId) return false;
        if (filters.branch && (r.applicant_branch || r.job_branch) !== filters.branch) return false;
        if (!matchesMinExperience(r.experience_years, min)) return false;
        if (needle) {
          const hay = `${r.name} ${r.phone || ''} ${r.email || ''} ${r.specialty || ''}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        if (gradeFilter === 'none' && (r.interview_grade || r.second_interview_grade)) return false;
        if (gradeFilter !== 'all' && gradeFilter !== 'none'
          && r.interview_grade !== gradeFilter && r.second_interview_grade !== gradeFilter) return false;
        return true;
      })
      // Upcoming reads soonest-first; past reads most-recent-first, because the
      // interview you want after the fact is the one you just finished, not the
      // oldest one on file.
      .sort((a, b) => (filters.timeline === 'past'
        ? scheduleKey(b) - scheduleKey(a)
        : scheduleKey(a) - scheduleKey(b)));
  }, [inTimeline, filters, gradeFilter]);

  const openGrade = (row: JobApplicant, grade: Grade, round: 1 | 2) => setGradeFor({ row, grade, round });

  const setGrade = async (row: JobApplicant, grade: Grade, round: 1 | 2, reason: string) => {
    setBusyId(row.id);
    try {
      const result = await mysqlAdmin.gradeApplicant(row.id, { grade, round, body: reason.trim() || undefined });
      notify('success', `تم تسجيل تقييم ${result.grade} للمقابلة ${round === 2 ? 'الثانية' : 'الأولى'} — ${result.by}`);
      setGradeFor(null);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ التقييم');
    } finally { setBusyId(null); }
  };

  const gradeCounts = useMemo(() => {
    const tally = {} as Record<string, number>;
    for (const row of rows) {
      for (const g of [row.interview_grade, row.second_interview_grade]) {
        if (g) tally[g] = (tally[g] || 0) + 1;
      }
    }
    return tally;
  }, [rows]);


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
      notify('success', stage === 'offer' ? `${row.name} → مقبول للتدريب` : `${row.name} → مرفوض`);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر تحديث المرحلة');
    } finally {
      setBusyId(null);
    }
  };


  const hire = (row: JobApplicant) => setHireFor(row);

  const [contactFor, setContactFor] = useState<JobApplicant | null>(null);
  const [rejectFor, setRejectFor] = useState<JobApplicant | null>(null);

  const markNoAnswer = async (row: JobApplicant) => {
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { phone_interview_result: 'no_answer' });
      notify('success', `${row.name} — مسجّل: لا يرد`);
      setContactFor(null);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر التسجيل');
    } finally { setBusyId(null); }
  };

  const rejectWithReason = async (row: JobApplicant, reason: string) => {
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { stage: 'rejected', stage_notes: reason.trim() || undefined });
      notify('success', `تم رفض ${row.name}`);
      setRejectFor(null);
      setContactFor(null);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ الرفض');
    } finally { setBusyId(null); }
  };

  const removeApplicant = async (row: JobApplicant) => {
    if (!await confirmDialog(`حذف ${row.name} من الانترفيوهات نهائيًا؟`)) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.deleteHrApplicant(row.id);
      notify('success', `تم حذف ${row.name}`);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر الحذف');
    } finally { setBusyId(null); }
  };


  return (
    <div className="space-y-4">
      {/* A letter on its own does not say why, and the reason is what the second
          interviewer actually reads — so it is asked for with the grade. */}
      {contactFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setContactFor(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-xs space-y-2 rounded-2xl bg-white p-4 shadow-2xl" dir="rtl">
            <h3 className="text-sm font-bold text-gray-900">نتيجة التواصل — {contactFor.name}</h3>
            <p className="text-[11px] text-gray-500">اختار اللي حصل في المكالمة.</p>
            <button disabled={busyId === contactFor.id} onClick={() => markNoAnswer(contactFor)}
              className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-40">
              لا يرد
            </button>
            <button disabled={busyId === contactFor.id} onClick={() => { const r = contactFor; setContactFor(null); void advance(r, 'offer'); }}
              className="w-full rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
              هينزل تدريب
            </button>
            <button disabled={busyId === contactFor.id} onClick={() => setRejectFor(contactFor)}
              className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
              رفض
            </button>
            <button onClick={() => setContactFor(null)}
              className="w-full rounded-xl px-3 py-2 text-xs font-bold text-gray-400 hover:bg-gray-50">إلغاء</button>
          </div>
        </div>
      )}
      {rejectFor && (
        <PromptModal
          title={`رفض ${rejectFor.name}`}
          label="سبب الرفض"
          hint="بيتسجّل على المرشح، وهو اللي هيتقرا لو اتقدّم تاني."
          confirmLabel="تأكيد الرفض"
          multiline
          required
          busy={busyId === rejectFor.id}
          onSubmit={reason => { void rejectWithReason(rejectFor, reason); }}
          onCancel={() => setRejectFor(null)}
        />
      )}
      {hireFor && (
        <HireModal
          applicant={hireFor}
          notify={notify}
          onClose={() => setHireFor(null)}
          onHired={() => { void load(); }}
        />
      )}
      {gradeFor && (
        <PromptModal
          title={`تقييم ${gradeFor.row.name} — ${gradeFor.grade}`}
          label={`سبب التقييم (${gradeFor.round === 2 ? 'المقابلة الثانية' : 'المقابلة الأولى'})`}
          hint="اختياري، لكنه اللي المُقابِل التاني هيقراه."
          confirmLabel="حفظ التقييم"
          multiline
          busy={busyId === gradeFor.row.id}
          onSubmit={reason => { void setGrade(gradeFor.row, gradeFor.grade, gradeFor.round, reason); }}
          onCancel={() => setGradeFor(null)}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <CalendarCheck size={22} className="text-violet-600" />
            الانترفيوهات
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            مرشحون وصلوا لمرحلة المقابلة — قيّمهم، سجّل ملاحظاتك، وانقلهم لمقبول للتدريب أو تعيين. النقل من طلبات الانضمام بزرار "نقل للمقابلات" هناك.
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
          timelineCounts={timelineCounts}
          shown={visible.length}
          extra={(
            <div className="flex flex-wrap items-center gap-1">
              <span className="ml-1 text-xs font-bold text-gray-500">التقييم:</span>
              <button type="button" onClick={() => setGradeFilter('all')}
                className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${gradeFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                الكل ({rows.length})
              </button>
              {GRADES.map(g => (
                <button type="button" key={g} onClick={() => setGradeFilter(g)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-black ${gradeFilter === g ? GRADE_STYLE[g] : `${GRADE_TINT[g]} hover:brightness-95`}`}>
                  {g}{gradeCounts[g] ? ` (${gradeCounts[g]})` : ''}
                </button>
              ))}
              <button type="button" onClick={() => setGradeFilter('none')}
                className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${gradeFilter === 'none' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                بدون
              </button>
            </div>
          )}
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
              <article key={row.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${row.stage === 'offer' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>
                        {row.stage === 'offer' ? 'مقبول للتدريب' : 'مقابلة'}
                      </span>
                      <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{row.job_title}</span>
                      {row.source === 'website' && <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs text-blue-700">من الموقع</span>}
                      {phone && <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${phone.tone}`}>{phone.label}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900">{row.name}</h3>
                      {([1, 2] as const).map(round => {
                        const current = round === 1 ? row.interview_grade : row.second_interview_grade;
                        const by = round === 1 ? row.interviewed_by_name : row.second_interviewed_by_name;
                        const at = round === 1 ? row.interviewed_at : row.second_interviewed_at;
                        return (
                          <span key={round} className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-gray-400">{round === 1 ? "م1" : "م2"}</span>
                            <select
                              disabled={busyId === row.id}
                              value={current || ''}
                              onChange={e => { const g = e.target.value; if (g) openGrade(row, g as Grade, round); }}
                              title={by ? `${by}${at ? ` · ${String(at).slice(0, 16).replace('T', ' ')}` : ''}` : 'لم يُقيَّم بعد'}
                              className={`h-6 cursor-pointer rounded-md border-0 px-1 text-[11px] font-black outline-none ${
                                current ? GRADE_STYLE[current] : 'bg-gray-100 text-gray-500'}`}
                            >
                              <option value="">—</option>
                              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                            </select>
                          </span>
                        );
                      })}
                    </div>
                    <p className="text-sm text-gray-600">{row.specialty || row.applicant_type || '—'}</p>
                    <p className="mt-0.5 text-[10px] text-gray-400">
                      أُضيف: {fmtDateTime(row.created_at) || '—'}
                    </p>
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

                    {(row.interviewed_by_name || row.second_interviewed_by_name) && (
                      <p className="mt-1 text-[10px] text-gray-400">
                        {row.interviewed_by_name && `م1: ${row.interviewed_by_name}`}
                        {row.interviewed_by_name && row.second_interviewed_by_name && ' · '}
                        {row.second_interviewed_by_name && `م2: ${row.second_interviewed_by_name}`}
                      </p>
                    )}

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
                    <button disabled={busyId === row.id} onClick={() => setContactFor(row)}
                      className="flex items-center justify-center gap-1 rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:opacity-40">
                      <Phone size={13} /> تواصل
                    </button>
                    {/* stage actions */}
                    {/* Shown from the interview stage on. It used to appear only while stage was exactly 'interview', so it vanished the moment anyone used it — and every candidate already past it had no visible path to hiring. */}
                    {(row.stage === 'interview' || row.stage === 'offer') && (
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
                    <button disabled={busyId === row.id} onClick={() => removeApplicant(row)}
                      title="حذف نهائي من الانترفيوهات"
                      className="flex items-center justify-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs font-bold text-gray-600 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                      <Trash2 size={13} /> حذف
                    </button>
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
