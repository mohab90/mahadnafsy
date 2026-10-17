import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../../../shared/ui/Modal';
import { CalendarCheck, Plus, RefreshCw, UserPlus } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import PromptModal from '../../../../shared/ui/PromptModal';
import HireModal from './interviews-sections/HireModal';
import InterviewCard, {
  GRADES, type Grade, type InterviewActions, type JobApplicant,
} from './interviews-sections/InterviewCard';
import { EXPERIENCE_ORDER, EXPERIENCE_YEARS, branchLabel } from './hr-sections/applicantLabels';
import InterviewFilters, {
  InterviewFilterState, emptyInterviewFilters, interviewFiltersActive,
} from './interviews-sections/InterviewFilters';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props {
  notify: NotifyFn;
  /** Whose interviews: the employees' (the page) or the lecturers' (a tab of طلبات انضمام المحاضرين). */
  group?: 'staff' | 'teaching';
  /** Inside another page: no heading of its own, only the buttons. */
  embedded?: boolean;
}

const PAGE_SIZE = 50;

type Summary = Awaited<ReturnType<typeof mysqlAdmin.hrInterviewsSummary>>;

interface JobOption { id: string; title: string; status: string; }

// Mirrors what the public application form collects, so a candidate added by
// hand carries the same detail as one who applied through the website — and
// shows up correctly under the experience and branch filters.
const emptyForm = () => ({ jobId: '', name: '', email: '', phone: '', specialty: '',
  education: '', experienceYears: '', experiencePlaces: '', branch: '', notes: '' });

// Standalone entry point into the interview stage — before this, the only
// way in was طلبات الانضمام's "نقل للمقابلات", which requires a candidate to
// already exist as a website submission. Staff who source a candidate
// themselves (referral, LinkedIn, a walk-in) had no way to add them here
// directly. Reuses POST .../applicants?stage=interview (added alongside this)
// so it goes through the exact same applied→screening→interview hops as
// every other interview candidate, just in one step.
const AddInterviewModal: React.FC<{ notify: NotifyFn; group: 'staff' | 'teaching'; onClose: () => void; onAdded: () => void }> = ({ notify, group, onClose, onAdded }) => {
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
        // Which list the candidate belongs on: the interviews of employees and of lecturers are kept apart.
        applicant_type: group === 'teaching' ? 'INSTRUCTOR' : 'EMPLOYEE',
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
    // The form stays inside the body so its submit button keeps working —
    // Modal renders its footer outside the form.
    <Modal
      open
      onClose={onClose}
      title="إضافة انترفيو"
      icon={<UserPlus size={18} className="text-violet-600" />}
      size="sm"
    >
      <form onSubmit={submit} className="space-y-3">
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
            {/* The same six values the application form stores, so the experience filter finds this candidate. */}
            <select value={form.experienceYears} onChange={e => setForm(f => ({ ...f, experienceYears: e.target.value }))}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
              <option value="">—</option>
              {EXPERIENCE_ORDER.map(key => <option key={key} value={key}>{EXPERIENCE_YEARS[key]}</option>)}
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
    </Modal>
  );
};

