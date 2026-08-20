import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Plus, RefreshCw, Star, UserCheck, UserPlus, X, XCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { ROLE_LABELS } from '../../../constants/permissions';
import PromptModal from '../../../components/shared/PromptModal';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

interface HireDraft {
  email: string;
  password: string;
  role: string;
  position: string;
  activate: boolean;
}

// Mirrors ROLE_FOR_TYPE in api/routes/hr/talent.js so the form opens on the same
// role the API would have defaulted to.
const DEFAULT_ROLE_FOR_TYPE: Record<string, string> = {
  INSTRUCTOR: 'instructor', CONSULTANT: 'consultant', EMPLOYEE: 'support',
};

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
}

const STARS = [1, 2, 3, 4, 5] as const;

// The desk's own scale. R = مرفوض, W = في الانتظار — they are outcomes, not
// points, which is why this is an ordered list of labels rather than a number.
const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'R', 'W'] as const;
type Grade = typeof GRADES[number];

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

interface JobOption { id: string; title: string; status: string; }

const emptyForm = () => ({ jobId: '', name: '', email: '', phone: '', specialty: '', notes: '' });

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
  const [gradeFilter, setGradeFilter] = useState<Grade | 'all' | 'none'>('all');
  const [gradeFor, setGradeFor] = useState<{ row: JobApplicant; grade: Grade; round: 1 | 2 } | null>(null);
  const [hireFor, setHireFor] = useState<JobApplicant | null>(null);
  const [hireDraft, setHireDraft] = useState<HireDraft>({
    email: '', password: '', role: 'support', position: '', activate: true,
  });

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.listHrApplicants()
      .then(all => setRows((all as unknown as JobApplicant[]).filter(a => a.stage === 'interview' || a.stage === 'offer')))
      .catch(err => notify('error', err instanceof Error ? err.message : 'تعذر تحميل الانترفيوهات'))
      .finally(() => setLoading(false));
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    interview: rows.filter(r => r.stage === 'interview').length,
    offer: rows.filter(r => r.stage === 'offer').length,
  }), [rows]);

  // Matches either round: someone filtering for A+ wants the A+ candidates,
  // not only those who scored it in the round that happens to be first.
  const visibleRows = useMemo(() => (
    gradeFilter === 'all'
      ? rows
      : gradeFilter === 'none'
        ? rows.filter(r => !r.interview_grade && !r.second_interview_grade)
        : rows.filter(r => r.interview_grade === gradeFilter || r.second_interview_grade === gradeFilter)
  ), [rows, gradeFilter]);

  const gradeCounts = useMemo(() => {
    const tally = {} as Record<string, number>;
    for (const row of rows) {
      for (const g of [row.interview_grade, row.second_interview_grade]) {
        if (g) tally[g] = (tally[g] || 0) + 1;
      }
    }
    return tally;
  }, [rows]);

  // Asks for the reason alongside the grade. A letter on its own does not say
  // why, and the note is what the second interviewer actually reads.
  const openGrade = (row: JobApplicant, grade: Grade, round: 1 | 2) => setGradeFor({
    row, grade, round,
  });

  const setGrade = async (row: JobApplicant, grade: Grade, round: 1 | 2, reason: string) => {
    setBusyId(row.id);
    try {
      const result = await mysqlAdmin.gradeApplicant(row.id, { grade, round, body: reason.trim() || undefined });
      notify('success', `تم تسجيل تقييم ${result.grade} للمقابلة ${round === 2 ? 'الثانية' : 'الأولى'} — ${result.by}`);
      setGradeFor(null);
      await load();
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'تعذّر حفظ التقييم');
    } finally {
      setBusyId(null);
    }
  };

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

  // Opens the form rather than hiring immediately. The button used to post only
  // a branch_id, so the API — which needs a login email, and a role to grant
  // anything — answered "حدد بريدًا إلكترونيًا صحيحًا" for every applicant who
  // applied without one, and there was nowhere to supply it.
  const openHire = (row: JobApplicant) => {
    setHireFor(row);
    setHireDraft({
      email: row.email || '',
      password: '',
      role: DEFAULT_ROLE_FOR_TYPE[String(row.applicant_type || '').toUpperCase()] || 'support',
      position: row.specialty || '',
      activate: true,
    });
  };

  const submitHire = async () => {
    if (!hireFor) return;
    const email = hireDraft.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      notify('error', 'اكتب بريدًا إلكترونيًا صحيحًا — هو اسم الدخول للموظف');
      return;
    }
    if (hireDraft.activate && hireDraft.password.length < 8) {
      notify('error', 'كلمة المرور 8 أحرف على الأقل، أو ألغِ التفعيل الفوري');
      return;
    }
    setBusyId(hireFor.id);
    try {
      await mysqlAdmin.hireHrApplicant(hireFor.id, {
        email,
        // Sent only when set: the API treats a password as "ready to work" and
        // activates the account, so an empty one must not reach it as ''.
        ...(hireDraft.password ? { password: hireDraft.password } : {}),
        role: hireDraft.role.toUpperCase(),
        position: hireDraft.position.trim() || undefined,
        branch_id: hireFor.job_branch || undefined,
        activate: hireDraft.activate,
      });
      notify('success', hireDraft.activate
        ? `تم تعيين ${hireFor.name} ويقدر يسجّل دخول بالبريد ده`
        : `تم إنشاء سجل ${hireFor.name} — التفعيل من دليل الموظفين`);
      setHireFor(null);
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
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">مقابلة: {counts.interview}</span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">عرض وظيفي: {counts.offer}</span>
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

      {gradeFor && (
        <PromptModal
          title={`تقييم ${gradeFor.grade} — ${gradeFor.row.name}`}
          label="سبب التقييم (اختياري)"
          hint={`المقابلة ${gradeFor.round === 2 ? 'الثانية' : 'الأولى'}. هيتسجّل اسمك وتاريخ التقييم مع السبب.`}
          placeholder="مثال: إجابات قوية وخبرة عملية واضحة"
          confirmLabel="حفظ التقييم"
          multiline
          busy={busyId === gradeFor.row.id}
          onSubmit={reason => setGrade(gradeFor.row, gradeFor.grade, gradeFor.round, reason)}
          onCancel={() => setGradeFor(null)}
        />
      )}

      {hireFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => busyId ? undefined : setHireFor(null)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">تعيين {hireFor.name}</h3>
              <button onClick={() => setHireFor(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <p className="mb-4 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
              البريد ده هيبقى اسم الدخول بتاع الموظف. لو حطيت كلمة مرور هيقدر يدخل على طول.
            </p>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-700">البريد الإلكتروني (اسم الدخول) *</span>
                <input type="email" dir="ltr" value={hireDraft.email}
                  onChange={e => setHireDraft(d => ({ ...d, email: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="name@mahadnafsy.com" />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-700">كلمة المرور</span>
                <input type="text" dir="ltr" value={hireDraft.password}
                  onChange={e => setHireDraft(d => ({ ...d, password: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                  placeholder="8 أحرف على الأقل" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-700">الوظيفة (الدور) *</span>
                  <select value={hireDraft.role}
                    onChange={e => setHireDraft(d => ({ ...d, role: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none">
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-bold text-gray-700">المسمى الوظيفي</span>
                  <input value={hireDraft.position}
                    onChange={e => setHireDraft(d => ({ ...d, position: e.target.value }))}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
                    placeholder="مثال: أخصائي نفسي" />
                </label>
              </div>

              <label className="flex items-center gap-2 rounded-xl bg-gray-50 p-2.5">
                <input type="checkbox" checked={hireDraft.activate}
                  onChange={e => setHireDraft(d => ({ ...d, activate: e.target.checked }))} />
                <span className="text-xs font-bold text-gray-700">
                  تفعيل الحساب فورًا (يحتاج كلمة مرور)
                </span>
              </label>
            </div>

            <div className="mt-5 flex gap-2">
              <button onClick={submitHire} disabled={busyId === hireFor.id}
                className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                {busyId === hireFor.id ? 'جارٍ التعيين…' : 'تعيين الموظف'}
              </button>
              <button onClick={() => setHireFor(null)} disabled={busyId === hireFor.id}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-gray-100 bg-white p-2.5">
        <span className="ml-1 text-xs font-bold text-gray-500">فلتر التقييم:</span>
        <button onClick={() => setGradeFilter('all')}
          className={`rounded-lg px-2.5 py-1 text-xs font-bold ${gradeFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          الكل ({rows.length})
        </button>
        {GRADES.map(g => (
          <button key={g} onClick={() => setGradeFilter(g)}
            className={`rounded-lg px-2.5 py-1 text-xs font-black ${gradeFilter === g ? GRADE_STYLE[g] : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {g}{gradeCounts[g] ? ` (${gradeCounts[g]})` : ''}
          </button>
        ))}
        <button onClick={() => setGradeFilter('none')}
          className={`rounded-lg px-2.5 py-1 text-xs font-bold ${gradeFilter === 'none' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          بدون تقييم
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
          جاري التحميل...
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-gray-400">
          لا يوجد مرشحون في مرحلة المقابلة أو العرض الوظيفي حاليًا.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map(row => (
            <article key={row.id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${row.stage === 'offer' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700'}`}>
                      {row.stage === 'offer' ? 'عرض وظيفي' : 'مقابلة'}
                    </span>
                    <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{row.job_title}</span>
                    {row.source === 'website' && <span className="rounded-lg bg-blue-50 px-2 py-0.5 text-xs text-blue-700">من الموقع</span>}
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">{row.name}</h3>
                  <p className="text-sm text-gray-600">{row.specialty || row.applicant_type || '—'}</p>
                  <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-500">
                    {row.email && <span dir="ltr">{row.email}</span>}
                    {row.phone && <span dir="ltr">{row.phone}</span>}
                  </div>

                  {/* Grades — one row per interview, each stamped with its own
                      grader, so "who interviewed this person" is answerable per
                      round instead of only for whoever edited the row last. */}
                  <div className="mt-3 space-y-1.5">
                    {([1, 2] as const).map(round => {
                      const current = round === 1 ? row.interview_grade : row.second_interview_grade;
                      const by = round === 1 ? row.interviewed_by_name : row.second_interviewed_by_name;
                      const at = round === 1 ? row.interviewed_at : row.second_interviewed_at;
                      return (
                        <div key={round} className="flex flex-wrap items-center gap-1">
                          <span className="ml-1 w-20 shrink-0 text-[11px] font-bold text-gray-500">
                            {round === 1 ? 'المقابلة 1:' : 'المقابلة 2:'}
                          </span>
                          {GRADES.map(g => (
                            <button key={g} disabled={busyId === row.id}
                              onClick={() => openGrade(row, g, round)}
                              title={`تقييم ${g}`}
                              className={`h-6 min-w-[26px] rounded-md px-1 text-[11px] font-black transition disabled:opacity-40 ${
                                current === g ? GRADE_STYLE[g] : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                              {g}
                            </button>
                          ))}
                          {by && (
                            <span className="mr-1 text-[10px] text-gray-400">
                              — {by}{at ? ` · ${String(at).slice(0, 16).replace('T', ' ')}` : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
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
                  {row.stage === 'interview' && (
                    <button disabled={busyId === row.id} onClick={() => advance(row, 'offer')}
                      className="flex items-center justify-center gap-1 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-40">
                      عرض وظيفي
                    </button>
                  )}
                  {(row.stage === 'offer' || row.stage === 'interview') && (
                    <button disabled={busyId === row.id} onClick={() => openHire(row)}
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
          ))}
        </div>
      )}
    </div>
  );
};

export default InterviewsTab;
