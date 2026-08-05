import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, RefreshCw, Star, UserCheck, XCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

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
}

const STARS = [1, 2, 3, 4, 5] as const;

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

  const hire = async (row: JobApplicant) => {
    if (!window.confirm(`إنشاء سجل موظف غير نشط لـ${row.name}؟ التفعيل خطوة منفصلة من دليل الموظفين.`)) return;
    setBusyId(row.id);
    try {
      await mysqlAdmin.hireHrApplicant(row.id, { branch_id: row.job_branch || undefined });
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
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">مقابلة: {counts.interview}</span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">عرض وظيفي: {counts.offer}</span>
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

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm font-bold text-gray-400">
          جاري التحميل...
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center text-sm text-gray-400">
          لا يوجد مرشحون في مرحلة المقابلة أو العرض الوظيفي حاليًا.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => (
            <article key={row.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
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
          ))}
        </div>
      )}
    </div>
  );
};

export default InterviewsTab;
