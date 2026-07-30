import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Mail,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useSiteData } from '../../../context/SiteDataContext';

type Notify = (type: 'success' | 'error' | 'info', text: string) => void;
type EnrollmentStatus = 'active' | 'paused' | 'completed' | 'unenrolled' | 'failed' | 'unsubscribed';

interface SequenceStep {
  delay_days: number;
  subject: string;
  body_html: string;
}

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  is_active: number | boolean;
  steps: SequenceStep[];
  version: number;
  timezone: string;
  exit_on_reply: number | boolean;
  enrolled_count: number;
  active_count: number;
  paused_count: number;
  completed_count: number;
  failed_count: number;
}

interface Enrollment {
  id: string;
  sequence_id: string;
  sequence_name: string;
  lead_id: string | null;
  subscriber_id: string | null;
  email: string;
  status: EnrollmentStatus;
  current_step: number;
  executed_steps: number;
  next_send_at: string | null;
}

const EMPTY_SEQUENCE = { name: '', description: '', timezone: 'Africa/Cairo', exit_on_reply: true };
const EMPTY_STEP: SequenceStep = { delay_days: 1, subject: '', body_html: '' };
const STATUS_LABEL: Record<EnrollmentStatus, string> = {
  active: 'نشط',
  paused: 'متوقف مؤقتًا',
  completed: 'مكتمل',
  unenrolled: 'تم إلغاء التسجيل',
  failed: 'فشل',
  unsubscribed: 'ألغى الاشتراك',
};

