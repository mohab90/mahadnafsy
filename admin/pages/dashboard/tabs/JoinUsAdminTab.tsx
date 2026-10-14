import React, { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Filter, GraduationCap, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { useCanDelete } from '../../../hooks/useCanDelete';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { hasPermission, type PermissionKey, type RoleKey } from '../../../constants/permissions';

// The job postings live here, not only under نظام HR: this is the page staff
// open to run recruitment, and "أضف وظيفة" was two menus away from the list of
// people applying for one.
const JobPostingsPanel = React.lazy(() => import('./JobPostingsPanel'));
import type { JoinUsApplication } from '../../../types';
import PromptModal from '../../../../shared/ui/PromptModal';
import {
  EXPERIENCE_ORDER, EXPERIENCE_YEARS, branchLabel, matchesMinExperience,
} from './hr-sections/applicantLabels';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import ApplicationCard, { type CardActions, jobLabel } from './join-us/ApplicationCard';
import FirstCallModal from './join-us/FirstCallModal';
import InterviewTimeModal from './join-us/InterviewTimeModal';
import { type Group, type Kind, STATUS, type Status, groupOf, kindOf, statusOf } from './join-us/joinUsUi';

type Toast = { type: 'success' | 'error' | 'info'; text: string };

/*
 * «في طلبات الانضمام في الموارد البشرية لازم تبقي عارف ان في طلبات انضمام موظف وفي
 * محاضر لازم تفرق بيينهم بشكل كبير ,,,في الفلتر والبحث خلي صفحه طلبات الانضمام
 * للمحاضر غير الموظفين» (12 Oct 2026).
 *
 * Two lists, each its own page with its own filters and search: a lecturer search
 * never reaches an employee, and a filter set on one list is still there when you
 * come back to it. The list an application belongs on is the form it came
 * through (sourceForm), not a type that used to fall back to «محاضر».
 */
const GROUPS: Record<Group, { title: string; short: string; Icon: typeof GraduationCap; tab: string; ring: string }> = {
  teaching: { title: 'طلبات انضمام المحاضرين', short: 'المحاضرين والاستشاريين', Icon: GraduationCap, tab: 'bg-violet-600 text-white shadow-violet-200', ring: 'text-violet-700 hover:bg-violet-50' },
  staff: { title: 'طلبات انضمام الموظفين', short: 'الموظفين', Icon: BriefcaseBusiness, tab: 'bg-emerald-600 text-white shadow-emerald-200', ring: 'text-emerald-700 hover:bg-emerald-50' },
};

type BoardProps = {
  group: Group;
  apps: JoinUsApplication[];
  busyId: string | null;
  justMoved: Set<string>;
  actions: CardActions;
};

/** One list — the lecturers' or the employees' — with filters of its own. */
function ApplicationsBoard({ group, apps, busyId, justMoved, actions }: BoardProps) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [minExperience, setMinExperience] = useState('');
  const [branch, setBranch] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [jobFilter, setJobFilter] = useState('');
  const [program, setProgram] = useState('');
  const [lectured, setLectured] = useState<'' | 'yes' | 'no'>('');
  const [sessions, setSessions] = useState<'' | 'yes' | 'no'>('');

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesYesNo = (value: boolean | null | undefined, wanted: '' | 'yes' | 'no') =>
      !wanted || (wanted === 'yes' ? value === true : value === false);
    return apps
      .filter(app => kind === 'all' || kindOf(app) === kind)
      .filter(app => status === 'all' || statusOf(app.status) === status)
      .filter(app => matchesMinExperience(app.experienceYears, minExperience))
      .filter(app => !branch || app.applicantBranch === branch)
      .filter(app => !jobFilter || app.jobId === jobFilter)
      .filter(app => !program || (app.programs || []).some(p => p.title === program))
      .filter(app => matchesYesNo(app.lecturedBefore, lectured) && matchesYesNo(app.sessionsBefore, sessions))
      .filter(app => !query || [app.name, app.email, app.phone, app.specialty, app.programsOther,
        ...(app.programs || []).map(p => p.title)].some(value => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    // Every value the filters read is listed: one left out kept the memo from
    // recomputing, so the dropdown changed and the list did not.
  }, [apps, kind, status, minExperience, branch, jobFilter, program, lectured, sessions, search]);

  const jobOptions = useMemo(() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    apps.forEach(app => {
      if (!app.jobId) return;
      const entry = map.get(app.jobId);
      if (entry) entry.count += 1;
      else map.set(app.jobId, { id: app.jobId, title: jobLabel(app), count: 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [apps]);
  const branchOptions = useMemo(
    () => [...new Set(apps.map(app => app.applicantBranch).filter(Boolean))] as string[], [apps]);
  const programOptions = useMemo(() => {
    const counts = new Map<string, number>();
    apps.forEach(app => (app.programs || []).forEach(p => counts.set(p.title, (counts.get(p.title) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [apps]);
  const statusCounts = useMemo(() => {
    const counts = {} as Record<Status, number>;
    (Object.keys(STATUS) as Status[]).forEach(key => { counts[key] = 0; });
    apps.forEach(app => { counts[statusOf(app.status)] += 1; });
    return counts;
  }, [apps]);

  const filtersActive = Boolean(search.trim() || jobFilter || branch || minExperience || program || lectured || sessions)
    || status !== 'all' || kind !== 'all';
  const reset = () => {
    setSearch(''); setStatus('all'); setMinExperience(''); setBranch(''); setJobFilter('');
    setKind('all'); setProgram(''); setLectured(''); setSessions('');
  };
  const field = 'w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs';
  const teaching = group === 'teaching';

  return (
    <div className="space-y-3">
      {/* Status at a glance — each chip is also the status filter. */}
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setStatus('all')}
          className={`rounded-full px-3 py-1 text-xs font-bold ${status === 'all' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'}`}>
          الكل {apps.length}
        </button>
        {(Object.keys(STATUS) as Status[]).map(key => (
          <button key={key} onClick={() => setStatus(status === key ? 'all' : key)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${status === key ? `${STATUS[key].className} ring-2 ring-gray-300 ring-offset-1` : 'bg-white text-gray-600 ring-1 ring-gray-200'}`}>
            {STATUS[key].label} {statusCounts[key]}
          </button>
        ))}
      </div>

      <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600">
          <Filter size={14} className={teaching ? 'text-violet-600' : 'text-emerald-600'} /> فلترة {GROUPS[group].title}
          {filtersActive && (
            <button onClick={reset}
              className="mr-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-500 hover:bg-gray-100">
              <RotateCcw size={11} /> إلغاء الفلاتر
            </button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">بحث في {GROUPS[group].short}</span>
            <span className="relative block">
              <Search size={13} className="absolute right-2.5 top-2 text-gray-400" />
              <input value={search} onChange={event => setSearch(event.target.value)}
                placeholder={teaching ? 'اسم، تليفون، تخصص، برنامج' : 'اسم، تليفون، إيميل، تخصص'}
                className={`${field} pr-8`} />
            </span>
          </label>
          {teaching ? (
            <>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-500">النوع</span>
                <select value={kind} onChange={event => setKind(event.target.value as Kind | 'all')} className={field}>
                  <option value="all">محاضرين واستشاريين</option>
                  <option value="instructor">محاضر</option>
                  <option value="consultant">استشاري</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-500">البرنامج</span>
                <select value={program} onChange={event => setProgram(event.target.value)} className={field}>
                  <option value="">كل البرامج</option>
                  {programOptions.map(([title, count]) => <option key={title} value={title}>{title} ({count})</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-500">اشتغل محاضر قبل كده؟</span>
                <select value={lectured} onChange={event => setLectured(event.target.value as '' | 'yes' | 'no')} className={field}>
                  <option value="">الكل</option><option value="yes">آه</option><option value="no">لأ</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold text-gray-500">جلسات نفسية مع عملاء؟</span>
                <select value={sessions} onChange={event => setSessions(event.target.value as '' | 'yes' | 'no')} className={field}>
                  <option value="">الكل</option><option value="yes">آه</option><option value="no">لأ</option>
                </select>
              </label>
            </>
          ) : (
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold text-gray-500">الوظيفة</span>
              <select value={jobFilter} onChange={event => setJobFilter(event.target.value)} className={field}>
                <option value="">كل الوظائف</option>
                {jobOptions.map(j => <option key={j.id} value={j.id}>{j.title} ({j.count})</option>)}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">الفرع</span>
            <select value={branch} onChange={event => setBranch(event.target.value)} className={field}>
              <option value="">كل الفروع</option>
              {branchOptions.map(key => <option key={key} value={key}>{branchLabel(key)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">الخبرة (حد أدنى)</span>
            <select value={minExperience} onChange={event => setMinExperience(event.target.value)} className={field}>
              <option value="">أي خبرة</option>
              <option value="only_none">بدون خبرة فقط</option>
              {EXPERIENCE_ORDER.filter(key => key !== 'none').map(key => (
                <option key={key} value={key}>{EXPERIENCE_YEARS[key]} فأكثر</option>
              ))}
            </select>
          </label>
        </div>
        {filtersActive && <p className="text-[11px] font-bold text-gray-500">ظاهر {rows.length} طلب من {apps.length}</p>}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
          {apps.length === 0 ? `مفيش ${GROUPS[group].title} لسه.` : 'مفيش طلبات مطابقة للفلاتر.'}
        </div>
      ) : (
        <div className="grid gap-3 2xl:grid-cols-2">
          {rows.map(app => (
            <ApplicationCard key={app.id} app={app} busy={busyId === app.id} moved={justMoved.has(app.id)} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function JoinUsAdminTab({ initialType = 'all' }: { initialType?: Kind | 'all' }) {
  const {
    joinUsApplications, updateJoinUsApplication, deleteJoinUsApplication, reloadJoinUsApplications,
    isAdmin, currentStaff,
  } = useSiteData();
  // Staff-first by default (the owner asked for الموظفون to be the default group);
  // the lecturers' entry point opens on its own list.
  const [group, setGroup] = useState<Group>(
    initialType === 'instructor' || initialType === 'consultant' ? 'teaching' : 'staff',
  );
  const [toast, setToast] = useState<Toast | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justMoved, setJustMoved] = useState<Set<string>>(new Set());
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

  // The tab's own data can be minutes stale — refresh whenever staff actually
  // open the tab, not just on the wider app's schedule.
  useEffect(() => { void reloadJoinUsApplications(); }, [reloadJoinUsApplications]);
  const refresh = async () => {
    setRefreshing(true);
    try { await reloadJoinUsApplications(); } finally { setRefreshing(false); }
  };

  const notify = useMemo(() => (type: Toast['type'], text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(current => (current?.text === text ? null : current)), 4500);
  }, []);

  const byGroup = useMemo(() => ({
    teaching: joinUsApplications.filter(app => groupOf(app) === 'teaching'),
    staff: joinUsApplications.filter(app => groupOf(app) === 'staff'),
  }), [joinUsApplications]);
  const fresh = (list: JoinUsApplication[]) => list.filter(app => statusOf(app.status) === 'new').length;

  const run = async (app: JoinUsApplication, work: () => Promise<string>, failure: string) => {
    setBusyId(app.id);
    try {
      const done = await work();
      notify('success', done);
      setPrompt(null); setFirstCallFor(null); setInterviewFor(null);
      await reloadJoinUsApplications();
    } catch (error) {
      notify('error', `${failure}${error instanceof Error && error.message ? ` — ${error.message}` : ''}`);
    } finally { setBusyId(null); }
  };

  const actions: CardActions = {
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

  const submitInterview = (interviewAt: string | undefined) => {
    if (!interviewFor) return;
    const { app, mode } = interviewFor;
    void run(app, async () => {
      if (mode === 'accept') {
        await mysqlAdmin.evaluateJoinUs(app.id, { decision: 'ACCEPTED', interviewAt });
      } else {
        await mysqlAdmin.moveJoinUsToInterview(app.id, interviewAt);
      }
      setJustMoved(prev => new Set(prev).add(app.id));
      return interviewAt
        ? `${app.name} في الانترفيوهات تحت «القادم» — الميعاد ${interviewAt}`
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
            ? 'القبول بينقله لصفحة الانترفيوهات — حدد الميعاد لو اتفقتوا عليه'
            : 'هيظهر في صفحة الانترفيوهات تحت «القادم»'}
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

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-900 px-5 py-4 text-white">
        <div>
          <h2 className="text-xl font-black">طلبات الانضمام</h2>
          <p className="mt-0.5 text-xs text-gray-300">
            {branchOnly ? 'طلبات فرعك بس — المحاضرين والموظفين كل واحد في صفحة.' : 'المحاضرين والموظفين كل واحد في صفحة، بفلاتره وبحثه.'}
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing}
          className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-2 text-xs font-bold hover:bg-white/25 disabled:opacity-60">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> تحديث
        </button>
      </section>

      <div role="tablist" className="grid gap-2 sm:grid-cols-2">
        {(['teaching', 'staff'] as Group[]).map(key => {
          const { title, Icon, tab, ring } = GROUPS[key];
          const active = group === key;
          const newCount = fresh(byGroup[key]);
          return (
            <button key={key} role="tab" aria-selected={active} onClick={() => setGroup(key)}
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-right transition ${
                active ? `${tab} border-transparent shadow-lg` : `border-gray-200 bg-white ${ring}`}`}>
              <span className="flex items-center gap-2 text-base font-black"><Icon size={20} /> {title}</span>
              <span className="flex items-center gap-1.5 text-xs font-bold">
                <span className={`rounded-full px-2 py-0.5 ${active ? 'bg-white/20' : 'bg-gray-100 text-gray-700'}`}>{byGroup[key].length}</span>
                {newCount > 0 && <span className={`rounded-full px-2 py-0.5 ${active ? 'bg-white text-gray-900' : 'bg-sky-600 text-white'}`}>{newCount} جديد</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* Both lists stay mounted, so each keeps its own filters and search. */}
      <div hidden={group !== 'teaching'}>
        <ApplicationsBoard group="teaching" apps={byGroup.teaching} busyId={busyId} justMoved={justMoved} actions={actions} />
      </div>
      <div hidden={group !== 'staff'} className="space-y-4">
        {/* The postings themselves — publish one, see who applied, close it. */}
        {!branchOnly && (
          <React.Suspense fallback={<div className="rounded-2xl border border-gray-100 bg-white py-8 text-center text-sm text-gray-400">جاري تحميل الوظائف...</div>}>
            <JobPostingsPanel notify={notify} />
          </React.Suspense>
        )}
        <ApplicationsBoard group="staff" apps={byGroup.staff} busyId={busyId} justMoved={justMoved} actions={actions} />
      </div>
    </div>
  );
}
