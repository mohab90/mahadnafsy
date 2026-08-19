import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarCheck, GraduationCap, Mail, Phone, RefreshCw, Trash2 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import type { JoinUsApplication } from '../../../types';
import PromptModal from '../../../components/shared/PromptModal';

type Status = 'new' | 'reviewed' | 'accepted' | 'rejected';
type Kind = 'instructor' | 'consultant' | 'staff';
type Group = 'teaching' | 'staff';

const STATUS: Record<Status, { label: string; className: string }> = {
  new: { label: 'جديد', className: 'bg-blue-100 text-blue-700' },
  reviewed: { label: 'قيد المراجعة', className: 'bg-amber-100 text-amber-700' },
  accepted: { label: 'مقبول', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'مرفوض', className: 'bg-red-100 text-red-700' },
};
const KIND_LABEL: Record<Kind, string> = { instructor: 'محاضر', consultant: 'استشاري', staff: 'موظف' };
const STAGE_LABEL: Record<string, string> = {
  applied: 'تم الاستلام', screening: 'فرز أولي', interview: 'مقابلة',
  offer: 'عرض وظيفي', hired: 'تم التعيين', rejected: 'مرفوض',
};

function statusOf(value?: string): Status {
  const status = String(value || '').toLowerCase();
  if (status === 'accepted' || status === 'rejected' || status === 'reviewed') return status;
  if (['pending', 'in_progress', 'read'].includes(status)) return 'reviewed';
  if (['approved', 'done'].includes(status)) return 'accepted';
  return 'new';
}

function kindOf(value?: string): Kind {
  const kind = String(value || '').toLowerCase();
  if (['consultant', 'consultation', 'therapist', 'advisor'].includes(kind)) return 'consultant';
  if (['staff', 'employee', 'hr', 'admin', 'ops', 'support'].includes(kind)) return 'staff';
  return 'instructor';
}

