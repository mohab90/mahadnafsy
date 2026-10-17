import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BriefcaseBusiness, GraduationCap, RefreshCw } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useCanDelete } from '../../../hooks/useCanDelete';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../constants/permissions';

// The job postings live here, not only under نظام HR: this is the page staff
// open to run recruitment, and "أضف وظيفة" was two menus away from the list of
// people applying for one.
const JobPostingsPanel = React.lazy(() => import('./JobPostingsPanel'));
const InterviewsTab = React.lazy(() => import('./InterviewsTab'));
import type { JoinUsApplication } from '../../../types';
import PromptModal from '../../../../shared/ui/PromptModal';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import type { CardActions } from './join-us/ApplicationCard';
import ApplicationsBoard from './join-us/ApplicationsBoard';
import FirstCallModal from './join-us/FirstCallModal';
import InterviewTimeModal from './join-us/InterviewTimeModal';
import { type Group, STATUS } from './join-us/joinUsUi';

type Toast = { type: 'success' | 'error' | 'info'; text: string };

/*
 * «في طلبات الانضمام في الموارد البشرية لازم تبقي عارف ان في طلبات انضمام موظف وفي
 * محاضر لازم تفرق بيينهم بشكل كبير ,,,في الفلتر والبحث خلي صفحه طلبات الانضمام
 * للمحاضر غير الموظفين» (12 Oct 2026).
 *
 * Two lists, each its own page with its own filters and search: a lecturer search
 * never reaches an employee. The list an application belongs on is the form it
 * came through (sourceForm), not a type that used to fall back to «محاضر».
 *
 * «قسم الموارد البشرية تقيل وخصوصا عند صفحه انضمام الموظفين والمحاضرين … خليهم
 * صفحتين مختلفين مش تاب … الصفحه تفتح 50 فقط ويظهر 2 جمب بعض» (17 Oct 2026).
 * Only the page being looked at is mounted (both lists used to stay drawn, one of
 * them hidden), and a list draws 50 cards, the rest on request.
 *
 * «لما نحدد انترفيو المفروض يتشال الموظف من صفحه طلبات الانضمام ويروح للانترفيو فقط».
 * The list is read with ?inbox=1: an application whose applicant is at interview or
 * offer is on the interviews screen, and not here.
 *
 * This page used to load every application into the shared store (up to 20 requests
 * of 1000 rows, twice on opening) and sift them in the browser. The board now asks
 * the database for the 50 it draws (join-us/ApplicationsBoard.tsx).
 */
const GROUPS: Record<Group, { title: string; short: string; Icon: typeof GraduationCap; header: string }> = {
  teaching: { title: 'طلبات انضمام المحاضرين', short: 'المحاضرين والاستشاريين', Icon: GraduationCap, header: 'bg-violet-700' },
  staff: { title: 'طلبات انضمام الموظفين', short: 'الموظفين', Icon: BriefcaseBusiness, header: 'bg-emerald-700' },
};