export default function DripCampaignsTab({ notify }: { notify: Notify }) {
  const { leads, subscribers } = useSiteData();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(EMPTY_SEQUENCE);
  const [stepDraft, setStepDraft] = useState(EMPTY_STEP);
  const [enrollTarget, setEnrollTarget] = useState<{
    sequenceId: string;
    kind: 'lead' | 'subscriber';
    subjectId: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sequenceRows, enrollmentRows] = await Promise.all([
        mysqlAdmin.adminGet<Sequence[]>('/admin/crm/sequences'),
        mysqlAdmin.adminGet<Enrollment[]>('/admin/crm/sequence-enrollments'),
      ]);
      setSequences(sequenceRows || []);
      setEnrollments(enrollmentRows || []);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تحميل تسلسلات المتابعة');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => sequences.reduce((result, row) => ({
    sequences: result.sequences + 1,
    active: result.active + Number(row.active_count || 0),
    paused: result.paused + Number(row.paused_count || 0),
    completed: result.completed + Number(row.completed_count || 0),
  }), { sequences: 0, active: 0, paused: 0, completed: 0 }), [sequences]);

  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await operation();
      notify('success', success);
      await load();
      return true;
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تنفيذ العملية');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const createSequence = async () => {
    if (!draft.name.trim()) return notify('error', 'اسم التسلسل مطلوب');
    const created = await mutate(
      () => mysqlAdmin.adminPost('/admin/crm/sequences', { ...draft, steps: [] }),
      'تم إنشاء التسلسل',
    );
    if (created) {
      setDraft(EMPTY_SEQUENCE);
      setShowCreate(false);
    }
  };

  const updateSequence = (id: string, body: Record<string, unknown>, success: string) =>
    mutate(() => mysqlAdmin.adminPatch(`/admin/crm/sequences/${id}`, body), success);

  const archiveSequence = async (sequence: Sequence) => {
    if (!window.confirm(`أرشفة "${sequence.name}" وإيقاف تسجيلاته النشطة؟ سيظل التاريخ محفوظًا.`)) return;
    await mutate(() => mysqlAdmin.adminDelete(`/admin/crm/sequences/${sequence.id}`), 'تمت أرشفة التسلسل');
  };

  const addStep = async (sequence: Sequence) => {
    if (!stepDraft.subject.trim() || !stepDraft.body_html.trim()) {
      return notify('error', 'عنوان الرسالة ومحتواها مطلوبان');
    }
    const done = await updateSequence(
      sequence.id,
      { steps: [...sequence.steps, stepDraft] },
      'تم حفظ إصدار جديد من التسلسل؛ التسجيلات الحالية لن تتغير',
    );
    if (done) setStepDraft(EMPTY_STEP);
  };

  const enroll = async () => {
    if (!enrollTarget?.subjectId) return notify('error', 'اختر العميل');
    const body = enrollTarget.kind === 'lead'
      ? { lead_id: enrollTarget.subjectId }
      : { subscriber_id: enrollTarget.subjectId };
    const done = await mutate(
      () => mysqlAdmin.adminPost(`/admin/crm/sequences/${enrollTarget.sequenceId}/enroll`, body),
      'تم تسجيل العميل في التسلسل',
    );
    if (done) setEnrollTarget(null);
  };

  const enrollmentAction = (row: Enrollment, action: 'pause' | 'resume' | 'unenroll') =>
    mutate(
      () => mysqlAdmin.adminPost(`/admin/crm/sequence-enrollments/${row.id}/actions`, { action }),
      action === 'pause' ? 'تم إيقاف المتابعة مؤقتًا' : action === 'resume' ? 'تم استئناف المتابعة' : 'تم إلغاء التسجيل',
    );

  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl bg-gradient-to-l from-fuchsia-700 to-pink-600 p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-bold"><Layers size={22} />تسلسلات متابعة المبيعات</h2>
            <p className="mt-1 text-sm text-fuchsia-100">إصدارات ثابتة، خروج عند الرد، وتتبع فعلي لكل خطوة</p>
          </div>
          <button type="button" onClick={() => setShowCreate(value => !value)}
            className="flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 text-sm font-bold hover:bg-white/30">
            {showCreate ? <><X size={16} />إغلاق</> : <><Plus size={16} />تسلسل جديد</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['التسلسلات', totals.sequences, 'bg-fuchsia-50 border-fuchsia-100'],
          ['تسجيلات نشطة', totals.active, 'bg-emerald-50 border-emerald-100'],
          ['متوقفة مؤقتًا', totals.paused, 'bg-amber-50 border-amber-100'],
          ['مكتملة', totals.completed, 'bg-blue-50 border-blue-100'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className={`rounded-2xl border p-4 text-center ${color}`}>
            <div className="text-xl font-extrabold text-gray-900">{value}</div>
            <div className="mt-1 text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {showCreate && (
        <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="font-bold text-gray-800">إنشاء تسلسل</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <input aria-label="اسم التسلسل" value={draft.name}
              onChange={event => setDraft(value => ({ ...value, name: event.target.value }))}
              placeholder="اسم التسلسل" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <input aria-label="المنطقة الزمنية" value={draft.timezone}
              onChange={event => setDraft(value => ({ ...value, timezone: event.target.value }))}
              placeholder="Africa/Cairo" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <input aria-label="وصف التسلسل" value={draft.description}
              onChange={event => setDraft(value => ({ ...value, description: event.target.value }))}
              placeholder="وصف مختصر" className="rounded-xl border border-gray-300 px-3 py-2 text-sm md:col-span-2" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={draft.exit_on_reply}
              onChange={event => setDraft(value => ({ ...value, exit_on_reply: event.target.checked }))} />
            إلغاء تسجيل العميل تلقائيًا عند تسجيل رد منه
          </label>
          <button type="button" disabled={saving} onClick={() => { void createSequence(); }}
            className="flex items-center gap-2 rounded-xl bg-fuchsia-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            <CheckCircle2 size={15} />حفظ
          </button>
        </section>
      )}

      {loading && <div className="p-10 text-center text-gray-400"><RefreshCw className="mx-auto animate-spin" />جاري التحميل...</div>}
      {!loading && sequences.map(sequence => {
        const sequenceEnrollments = enrollments.filter(row => row.sequence_id === sequence.id);
        const expanded = expandedId === sequence.id;
        return (
          <section key={sequence.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex items-center gap-3 p-4">
              <div className={`rounded-xl p-2 ${sequence.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                <Layers size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-gray-800">{sequence.name}</strong>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px]">الإصدار {sequence.version}</span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-700">{sequence.timezone}</span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {sequence.steps.length} خطوة · {Number(sequence.enrolled_count || 0)} تسجيل · {Number(sequence.completed_count || 0)} مكتمل
                </p>
              </div>
              <button type="button" aria-label="تسجيل عميل" title="تسجيل عميل"
                onClick={() => setEnrollTarget({ sequenceId: sequence.id, kind: 'lead', subjectId: '' })}
                className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"><UserPlus size={15} /></button>
              <button type="button" aria-label={sequence.is_active ? 'إيقاف التسلسل' : 'تشغيل التسلسل'}
                onClick={() => { void updateSequence(sequence.id, { is_active: sequence.is_active ? 0 : 1 }, 'تم تحديث حالة التسلسل'); }}
                className="rounded-lg p-2 text-amber-600 hover:bg-amber-50">
                {sequence.is_active ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button type="button" aria-label="عرض التفاصيل" onClick={() => setExpandedId(expanded ? null : sequence.id)}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</button>
              <button type="button" aria-label="أرشفة التسلسل" onClick={() => { void archiveSequence(sequence); }}
                className="rounded-lg p-2 text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
            </div>

            {enrollTarget?.sequenceId === sequence.id && (
              <div className="flex flex-wrap items-center gap-2 border-t border-blue-100 bg-blue-50 p-3">
                <select aria-label="نوع العميل" value={enrollTarget.kind}
                  onChange={event => setEnrollTarget(value => value && ({
                    ...value,
                    kind: event.target.value as 'lead' | 'subscriber',
                    subjectId: '',
                  }))} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
                  <option value="lead">Lead</option>
                  <option value="subscriber">عميل مشترك</option>
                </select>
                <select aria-label="العميل" value={enrollTarget.subjectId}
                  onChange={event => setEnrollTarget(value => value && ({ ...value, subjectId: event.target.value }))}
                  className="min-w-60 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs">
                  <option value="">اختر العميل</option>
                  {(enrollTarget.kind === 'lead' ? leads : subscribers).slice(0, 500).map(person => (
                    <option key={person.id} value={person.id}>{person.name} {person.email ? `— ${person.email}` : ''}</option>
                  ))}
                </select>
                <button type="button" onClick={() => { void enroll(); }}
                  className="rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white">تسجيل</button>
                <button type="button" aria-label="إغلاق التسجيل" onClick={() => setEnrollTarget(null)}
                  className="rounded-lg p-1.5 text-gray-500"><X size={14} /></button>
              </div>
            )}

            {expanded && (
              <div className="space-y-5 border-t border-gray-100 p-4">
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-gray-700">الخطوات</h4>
                  {sequence.steps.map((step, index) => (
                    <div key={`${sequence.id}-${index}`} className="flex items-start gap-3 rounded-xl bg-gray-50 p-3">
                      <Mail size={16} className="mt-0.5 text-blue-600" />
                      <div>
                        <div className="text-xs text-gray-500"><Clock size={11} className="inline" /> بعد {step.delay_days} يوم</div>
                        <strong className="text-sm text-gray-800">{step.subject}</strong>
                        <p className="line-clamp-2 text-xs text-gray-600">{step.body_html}</p>
                      </div>
                    </div>
                  ))}
                  {!sequence.steps.length && <p className="text-sm text-gray-400">لا توجد خطوات بعد.</p>}
                  <div className="grid gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 sm:grid-cols-4">
                    <input aria-label="التأخير بالأيام" type="number" min={0} max={365} value={stepDraft.delay_days}
                      onChange={event => setStepDraft(value => ({ ...value, delay_days: Number(event.target.value) }))}
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs" />
                    <input aria-label="عنوان الرسالة" value={stepDraft.subject}
                      onChange={event => setStepDraft(value => ({ ...value, subject: event.target.value }))}
                      placeholder="عنوان الرسالة" className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs sm:col-span-3" />
                    <textarea aria-label="نص الرسالة" value={stepDraft.body_html}
                      onChange={event => setStepDraft(value => ({ ...value, body_html: event.target.value }))}
                      placeholder="نص الرسالة" rows={2} className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs sm:col-span-4" />
                    <button type="button" onClick={() => { void addStep(sequence); }}
                      className="flex items-center justify-center gap-1 rounded-lg bg-fuchsia-700 px-3 py-1.5 text-xs font-bold text-white">
                      <Plus size={13} />حفظ كإصدار جديد
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-gray-700">التسجيلات</h4>
                  {sequenceEnrollments.slice(0, 50).map(row => (
                    <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 p-3 text-xs">
                      <span className="min-w-0 flex-1 truncate text-gray-700">{row.email}</span>
                      <span className="rounded-full bg-gray-100 px-2 py-1">{STATUS_LABEL[row.status]}</span>
                      <span className="text-gray-500">{row.executed_steps}/{sequence.steps.length} خطوة</span>
                      {row.status === 'active' && (
                        <button type="button" onClick={() => { void enrollmentAction(row, 'pause'); }}
                          className="rounded-lg p-1.5 text-amber-600 hover:bg-amber-50" title="إيقاف مؤقت"><Pause size={13} /></button>
                      )}
                      {row.status === 'paused' && (
                        <button type="button" onClick={() => { void enrollmentAction(row, 'resume'); }}
                          className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" title="استئناف"><Play size={13} /></button>
                      )}
                      {['active', 'paused'].includes(row.status) && (
                        <button type="button" onClick={() => { void enrollmentAction(row, 'unenroll'); }}
                          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" title="إلغاء التسجيل"><UserMinus size={13} /></button>
                      )}
                    </div>
                  ))}
                  {!sequenceEnrollments.length && <p className="text-sm text-gray-400">لا توجد تسجيلات.</p>}
                </div>
              </div>
            )}
          </section>
        );
      })}
      {!loading && !sequences.length && (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-gray-400">لا توجد تسلسلات متابعة.</div>
      )}
    </div>
  );
}