export default function JoinUsAdminTab({ initialType = 'all' }: { initialType?: Kind | 'all' }) {
  const { joinUsApplications, updateJoinUsApplication, deleteJoinUsApplication, reloadJoinUsApplications } = useSiteData();
  // Staff-first by default: the owner asked for الموظفون to be the first and
  // default group, so only an explicit instructor/consultant entry point
  // (initialType) opens on the teaching side.
  const [group, setGroup] = useState<Group>(
    initialType === 'instructor' || initialType === 'consultant' ? 'teaching' : 'staff',
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [kind, setKind] = useState<Kind | 'all'>(initialType);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // This page is rendered without a notify prop, so every outcome it reported
  // went nowhere. It says them itself.
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  // Which dialog is open, and what it does on confirm. One slot because only
  // one of these can be answered at a time.
  const [prompt, setPrompt] = useState<{
    title: string; label: string; hint?: string; placeholder?: string;
    confirmLabel: string; multiline?: boolean; required?: boolean;
    initialValue?: string;
    validate?: (value: string) => string | null;
    run: (value: string) => void;
  } | null>(null);

  // The tab's own data can be minutes stale — the shared bootstrap loads it
  // once at login and only otherwise refreshes on a 2-minute background timer
  // — so a submission made just now (from another browser, e.g. an applicant
  // on the public site) wouldn't show without this. Refresh whenever staff
  // actually open the tab, not just on the wider app's schedule.
  useEffect(() => { void reloadJoinUsApplications(); }, [reloadJoinUsApplications]);
  const refresh = async () => {
    setRefreshing(true);
    try { await reloadJoinUsApplications(); } finally { setRefreshing(false); }
  };

  const groupOf = (app: JoinUsApplication): Group => kindOf(app.type) === 'staff' ? 'staff' : 'teaching';
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return joinUsApplications
      .filter(app => groupOf(app) === group)
      .filter(app => kind === 'all' || kindOf(app.type) === kind)
      .filter(app => status === 'all' || statusOf(app.status) === status)
      .filter(app => !query || [app.name, app.email, app.phone, app.specialty].some(value => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }, [group, joinUsApplications, kind, search, status]);

  const changeStatus = async (app: JoinUsApplication, next: Status) =>
    updateJoinUsApplication({ ...app, status: next });

  const openNote = (app: JoinUsApplication) => setPrompt({
    title: `ملاحظة HR — ${app.name}`,
    label: 'الملاحظة',
    initialValue: app.adminNote || '',
    confirmLabel: 'حفظ الملاحظة',
    multiline: true,
    run: async note => {
      setBusyId(app.id);
      const ok = await updateJoinUsApplication({ ...app, adminNote: note || undefined });
      setBusyId(null);
      setPrompt(null);
      setFeedback(ok === false
        ? { tone: 'err', text: `تعذّر حفظ ملاحظة ${app.name}` }
        : { tone: 'ok', text: `تم حفظ ملاحظة ${app.name}` });
    },
  });

  const openContact = (app: JoinUsApplication) => setPrompt({
    title: `تسجيل تواصل — ${app.name}`,
    label: 'ملاحظة عن المكالمة (اختياري)',
    hint: 'هيتسجّل تاريخ التواصل واسمك، وبعدها تقدر تسجّل قرار القبول أو الرفض.',
    placeholder: 'مثال: اتصلت وطلب معاودة الاتصال بكرة',
    confirmLabel: 'تسجيل التواصل',
    multiline: true,
    run: note => markContacted(app, note),
  });

  const openEvaluate = (app: JoinUsApplication, decision: 'ACCEPTED' | 'REJECTED', withDate: boolean) => {
    if (withDate) {
      setPrompt({
        title: `قبول ${app.name} وتحديد موعد`,
        label: 'موعد المقابلة',
        hint: 'الصيغة: YYYY-MM-DD HH:MM — مثال 2026-09-01 11:30',
        placeholder: '2026-09-01 11:30',
        confirmLabel: 'قبول وتحديد الموعد',
        required: true,
        // Checked here so a bad date never leaves the dialog — the field stays
        // open with the reason instead of the row silently not changing.
        validate: value => (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(value)
          ? null : 'الصيغة لازم تكون YYYY-MM-DD HH:MM'),
        run: interviewAt => evaluate(app, 'ACCEPTED', interviewAt, ''),
      });
      return;
    }
    setPrompt({
      title: decision === 'REJECTED' ? `رفض ${app.name}` : `قبول ${app.name} بدون موعد`,
      label: 'سبب القرار (اختياري)',
      confirmLabel: decision === 'REJECTED' ? 'تأكيد الرفض' : 'تأكيد القبول',
      multiline: true,
      run: note => evaluate(app, decision, undefined, note),
    });
  };

  // Reports the outcome. deleteJoinUsApplication returns false on failure and
  // this ignored it, so a delete that the API refused looked identical to one
  // that worked: the row stayed and nothing was said. That is the whole of
  // "the delete button doesn't work".
  const remove = async (app: JoinUsApplication) => {
    if (app.convertedApplicantId) return;
    if (!window.confirm('حذف الطلب غير المرتبط بمسار التوظيف نهائيًا؟')) return;
    setBusyId(app.id);
    const ok = await deleteJoinUsApplication(app.id);
    setBusyId(null);
    setFeedback(ok
      ? { tone: 'ok', text: `تم حذف طلب ${app.name}` }
      : { tone: 'err', text: `تعذّر حذف طلب ${app.name} — راجع صلاحياتك أو حالة الطلب` });
  };

  const markContacted = async (app: JoinUsApplication, note: string) => {
    setBusyId(app.id);
    try {
      const result = await mysqlAdmin.contactJoinUs(app.id, note || undefined);
      setFeedback({ tone: 'ok', text: `تم تسجيل التواصل مع ${app.name} — بواسطة ${result.contactedBy}` });
      setPrompt(null);
      await reloadJoinUsApplications();
    } catch (error) {
      setFeedback({ tone: 'err', text: error instanceof Error ? error.message : 'تعذّر تسجيل التواصل' });
    } finally { setBusyId(null); }
  };

  // One call for all three outcomes — رفض، قبول بموعد، قبول بدون موعد — because
  // they are one decision made after the same phone call.
  const evaluate = async (
    app: JoinUsApplication,
    decision: 'ACCEPTED' | 'REJECTED',
    interviewAt: string | undefined,
    note: string,
  ) => {
    setBusyId(app.id);
    try {
      await mysqlAdmin.evaluateJoinUs(app.id, { decision, interviewAt, body: note || undefined });
      setFeedback({
        tone: 'ok',
        text: decision === 'REJECTED' ? `تم رفض ${app.name}`
          : interviewAt ? `تم قبول ${app.name} — موعد المقابلة ${interviewAt}`
            : `تم قبول ${app.name} — لم يتحدد موعد بعد`,
      });
      setPrompt(null);
      await reloadJoinUsApplications();
    } catch (error) {
      setFeedback({ tone: 'err', text: error instanceof Error ? error.message : 'تعذّر حفظ القرار' });
    } finally { setBusyId(null); }
  };

  const [justMoved, setJustMoved] = useState<Set<string>>(new Set());
  const moveToInterview = async (app: JoinUsApplication) => {
    setMovingId(app.id);
    try {
      await mysqlAdmin.moveJoinUsToInterview(app.id);
      setJustMoved(prev => new Set(prev).add(app.id));
      // The conversion happens through a dedicated pipeline endpoint, not the
      // generic join-us update this tab otherwise uses — updateJoinUsApplication
      // would try to PUT server-controlled fields (convertedApplicantId) back
      // through a route that doesn't accept them. justMoved is enough to
      // confirm success inline; the full "داخل HR: مقابلة" badge picks up
      // the real state next time this page's data source refreshes.
    } catch (error) {
      window.dispatchEvent(new CustomEvent('site-persist-error', {
        detail: { field: 'join-us-to-interview', name: error instanceof Error ? error.message : app.id },
      }));
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {prompt && (
        <PromptModal
          title={prompt.title}
          label={prompt.label}
          hint={prompt.hint}
          placeholder={prompt.placeholder}
          initialValue={prompt.initialValue}
          confirmLabel={prompt.confirmLabel}
          multiline={prompt.multiline}
          required={prompt.required}
          validate={prompt.validate}
          busy={busyId !== null}
          onSubmit={prompt.run}
          onCancel={() => setPrompt(null)}
        />
      )}
      {feedback && (
        <div role="status"
          className={`flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-bold ${
            feedback.tone === 'ok'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'}`}>
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="shrink-0 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      <section className="rounded-2xl bg-gradient-to-l from-indigo-700 to-violet-600 p-6 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-black"><GraduationCap /> طلبات الانضمام</h2>
            <p className="mt-1 text-sm text-indigo-100">كل طلب موقع يدخل تلقائيًا لمسار التوظيف ويظل مرتبطًا حتى التعيين.</p>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex shrink-0 items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-bold hover:bg-white/25 transition disabled:opacity-60"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            تحديث
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(STATUS) as Status[]).map(key => (
            <span key={key} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold">
              {STATUS[key].label}: {joinUsApplications.filter(app => statusOf(app.status) === key).length}
            </span>
          ))}
        </div>
      </section>

      <div className="flex gap-2 border-b border-gray-200">
        {([
          ['staff', 'الموظفون', BriefcaseBusiness],
          ['teaching', 'المحاضرون والاستشاريون', GraduationCap],
        ] as const).map(([key, label, Icon]) => (
          <button key={key} onClick={() => { setGroup(key); setKind('all'); }}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-bold ${group === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <input value={search} onChange={event => setSearch(event.target.value)}
          placeholder="بحث بالاسم أو البريد أو الهاتف أو التخصص"
          className="min-w-56 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        {group === 'teaching' && (
          <select value={kind} onChange={event => setKind(event.target.value as Kind | 'all')} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
            <option value="all">كل التخصصات</option><option value="instructor">محاضر</option><option value="consultant">استشاري</option>
          </select>
        )}
        <select value={status} onChange={event => setStatus(event.target.value as Status | 'all')} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
          <option value="all">كل الحالات</option>
          {(Object.keys(STATUS) as Status[]).map(key => <option key={key} value={key}>{STATUS[key].label}</option>)}
        </select>
      </div>

      {rows.length === 0 ? <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center text-gray-400">لا توجد طلبات مطابقة.</div> : (
        <div className="space-y-3">
          {rows.map(app => {
            const appStatus = statusOf(app.status);
            return (
              <article key={app.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${STATUS[appStatus].className}`}>{STATUS[appStatus].label}</span>
                      <span className="rounded-lg bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{KIND_LABEL[kindOf(app.type)]}</span>
                      {app.convertedApplicantId && <span className="rounded-lg bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">داخل HR: {STAGE_LABEL[app.applicantStage || 'applied'] || app.applicantStage}</span>}
                      {!app.convertedApplicantId && justMoved.has(app.id) && <span className="rounded-lg bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">✓ نُقل للمقابلات</span>}
                      {app.hiredStaffId && <span className="rounded-lg bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">موظف مرتبط</span>}
                    </div>
                    <h3 className="text-lg font-bold text-gray-900">{app.name}</h3>
                    <p className="text-sm text-gray-600">{app.specialty}</p>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
                      <span className="flex items-center gap-1"><Mail size={13} /> {app.email}</span>
                      <span className="flex items-center gap-1"><Phone size={13} /> {app.phone}</span>
                      <span>{app.createdAt?.slice(0, 10)}</span>
                    </div>
                    {app.message && <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">{app.message}</p>}
                    {app.adminNote && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">ملاحظة HR: {app.adminNote}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <select value={appStatus} onChange={event => changeStatus(app, event.target.value as Status)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold">
                      {(Object.keys(STATUS) as Status[]).map(key => <option key={key} value={key}>{STATUS[key].label}</option>)}
                    </select>
                    <button onClick={() => openNote(app)} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">ملاحظة HR</button>

                    <button disabled={busyId === app.id} onClick={() => openContact(app)}
                      title={app.contactedAt ? `آخر تواصل: ${app.contactedAt}` : 'تسجيل أنه تم الاتصال بالمتقدم'}
                      className="flex items-center justify-center gap-1 rounded-xl bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 disabled:opacity-40">
                      <Phone size={13} /> {app.contactedAt ? 'تواصل مرة أخرى' : 'تواصل'}
                    </button>

                    {/* The decision only makes sense after the call, so it stays
                        hidden until one is recorded. */}
                    {app.contactedAt && (
                      <div className="grid grid-cols-1 gap-1.5 rounded-xl bg-gray-50 p-1.5">
                        <span className="px-1 text-[10px] font-bold text-gray-500">التقييم بعد التواصل</span>
                        <button disabled={busyId === app.id} onClick={() => openEvaluate(app, 'ACCEPTED', true)}
                          className="rounded-lg bg-emerald-600 px-2 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-40">
                          مقبول + تحديد موعد
                        </button>
                        <button disabled={busyId === app.id} onClick={() => openEvaluate(app, 'ACCEPTED', false)}
                          className="rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
                          مقبول بدون موعد
                        </button>
                        <button disabled={busyId === app.id} onClick={() => openEvaluate(app, 'REJECTED', false)}
                          className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:opacity-40">
                          مرفوض
                        </button>
                      </div>
                    )}
                    {!app.convertedApplicantId && !justMoved.has(app.id) && (
                      <button
                        disabled={movingId === app.id}
                        onClick={() => moveToInterview(app)}
                        title="ينقله لقسم الانترفيوهات لتقييم المقابلة"
                        className="flex items-center justify-center gap-1 rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40"
                      >
                        <CalendarCheck size={13} /> {movingId === app.id ? 'جارٍ النقل...' : 'نقل للمقابلات'}
                      </button>
                    )}
                    <button disabled={Boolean(app.convertedApplicantId)} onClick={() => remove(app)}
                      title={app.convertedApplicantId ? 'الطلب جزء من سجل التوظيف ولا يمكن حذفه' : undefined}
                      className="flex items-center justify-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
                      <Trash2 size={13} /> حذف
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
}
