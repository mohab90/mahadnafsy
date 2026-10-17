import { useEffect, useMemo, useRef, useState } from 'react';
import { Filter, RotateCcw, Search } from 'lucide-react';
import type { JoinUsApplication } from '../../../../types';
import { mysqlAdmin } from '../../../../lib/mysqlapi';
import { normalizeApplicants } from '../../../../context/site-data-hooks/normalizeApplicants';
import { EXPERIENCE_ORDER, EXPERIENCE_YEARS, branchLabel } from '../hr-sections/applicantLabels';
import ApplicationCard, { type CardActions, jobLabel } from './ApplicationCard';
import { type Group, type Kind, STATUS, type Status, statusOf } from './joinUsUi';

export const PAGE_SIZE = 50;

type Counts = Awaited<ReturnType<typeof mysqlAdmin.joinUsInboxCounts>>;
type Facets = Awaited<ReturnType<typeof mysqlAdmin.joinUsInboxFacets>>;

const TITLES: Record<Group, { title: string; short: string }> = {
  teaching: { title: 'طلبات انضمام المحاضرين', short: 'المحاضرين والاستشاريين' },
  staff: { title: 'طلبات انضمام الموظفين', short: 'الموظفين' },
};

type BoardProps = {
  group: Group;
  /** Bumped when something changed (an action, «تحديث»): the list is read again. */
  version: number;
  counts: Counts | null;
  busyId: string | null;
  actions: CardActions;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
};

/**
 * One list — the lecturers' or the employees' — with filters of its own.
 *
 * The filters run in the database (api/lib/recruitmentFilters.js): this asks for the
 * PAGE_SIZE rows it draws and for the next PAGE_SIZE when told to, instead of holding
 * every application and sifting them here.
 */
export default function ApplicationsBoard({ group, version, counts, busyId, actions, notify }: BoardProps) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [minExperience, setMinExperience] = useState('');
  const [branch, setBranch] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [jobFilter, setJobFilter] = useState('');
  const [program, setProgram] = useState('');
  const [lectured, setLectured] = useState<'' | 'yes' | 'no'>('');
  const [sessions, setSessions] = useState<'' | 'yes' | 'no'>('');

  const [rows, setRows] = useState<JoinUsApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);

  // A search is sent once typing pauses, not with every key.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => ({
    form: group,
    status: status === 'all' ? '' : status.toUpperCase(),
    kind: kind === 'all' ? '' : kind,
    branch, job: jobFilter, program, lectured, sessions,
    minExp: minExperience, q: debouncedSearch.trim(),
  }), [group, status, kind, branch, jobFilter, program, lectured, sessions, minExperience, debouncedSearch]);

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
    mysqlAdmin.listJoinUsInbox({ ...query, limit, offset: 0 })
      .then(result => {
        if (id !== requestId.current) return;
        setRows(normalizeApplicants(result.rows));
        setTotal(result.total);
      })
      .catch(error => { if (id === requestId.current) notify('error', error instanceof Error ? error.message : 'تعذّر تحميل الطلبات'); })
      .finally(() => { if (id === requestId.current) setLoading(false); });
  }, [query, version, notify]);

  const more = async () => {
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const result = await mysqlAdmin.listJoinUsInbox({ ...query, limit: PAGE_SIZE, offset: rows.length });
      if (id !== requestId.current) return;
      setRows(previous => {
        const seen = new Set(previous.map(app => app.id));
        return [...previous, ...normalizeApplicants(result.rows).filter(app => !seen.has(app.id))];
      });
      setTotal(result.total);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذّر تحميل المزيد');
    } finally { setLoadingMore(false); }
  };

  // The pickers' options come from the database once, with their tallies.
  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.joinUsInboxFacets(group).then(result => { if (!cancelled) setFacets(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [group]);

  const statusCounts = useMemo(() => {
    const tally = {} as Record<Status, number>;
    (Object.keys(STATUS) as Status[]).forEach(key => { tally[key] = 0; });
    Object.entries(counts?.byFormStatus[group] || {}).forEach(([key, count]) => { tally[statusOf(key.toLowerCase())] += Number(count) || 0; });
    return tally;
  }, [counts, group]);
  const everything = (Object.values(statusCounts) as number[]).reduce((sum, count) => sum + count, 0);

  const filtersActive = Boolean(search.trim() || jobFilter || branch || minExperience || program || lectured || sessions)
    || status !== 'all' || kind !== 'all';
  const reset = () => {
    setSearch(''); setDebouncedSearch(''); setStatus('all'); setMinExperience(''); setBranch(''); setJobFilter('');
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
          الكل {everything}
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
          <Filter size={14} className={teaching ? 'text-violet-600' : 'text-emerald-600'} /> فلترة {TITLES[group].title}
          {filtersActive && (
            <button onClick={reset}
              className="mr-auto flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-gray-500 hover:bg-gray-100">
              <RotateCcw size={11} /> إلغاء الفلاتر
            </button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">بحث في {TITLES[group].short}</span>
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
                  {(facets?.programs || []).map(item => <option key={item.title} value={item.title}>{item.title} ({item.count})</option>)}
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
                {(facets?.jobs || []).map(job => (
                  <option key={job.id} value={job.id}>{jobLabel({ jobId: job.id, jobTitle: job.title || undefined } as JoinUsApplication)} ({job.count})</option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[11px] font-bold text-gray-500">الفرع</span>
            <select value={branch} onChange={event => setBranch(event.target.value)} className={field}>
              <option value="">كل الفروع</option>
              {(facets?.branches || []).map(item => <option key={item.key} value={item.key}>{branchLabel(item.key)} ({item.count})</option>)}
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
      </div>

      {loading ? (
        <div className="rounded-2xl border border-gray-100 bg-white py-12 text-center text-sm font-bold text-gray-400">جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center text-sm text-gray-400">
          {filtersActive ? 'مفيش طلبات مطابقة للفلاتر.' : `مفيش ${TITLES[group].title} لسه.`}
        </div>
      ) : (
        <>
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {rows.map(app => (
              <ApplicationCard key={app.id} app={app} busy={busyId === app.id} actions={actions} />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-1 text-xs font-bold text-gray-500">
            <span>ظاهر {rows.length.toLocaleString('ar-EG-u-nu-latn')} من {total.toLocaleString('ar-EG-u-nu-latn')}</span>
            {total > rows.length && (
              <button onClick={() => { void more(); }} disabled={loadingMore}
                className="rounded-xl bg-gray-900 px-4 py-2 text-white hover:bg-gray-700 disabled:opacity-50">
                {loadingMore ? 'جاري التحميل...' : `عرض ${Math.min(PAGE_SIZE, total - rows.length).toLocaleString('ar-EG-u-nu-latn')} طلب كمان`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