// "الانترفيوهات" — a dedicated, nameable stop between طلبات الانضمام and
// الموظفون. The pipeline itself (applied→screening→interview→offer→hired)
// already existed (see hr-sections/RecruitmentPipelinePanel.tsx and
// api/routes/hr/{recruiting,talent}.js) — this page is a focused view on
// candidates who have actually reached an interview, with the one thing
// that pipeline view didn't have: a structured grade recorded at the
// interview stage, not just free-text notes.
//
// «الانترفيو تقيل جدا … خلي تصميمه شبه طلب الانضمام … 2 تاب: اللي واخد ميعاد وحضر،
// واللي واخد ميعاد فقط ولسه موعده» (17 Oct 2026). The tab, the filters and the
// paging run in the database (GET /api/admin/hr/interviews): the screen draws the
// 50 it asked for and asks for 50 more on request. It used to download 500
// candidates of every stage and keep the few at interview or offer here.
const InterviewsTab: React.FC<Props> = ({ notify, group = 'staff', embedded = false }) => {
  const [rows, setRows] = useState<JobApplicant[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filters, setFilters] = useState<InterviewFilterState>(emptyInterviewFilters);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all' | 'none'>('all');
  const [gradeFor, setGradeFor] = useState<{ row: JobApplicant; grade: Grade; round: 1 | 2 } | null>(null);
  const [hireFor, setHireFor] = useState<JobApplicant | null>(null);
  const [contactFor, setContactFor] = useState<JobApplicant | null>(null);
  const [rejectFor, setRejectFor] = useState<JobApplicant | null>(null);
  const [contactNote, setContactNote] = useState('');
  // Bumped after anything changed: the list and the tallies are read again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(filters.query), 300);
    return () => window.clearTimeout(timer);
  }, [filters.query]);

  const query = useMemo(() => ({
    tab: filters.timeline,
    view: filters.view === 'all' ? '' : filters.view,
    job: filters.jobId, branch: filters.branch, minExp: filters.minExperience,
    grade: gradeFilter === 'all' ? '' : gradeFilter,
    q: debouncedQuery.trim(), form: group,
  }), [group, filters.timeline, filters.view, filters.jobId, filters.branch, filters.minExperience, gradeFilter, debouncedQuery]);

  // The newest request wins, so a slow answer to an old filter never overwrites a newer list.
  const requestId = useRef(0);
  const lastKey = useRef('');
  const loaded = useRef(0);
  loaded.current = rows.length;

  useEffect(() => {
    const id = ++requestId.current;
    const key = JSON.stringify(query);
    // The same filters read again (after an action) keep what is on screen and ask for as many rows as
    // are already drawn; new filters start over at the first page.
    const same = lastKey.current === key;
    lastKey.current = key;
    if (!same) setLoading(true);
    const limit = same ? Math.min(200, Math.max(PAGE_SIZE, loaded.current)) : PAGE_SIZE;
    mysqlAdmin.listHrInterviews({ ...query, limit, offset: 0 })
      .then(result => {
        if (id !== requestId.current) return;
        setRows(result.rows as unknown as JobApplicant[]);
        setTotal(result.total);
      })
      .catch(err => { if (id === requestId.current) notify('error', err instanceof Error ? err.message : 'تعذر تحميل الانترفيوهات'); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [query, version, notify]);

  const more = async () => {
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const result = await mysqlAdmin.listHrInterviews({ ...query, limit: PAGE_SIZE, offset: rows.length });
      if (id !== requestId.current) return;
      setRows(previous => {
        const seen = new Set(previous.map(row => row.id));
        return [...previous, ...(result.rows as unknown as JobApplicant[]).filter(row => !seen.has(row.id))];
      });
      setTotal(result.total);
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذر تحميل المزيد');
    } finally { setLoadingMore(false); }
  };

  // The tallies and the pickers' options, read with the tab open and again after a change.
  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.hrInterviewsSummary(filters.timeline, group)
      .then(result => { if (!cancelled) setSummary(result); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [group, filters.timeline, version]);

  const reload = useCallback(() => setVersion(current => current + 1), []);

  const timelineCounts = summary?.tabs || { upcoming: 0, past: 0 };
  const counts = {
    all: (summary?.stages.interview || 0) + (summary?.stages.offer || 0),
    interview: summary?.stages.interview || 0,
    offer: summary?.stages.offer || 0,
  };
  const jobOptions = (summary?.jobs || []).map(job => ({ value: job.id, label: job.title || 'وظيفة محذوفة', count: job.count }));
  const branchOptions = (summary?.branches || []).map(item => ({ value: item.key, label: branchLabel(item.key), count: item.count }));
  const everyone = timelineCounts.upcoming + timelineCounts.past;

  const setGrade = async (row: JobApplicant, grade: Grade, round: 1 | 2, reason: string) => {
    setBusyId(row.id);
    try {
      const result = await mysqlAdmin.gradeApplicant(row.id, { grade, round, body: reason.trim() || undefined });
      notify('success', `تم تسجيل تقييم ${result.grade} للمقابلة ${round === 2 ? 'الثانية' : 'الأولى'} — ${result.by}`);
      setGradeFor(null);
      reload();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ التقييم');
    } finally { setBusyId(null); }
  };

  const saveNote = async (row: JobApplicant, note: string) => {
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { stage_notes: note });
      notify('success', 'تم حفظ ملاحظات المقابلة');
      reload();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ الملاحظات');
    } finally { setBusyId(null); }
  };

  const advance = async (row: JobApplicant, stage: 'offer' | 'rejected') => {
    setBusyId(row.id);
    try {
      await mysqlAdmin.updateHrApplicant(row.id, { stage });
      notify('success', stage === 'offer' ? `${row.name} → مقبول للتدريب` : `${row.name} → مرفوض`);
      reload();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر تحديث المرحلة');
    } finally { setBusyId(null); }
  };

  // «ليه التواصل مش بيتجسل صح» (12 Oct 2026): «لا يرد» used to write the result
  // alone — no time, no caller, nothing in the history — and the other two
  // answers recorded no call at all. Every answer is logged as a call now (the
  // server stamps the time and the caller), then acted on.
  const logCall = async (row: JobApplicant, result: 'no_answer' | 'passed' | 'failed') => {
    await mysqlAdmin.contactHrApplicant(row.id, { result, body: contactNote.trim() || undefined });
  };

  const markNoAnswer = async (row: JobApplicant) => {
    setBusyId(row.id);
    try {
      await logCall(row, 'no_answer');
      notify('success', `${row.name} — اتسجّل: مردّش`);
      setContactFor(null);
      setContactNote('');
      reload();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر التسجيل');
    } finally { setBusyId(null); }
  };

  const markTraining = async (row: JobApplicant) => {
    setBusyId(row.id);
    try {
      await logCall(row, 'passed');
      setContactFor(null);
      setContactNote('');
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر التسجيل');
      setBusyId(null);
      return;
    }
    setBusyId(null);
    await advance(row, 'offer');
  };

  const rejectWithReason = async (row: JobApplicant, reason: string) => {
    setBusyId(row.id);
    try {
      if (contactFor?.id === row.id) await logCall(row, 'failed');
      await mysqlAdmin.updateHrApplicant(row.id, { stage: 'rejected', stage_notes: reason.trim() || undefined });
      notify('success', `تم رفض ${row.name}`);
      setRejectFor(null);
      setContactFor(null);
      reload();
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
      reload();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر الحذف');
    } finally { setBusyId(null); }
  };

  // The cards are memoised, so they get handlers that keep their identity;
  // these call whatever the current render built.
  const latest = useRef<InterviewActions | null>(null);
  latest.current = {
    onGrade: (row, grade, round) => setGradeFor({ row, grade, round }),
    onSaveNote: saveNote,
    onContact: row => setContactFor(row),
    onOffer: row => { void advance(row, 'offer'); },
    onHire: row => setHireFor(row),
    onReject: row => { void advance(row, 'rejected'); },
    onRemove: row => { void removeApplicant(row); },
  };
  const actions = useMemo<InterviewActions>(() => ({
    onGrade: (row, grade, round) => latest.current!.onGrade(row, grade, round),
    onSaveNote: (row, note) => latest.current!.onSaveNote(row, note),
    onContact: row => latest.current!.onContact(row),
    onOffer: row => latest.current!.onOffer(row),
    onHire: row => latest.current!.onHire(row),
    onReject: row => latest.current!.onReject(row),
    onRemove: row => latest.current!.onRemove(row),
  }), []);

  return (
    <div className="space-y-4">
      {/* A letter on its own does not say why, and the reason is what the second
          interviewer actually reads — so it is asked for with the grade. */}
      {contactFor && (
        <Modal
          open
          onClose={() => setContactFor(null)}
          title={`نتيجة التواصل — ${contactFor.name}`}
          subtitle="اختار اللي حصل في المكالمة"
          size="sm"
        >
          <p className="text-[11px] text-gray-500">اختار اللي حصل في المكالمة — هتتسجّل باسمك ووقتها في سجل المتقدم.</p>
          <textarea value={contactNote} onChange={e => setContactNote(e.target.value)} rows={2}
            placeholder="ملاحظة عن المكالمة (اختياري)"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <button disabled={busyId === contactFor.id} onClick={() => markNoAnswer(contactFor)}
            className="w-full rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-200 disabled:opacity-40">
            لا يرد
          </button>
          <button disabled={busyId === contactFor.id} onClick={() => { void markTraining(contactFor); }}
            className="w-full rounded-xl bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
            هينزل تدريب
          </button>
          <button disabled={busyId === contactFor.id} onClick={() => setRejectFor(contactFor)}
            className="w-full rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
            رفض
          </button>
          <button onClick={() => { setContactFor(null); setContactNote(''); }}
            className="w-full rounded-xl px-3 py-2 text-xs font-bold text-gray-400 hover:bg-gray-50">إلغاء</button>
        </Modal>
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
          onHired={reload}
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
      {/* Inside the lecturers' page the heading is that page's; only the buttons are drawn. */}
      <section className={embedded
        ? 'flex items-center justify-end gap-2'
        : 'flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-violet-700 px-4 py-3 text-white'}>
        {!embedded && (
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-black"><CalendarCheck size={20} /> انترفيوهات الموظفين</h2>
            <p className="mt-0.5 text-[11px] text-white/80">قيّمهم، سجّل ملاحظاتك، وانقلهم لمقبول للتدريب أو تعيين. النقل من طلبات الانضمام بزرار «نقل للانترفيو».</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => setShowAddModal(true)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${embedded ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-white text-violet-800 hover:bg-violet-50'}`}>
            <UserPlus size={13} /> إضافة انترفيو
          </button>
          <button onClick={reload} disabled={loading}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${embedded ? 'bg-gray-100 text-gray-700 hover:bg-gray-200' : 'bg-white/15 hover:bg-white/25'}`}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
        </div>
      </section>

      {showAddModal && <AddInterviewModal notify={notify} group={group} onClose={() => setShowAddModal(false)} onAdded={reload} />}

      <InterviewFilters
        value={filters}
        onChange={setFilters}
        jobs={jobOptions}
        branches={branchOptions}
        counts={counts}
        timelineCounts={timelineCounts}
        shown={total}
        extra={(
          <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value as Grade | 'all' | 'none')} aria-label="التقييم" title="التقييم"
            className="h-7 shrink-0 rounded-lg border border-gray-200 bg-white px-2 text-[11px]">
            <option value="all">كل التقييمات</option>
            {GRADES.map(g => <option key={g} value={g}>{g}{summary?.grades[g] ? ` (${summary.grades[g]})` : ''}</option>)}
            <option value="none">بدون تقييم</option>
          </select>
        )}
      />

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
          جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-gray-500" dir="rtl">
          {everyone === 0 ? 'لا يوجد مرشحون في مرحلة المقابلة أو العرض الوظيفي حاليًا.' : 'مفيش مرشح مطابق هنا.'}
          {(interviewFiltersActive(filters) || gradeFilter !== 'all') && (
            <button onClick={() => { setFilters(f => ({ ...emptyInterviewFilters(), timeline: f.timeline })); setGradeFilter('all'); }}
              className="mr-2 font-bold text-violet-600 hover:underline">
              اعرض الكل
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {rows.map(row => (
              <InterviewCard key={row.id} row={row} busy={busyId === row.id} actions={actions} />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1 text-xs font-bold text-gray-500">
            <span>ظاهر {rows.length.toLocaleString('ar-EG-u-nu-latn')} من {total.toLocaleString('ar-EG-u-nu-latn')}</span>
            {total > rows.length && (
              <button onClick={() => { void more(); }} disabled={loadingMore}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50">
                {loadingMore ? 'جاري التحميل...' : `عرض ${Math.min(PAGE_SIZE, total - rows.length).toLocaleString('ar-EG-u-nu-latn')} مرشح كمان`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default InterviewsTab;
