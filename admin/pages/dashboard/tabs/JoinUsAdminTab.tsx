import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, BriefcaseBusiness, Building2, CalendarCheck, Filter, GraduationCap, Mail, Phone, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

// The job postings live here, not only under نظام HR: this is the page staff
// open to run recruitment, and "أضف وظيفة" was two menus away from the list of
// people applying for one.
const JobPostingsPanel = React.lazy(() => import('./JobPostingsPanel'));
import type { JoinUsApplication } from '../../../types';
import {
  EXPERIENCE_ORDER, EXPERIENCE_YEARS, branchLabel, matchesMinExperience, yearsLabel,
} from './hr-sections/applicantLabels';

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

/**
 * What to call the posting an application is attached to.
 *
 * Applications that did not come from a specific listing are parked on a
 * per-tenant placeholder job titled "Website applicants (Talent Pool)" — an
 * internal record, in English, that the postings list deliberately hides. It
 * must not surface here as though it were a real vacancy someone applied for.
 */
function jobLabel(app: JoinUsApplication): string {
  if (!app.jobId) return '';
  if (app.jobId.startsWith('talent-')) return 'طلب عام — مش على وظيفة محددة';
  return app.jobTitle || 'وظيفة محذوفة';
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
  const [minExperience, setMinExperience] = useState('');
  const [branch, setBranch] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>(initialType);
  const [jobFilter, setJobFilter] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
      .filter(app => matchesMinExperience(app.experienceYears, minExperience))
      .filter(app => !branch || app.applicantBranch === branch)
      .filter(app => !jobFilter || app.jobId === jobFilter)
      .filter(app => !query || [app.name, app.email, app.phone, app.specialty].some(value => String(value || '').toLowerCase().includes(query)))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    // Every value the filters above read has to be listed. Leaving the new ones
    // out kept the memo from recomputing, so picking a branch or an experience
    // band changed the dropdown and nothing else — a filter that looks broken
    // rather than one that is missing.
  }, [group, joinUsApplications, kind, search, status, minExperience, branch, jobFilter]);

  // The postings panel reports through a notify callback. Routing that to a
  // custom event would lose it: only 'site-persist-error' has a listener
  // anywhere in the app, so publishing a job would say nothing at all.
  const notify = useMemo(() => (type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(current => (current?.text === text ? null : current)), 4000);
  }, []);

  const jobOptions = useMemo(() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    joinUsApplications.forEach(app => {
      if (!app.jobId) return;
      const entry = map.get(app.jobId);
      if (entry) entry.count += 1;
      else map.set(app.jobId, { id: app.jobId, title: jobLabel(app), count: 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [joinUsApplications]);

  const branchOptions = useMemo(
    () => [...new Set(joinUsApplications.map(app => app.applicantBranch).filter(Boolean))] as string[],
    [joinUsApplications]);

  const filtersActive = Boolean(search.trim() || jobFilter || branch || minExperience)
    || status !== 'all' || kind !== 'all';

  const changeStatus = async (app: JoinUsApplication, next: Status) =>
    updateJoinUsApplication({ ...app, status: next });

  const editNote = async (app: JoinUsApplication) => {
    const note = window.prompt('ملاحظة فريق الموارد البشرية:', app.adminNote || '');
    if (note !== null) await updateJoinUsApplication({ ...app, adminNote: note.trim() || undefined });
  };

  const remove = async (app: JoinUsApplication) => {
    if (app.convertedApplicantId) return;
    if (window.confirm('حذف الطلب غير المرتبط بمسار التوظيف نهائيًا؟')) await deleteJoinUsApplication(app.id);
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
      {toast && (
        <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${
          toast.type === 'error' ? 'border border-red-200 bg-red-50 text-red-700'
            : toast.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-sky-200 bg-sky-50 text-sky-700'}`}
        >
          {toast.text}
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

      {/* The postings themselves — publish one, see who applied, close it. */}
      <React.Suspense fallback={<div className="rounded-2xl border border-gray-100 bg-white py-8 text-center text-sm text-gray-400">جاري تحميل الوظائف...</div>}>
        <JobPostingsPanel notify={notify} />
      </React.Suspense>

      <div className="rounded-2xl border border-gray-200 bg-white p-3 space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-600">
          <Filter size={14} className="text-indigo-600" /> فلترة الطلبات
          {filtersActive && (
            <button
              onClick={() => { setSearch(''); setStatus('all'); setMinExperience(''); setBranch(''); setJobFilter(''); setKind('all'); }}
              className="mr-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-500 hover:bg-gray-100"
            >
              <RotateCcw size={11} /> إلغاء الفلاتر
            </button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">بحث</span>
            <input value={search} onChange={event => setSearch(event.target.value)}
              placeholder="اسم، بريد، هاتف، تخصص"
              className="w-full rounded-xl border border-gray-200 px-2.5 py-1.5 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">الوظيفة</span>
            <select value={jobFilter} onChange={event => setJobFilter(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
              <option value="">كل الوظائف</option>
              {jobOptions.map(j => <option key={j.id} value={j.id}>{j.title} ({j.count})</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">الفرع</span>
            <select value={branch} onChange={event => setBranch(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
              <option value="">كل الفروع</option>
              {branchOptions.map(key => <option key={key} value={key}>{branchLabel(key)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">الخبرة (حد أدنى)</span>
            <select value={minExperience} onChange={event => setMinExperience(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
              <option value="">أي خبرة</option>
              <option value="only_none">بدون خبرة فقط</option>
              {EXPERIENCE_ORDER.filter(key => key !== 'none').map(key => (
                <option key={key} value={key}>{EXPERIENCE_YEARS[key]} فأكثر</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">الحالة</span>
            <select value={status} onChange={event => setStatus(event.target.value as Status | 'all')}
              className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
              <option value="all">كل الحالات</option>
              {(Object.keys(STATUS) as Status[]).map(key => <option key={key} value={key}>{STATUS[key].label}</option>)}
            </select>
          </label>
          {group === 'teaching' && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold text-gray-500">النوع</span>
              <select value={kind} onChange={event => setKind(event.target.value as Kind | 'all')}
                className="w-full rounded-xl border border-gray-200 bg-white px-2.5 py-1.5 text-xs">
                <option value="all">محاضرين واستشاريين</option>
                <option value="instructor">محاضر</option>
                <option value="consultant">استشاري</option>
              </select>
            </label>
          )}
        </div>
        {filtersActive && (
          <p className="text-[11px] font-bold text-gray-500">ظاهر {rows.length} طلب من {joinUsApplications.length}</p>
        )}
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
                      {jobLabel(app) && <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{jobLabel(app)}</span>}
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
                    {/* What the form actually collected. Without it, judging an
                        application meant phoning to ask the three things it
                        already answered. */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {app.experienceYears && (
                        <span className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                          <Briefcase size={11} /> {yearsLabel(app.experienceYears)}
                        </span>
                      )}
                      {app.applicantBranch && (
                        <span className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                          <Building2 size={11} /> {branchLabel(app.applicantBranch)}
                        </span>
                      )}
                      {app.education && (
                        <span className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-700">
                          <GraduationCap size={11} /> {app.education}
                        </span>
                      )}
                      {app.linkedin && (
                        <a href={app.linkedin} target="_blank" rel="noopener noreferrer"
                          className="rounded-lg bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-700 hover:bg-sky-200">
                          LinkedIn / الموقع
                        </a>
                      )}
                    </div>
                    {app.experiencePlaces && (
                      <p className="mt-1.5 text-[11px] text-gray-500">اشتغل قبل كده: {app.experiencePlaces}</p>
                    )}
                    {app.message && <p className="mt-3 whitespace-pre-line rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600">{app.message}</p>}
                    {app.adminNote && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">ملاحظة HR: {app.adminNote}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <select value={appStatus} onChange={event => changeStatus(app, event.target.value as Status)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold">
                      {(Object.keys(STATUS) as Status[]).map(key => <option key={key} value={key}>{STATUS[key].label}</option>)}
                    </select>
                    <button onClick={() => editNote(app)} className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">ملاحظة HR</button>
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