export default function JoinUsAdminTab({ group }: { group: Group }) {
  const { updateJoinUsApplication, deleteJoinUsApplication, isAdmin, currentStaff } = useSiteData();
  const [toast, setToast] = useState<Toast | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Bumped after anything changed, so the board reads its list again.
  const [version, setVersion] = useState(0);
  // The lecturers' page has two views: the applications and the lecturers' interviews.
  const [view, setView] = useState<'applications' | 'interviews'>('applications');
  const [firstCallFor, setFirstCallFor] = useState<JoinUsApplication | null>(null);
  const [interviewFor, setInterviewFor] = useState<{ app: JoinUsApplication; mode: 'move' | 'accept' } | null>(null);
  const [prompt, setPrompt] = useState<{
    title: string; label: string; hint?: string; placeholder?: string;
    initialValue?: string; confirmLabel?: string; multiline?: boolean; required?: boolean;
    run: (value: string) => Promise<void> | void;
  } | null>(null);

  const staff = currentStaff ? { role: currentStaff.role as RoleKey, permissions: currentStaff.permissions as PermissionKey[] | undefined } : null;
  // A branch manager works their branch's applications (the API narrows the
  // list); deleting one and publishing postings stay with HR.
  const branchOnly = ['daqqi_manager', 'tagamoa_manager'].includes(String(currentStaff?.role || '').toLowerCase());
  // «الحذف لمهاب ووليد وحازم بس» (12 Oct 2026): on top of the join-us permission.
  const mayDelete = useCanDelete();
  const canDelete = mayDelete && (isAdmin || hasPermission(staff, 'manage_join_us'));

  // How many there are, counted by the database over the whole list (this page's scope), by status.
  const [counts, setCounts] = useState<Awaited<ReturnType<typeof mysqlAdmin.joinUsInboxCounts>> | null>(null);
  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.joinUsInboxCounts(group).then(result => { if (!cancelled) setCounts(result); }).catch(() => { if (!cancelled) setCounts(null); });
    return () => { cancelled = true; };
  }, [group, version]);
  const refresh = () => {
    setRefreshing(true);
    setVersion(current => current + 1);
    window.setTimeout(() => setRefreshing(false), 600);
  };

  const notify = useMemo(() => (type: Toast['type'], text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(current => (current?.text === text ? null : current)), 4500);
  }, []);

  const byStatus = counts?.byFormStatus[group] || {};
  const allCount = Object.values(byStatus).reduce((sum, count) => sum + (Number(count) || 0), 0);
  const newCount = Number(byStatus.NEW) || 0;
  const { Icon } = GROUPS[group];

  const run = async (app: JoinUsApplication, work: () => Promise<string>, failure: string) => {
    setBusyId(app.id);
    try {
      const done = await work();
      notify('success', done);
      setPrompt(null); setFirstCallFor(null); setInterviewFor(null);
      setVersion(current => current + 1);
    } catch (error) {
      notify('error', `${failure}${error instanceof Error && error.message ? ` — ${error.message}` : ''}`);
    } finally { setBusyId(null); }
  };

  const actionsNow: CardActions = {
    onContact: app => setPrompt({
      title: `تسجيل تواصل — ${app.name}`,
      label: 'اتكلمتوا في إيه؟ (اختياري)',
      hint: 'هيتسجّل الوقت واسمك في سجل الطلب، والحالة هتبقى «تم التواصل».',
      placeholder: 'مثال: كلمته وطلب نكلمه تاني بكرة الساعة 5',
      confirmLabel: 'تسجيل التواصل',
      multiline: true,
      run: note => run(app, async () => {
        const result = await mysqlAdmin.contactJoinUs(app.id, note.trim() || undefined);
        return `اتسجّل التواصل مع ${app.name} — بواسطة ${result.contactedBy}`;
      }, 'تعذّر تسجيل التواصل'),
    }),
    onFirstCall: app => setFirstCallFor(app),
    onMoveToInterview: app => setInterviewFor({ app, mode: 'move' }),
    onAccept: app => setInterviewFor({ app, mode: 'accept' }),
    onReject: app => setPrompt({
      title: `رفض ${app.name}`,
      label: 'سبب الرفض (اختياري)',
      confirmLabel: 'تأكيد الرفض',
      multiline: true,
      run: note => run(app, async () => {
        await mysqlAdmin.evaluateJoinUs(app.id, { decision: 'REJECTED', body: note.trim() || undefined });
        return `اترفض ${app.name}`;
      }, 'تعذّر حفظ الرفض'),
    }),
    onNote: app => setPrompt({
      title: `ملاحظة HR — ${app.name}`,
      label: 'ملاحظة فريق الموارد البشرية',
      initialValue: app.adminNote || '',
      confirmLabel: 'حفظ الملاحظة',
      multiline: true,
      run: note => run(app, async () => {
        const ok = await updateJoinUsApplication({ ...app, adminNote: note.trim() || undefined });
        if (!ok) throw new Error('');
        return 'اتحفظت الملاحظة';
      }, 'تعذّر حفظ الملاحظة'),
    }),
    onStatus: (app, next) => {
      void run(app, async () => {
        const ok = await updateJoinUsApplication({ ...app, status: next });
        if (!ok) throw new Error('');
        return `${app.name}: ${STATUS[next].label}`;
      }, 'تعذّر تغيير الحالة');
    },
    onDelete: canDelete ? async app => {
      if (!await confirmDialog(app.convertedApplicantId
        ? 'الطلب ده مرتبط بمسار التوظيف — المتقدم هيفضل في المسار، والطلب نفسه هيتمسح. تكمل؟'
        : 'حذف الطلب نهائيًا؟')) return;
      await run(app, async () => {
        await deleteJoinUsApplication(app.id);
        return `اتمسح طلب ${app.name}`;
      }, `تعذّر حذف طلب ${app.name}`);
    } : undefined,
  };

  // The cards are memoised, so they get handlers that keep their identity;
  // these call whatever the current render built.
  const latest = useRef(actionsNow);
  latest.current = actionsNow;
  const actions = useMemo<CardActions>(() => ({
    onContact: app => latest.current.onContact(app),
    onFirstCall: app => latest.current.onFirstCall(app),
    onMoveToInterview: app => latest.current.onMoveToInterview(app),
    onAccept: app => latest.current.onAccept(app),
    onReject: app => latest.current.onReject(app),
    onNote: app => latest.current.onNote(app),
    onStatus: (app, next) => latest.current.onStatus(app, next),
    onDelete: canDelete ? app => latest.current.onDelete?.(app) : undefined,
  }), [canDelete]);

  const submitInterview = (interviewAt: string | undefined) => {
    if (!interviewFor) return;
    const { app, mode } = interviewFor;
    void run(app, async () => {
      if (mode === 'accept') {
        await mysqlAdmin.evaluateJoinUs(app.id, { decision: 'ACCEPTED', interviewAt });
      } else {
        await mysqlAdmin.moveJoinUsToInterview(app.id, interviewAt);
      }
      return interviewAt
        ? `${app.name} راح لتاب الانترفيوهات تحت «لسه موعده» — الميعاد ${interviewAt}`
        : `${app.name} اتقبل واتنقل للانترفيوهات — من غير ميعاد لسه`;
    }, `تعذّر نقل ${app.name} للانترفيو`);
  };

  return (
    <div className="space-y-4" dir="rtl">
      {prompt && (
        <PromptModal
          title={prompt.title} label={prompt.label} hint={prompt.hint} placeholder={prompt.placeholder}
          initialValue={prompt.initialValue} confirmLabel={prompt.confirmLabel} multiline={prompt.multiline}
          required={prompt.required} busy={busyId !== null}
          onSubmit={value => { void prompt.run(value); }}
          onCancel={() => setPrompt(null)}
        />
      )}
      {firstCallFor && (
        <FirstCallModal app={firstCallFor} busy={busyId === firstCallFor.id}
          onCancel={() => setFirstCallFor(null)}
          onSubmit={value => {
            const app = firstCallFor;
            void run(app, async () => {
              await mysqlAdmin.firstCallJoinUs(app.id, value);
              return `اتسجّل تقييم أول مكالمة لـ ${app.name}: ${value.rating}/5`;
            }, 'تعذّر حفظ التقييم');
          }} />
      )}
      {interviewFor && (
        <InterviewTimeModal
          title={interviewFor.mode === 'accept' ? `قبول ${interviewFor.app.name}` : `نقل ${interviewFor.app.name} للانترفيو`}
          hint={interviewFor.mode === 'accept'
            ? (group === 'teaching' ? 'القبول بينقله لتاب الانترفيوهات — حدد الميعاد لو اتفقتوا عليه' : 'القبول بينقله لصفحة انترفيوهات الموظفين — حدد الميعاد لو اتفقتوا عليه')
            : group === 'teaching' ? 'هيتشال من هنا ويظهر في تاب «الانترفيوهات» هنا تحت «لسه موعده»' : 'هيتشال من هنا ويظهر في صفحة انترفيوهات الموظفين تحت «لسه موعده»'}
          confirmLabel={interviewFor.mode === 'accept' ? 'قبول وتحديد الميعاد' : 'تحديد ونقل للانترفيو'}
          initialValue={interviewFor.app.interviewAt}
          allowUndated={interviewFor.mode === 'accept'}
          busy={busyId === interviewFor.app.id}
          onSubmit={submitInterview}
          onCancel={() => setInterviewFor(null)}
        />
      )}
      {toast && (
        <div role="status" className={`sticky top-2 z-10 rounded-xl px-4 py-2.5 text-sm font-bold shadow-sm ${
          toast.type === 'error' ? 'border border-red-200 bg-red-50 text-red-700'
            : toast.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-sky-200 bg-sky-50 text-sky-700'}`}
        >
          {toast.text}
        </div>
      )}

      <section className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-white ${GROUPS[group].header}`}>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-black"><Icon size={20} /> {GROUPS[group].title}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-white/80">
            {branchOnly && <span>طلبات فرعك بس.</span>}
            <span className="rounded-full bg-white/20 px-2 py-0.5 font-bold text-white">
              {allCount.toLocaleString('ar-EG-u-nu-latn')} طلب
            </span>
            {newCount > 0 && <span className="rounded-full bg-white px-2 py-0.5 font-bold text-gray-900">{newCount.toLocaleString('ar-EG-u-nu-latn')} جديد</span>}
          </p>
        </div>
        {view === 'applications' && (
          <button onClick={refresh} disabled={refreshing}
            className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25 disabled:opacity-60">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> تحديث
          </button>
        )}
      </section>

      {/* The lecturers' page has the lecturers' interviews as a tab: one who is moved to an interview leaves
          the applications and is found here. */}
      {group === 'teaching' && (
        <div role="tablist" className="flex gap-1 rounded-2xl border border-gray-200 bg-white p-1">
          {([['applications', 'الطلبات'], ['interviews', 'الانترفيوهات']] as const).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)}
              className={`flex-1 rounded-xl px-3 py-1.5 text-sm font-black transition ${view === key ? 'bg-violet-600 text-white' : 'text-gray-600 hover:bg-violet-50'}`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {view === 'interviews' && group === 'teaching' ? (
        <React.Suspense fallback={<div className="rounded-2xl border border-gray-100 bg-white py-8 text-center text-sm text-gray-400">جاري تحميل الانترفيوهات...</div>}>
          <InterviewsTab notify={notify} group="teaching" embedded />
        </React.Suspense>
      ) : (
        <>
          {/* The postings themselves — publish one, see who applied, close it. */}
          {group === 'staff' && !branchOnly && (
            <React.Suspense fallback={<div className="rounded-2xl border border-gray-100 bg-white py-8 text-center text-sm text-gray-400">جاري تحميل الوظائف...</div>}>
              <JobPostingsPanel notify={notify} />
            </React.Suspense>
          )}
          <ApplicationsBoard key={group} group={group} version={version} counts={counts} busyId={busyId} actions={actions} notify={notify} />
        </>
      )}
    </div>
  );
}
