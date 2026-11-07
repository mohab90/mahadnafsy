import { useCallback, useMemo, useState } from 'react';
import { Clock, Globe, RefreshCw, UserCheck, Users } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { useVisibleInterval } from '../../../../shared/useVisibleInterval';
import { agoFrom, STATUS_LABELS, type PresenceStatus } from '../../../lib/presenceFormat';
import { ROLE_LABELS, type RoleKey } from '../../../constants/permissions';
import { cairoDateTime } from '../../../../shared/cairoDate';
import { DASHBOARD_MENU_GROUPS } from '../navigation';

/**
 * «مين فاتح السيستم دلوقتي»: each employee online / idle / offline with the screen they are on, what they last did and how long ago, and the clients on their
 * account page now. One server answer (GET /api/admin/presence/now, view_presence), refreshed every 30 s while the tab is in front. The server holds no
 * address or device, so none is shown.
 */
type Staff = {
  id: string; name: string; role: string; branchId: string | null; branchName: string | null; status: PresenceStatus;
  screen: string | null; lastSeenAt: string | null; lastActionAt: string | null; lastActionKind: 'write' | 'screen' | null;
  lastActionLabel: string | null; firstSeenToday: string | null;
};
type ClientNow = { uid: string; name: string; page: string | null; courseId: string | null; courseTitle: string | null; lastSeenAt: string };
type Presence = {
  generatedAt: string; counts: Record<PresenceStatus, number>; staff: Staff[]; clients: { count: number; list: ClientNow[] };
};

const SCREEN_LABELS: Record<string, string> = Object.fromEntries(DASHBOARD_MENU_GROUPS.flatMap(group => group.items.map(item => [item.key, item.label])));
const screenLabel = (key: string | null) => (key ? SCREEN_LABELS[key] || key : '—');
const CLIENT_PAGES: Record<string, string> = {
  overview: 'الرئيسية', learning: 'التعلّم', consultations: 'الاستشارات', community: 'المجتمع', account: 'حسابه',
};
const DOT: Record<PresenceStatus, string> = { online: 'bg-emerald-500', idle: 'bg-amber-400', offline: 'bg-gray-300' };
const PILL: Record<PresenceStatus, string> = { online: 'bg-emerald-50 text-emerald-700', idle: 'bg-amber-50 text-amber-700', offline: 'bg-gray-100 text-gray-500' };
const roleLabel = (role: string) => ROLE_LABELS[role.toLowerCase() as RoleKey] || (role === 'OWNER' ? 'المالك' : role);
const clock = (iso: string | null) => (iso ? cairoDateTime(iso).split(' ')[1]?.slice(0, 5) || '—' : '—');

export default function PresenceTab() {
  const [data, setData] = useState<Presence | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [branch, setBranch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState<'' | PresenceStatus>('');

  const load = useCallback(() => {
    setLoading(true);
    mysqlAdmin.adminGet<Presence>('/admin/presence/now')
      .then(answer => { setData(answer); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  // Every 30 s while the tab is in front, and at once when it comes back (the hook does both).
  useVisibleInterval(load, 30_000);

  const branches = useMemo(() => [...new Map((data?.staff || []).filter(s => s.branchId).map(s => [s.branchId as string, s.branchName || s.branchId])).entries()], [data]);
  const roles = useMemo(() => [...new Set((data?.staff || []).map(s => s.role))], [data]);
  const rows = (data?.staff || []).filter(s => (!branch || s.branchId === branch) && (!role || s.role === role) && (!status || s.status === status));
  const now = data ? new Date(data.generatedAt).getTime() : Date.now();

  if (!data) {
    return <div className="flex items-center justify-center gap-3 py-20 text-gray-400" dir="rtl">{failed ? 'تعذّر تحميل الصفحة — جرّب تاني' : <><RefreshCw size={22} className="animate-spin" /> جاري التحميل…</>}</div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-gray-800"><UserCheck size={22} className="text-emerald-600" /> مين فاتح السيستم دلوقتي</h2>
          <p className="mt-0.5 text-sm text-gray-400">بيتحدّث كل 30 ثانية · أونلاين = آخر ظهور من أقل من دقيقتين، خامل = أقل من 15 دقيقة{failed ? ' — آخر تحديث فشل' : ''}</p>
        </div>
        <button type="button" onClick={load} disabled={loading} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([['online', 'موظفين أونلاين'], ['idle', 'موظفين خاملين'], ['offline', 'غير متصلين']] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setStatus(status === key ? '' : key)}
            className={`rounded-2xl border bg-white p-4 text-right ${status === key ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-gray-200'}`}>
            <div className="flex items-center gap-2 text-xs font-bold text-gray-500"><span className={`h-2.5 w-2.5 rounded-full ${DOT[key]}`} />{label}</div>
            <div className="mt-1 text-2xl font-extrabold text-gray-900">{data.counts[key].toLocaleString('ar-EG-u-nu-latn')}</div>
          </button>
        ))}
        <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-sky-700"><Globe size={13} /> عملاء أونلاين دلوقتي</div>
          <div className="mt-1 text-2xl font-extrabold text-sky-900">{data.clients.count.toLocaleString('ar-EG-u-nu-latn')}</div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-800"><Users size={15} className="text-emerald-600" /> الموظفين</h3>
          <select value={branch} onChange={e => setBranch(e.target.value)} aria-label="الفرع" className="mr-auto rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
            <option value="">كل الفروع</option>
            {branches.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <select value={role} onChange={e => setRole(e.target.value)} aria-label="الوظيفة" className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
            <option value="">كل الوظائف</option>
            {roles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-4 py-2 text-right">الموظف</th><th className="px-2 text-right">الفرع</th><th className="px-2 text-right">الحالة</th>
                <th className="px-2 text-right">الشاشة الحالية</th><th className="px-2 text-right">آخر حاجة عملها</th><th className="px-2 text-right">أول ظهور النهارده</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-400">مفيش موظفين بالفلاتر دي</td></tr>}
              {rows.map(person => (
                <tr key={person.id} data-testid="presence-staff-row">
                  <td className="px-4 py-2.5"><div className="font-bold text-gray-800">{person.name}</div><div className="text-[11px] text-gray-400">{roleLabel(person.role)}</div></td>
                  <td className="px-2 text-gray-600">{person.branchName || '—'}</td>
                  <td className="px-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-bold ${PILL[person.status]}`}><span className={`h-2 w-2 rounded-full ${DOT[person.status]}`} />{STATUS_LABELS[person.status]}</span>
                    {person.status !== 'online' && person.lastSeenAt && <div className="mt-0.5 text-[11px] text-gray-400">آخر ظهور {agoFrom(person.lastSeenAt, now)}</div>}
                  </td>
                  <td className="px-2 text-gray-700">{person.status === 'offline' ? '—' : screenLabel(person.screen)}</td>
                  <td className="px-2 text-gray-700">
                    {person.lastActionAt ? (
                      <><div>{person.lastActionKind === 'screen' ? `فتح «${screenLabel(person.lastActionLabel)}»` : person.lastActionLabel}</div>
                        <div className="flex items-center gap-1 text-[11px] text-gray-400"><Clock size={10} />{agoFrom(person.lastActionAt, now)}</div></>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2 text-gray-600">{clock(person.firstSeenToday)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <h3 className="flex items-center gap-1.5 border-b border-gray-100 px-4 py-3 text-sm font-bold text-gray-800"><Globe size={15} className="text-sky-600" /> العملاء أونلاين دلوقتي ({data.clients.count.toLocaleString('ar-EG-u-nu-latn')})</h3>
        {data.clients.list.length === 0 ? <p className="py-8 text-center text-xs text-gray-400">مفيش عملاء فاتحين حسابهم دلوقتي</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-2 text-right">العميل</th><th className="px-2 text-right">الصفحة</th><th className="px-2 text-right">الكورس</th><th className="px-2 text-right">آخر ظهور</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {data.clients.list.map(client => (
                  <tr key={client.uid} data-testid="presence-client-row">
                    <td className="px-4 py-2 font-bold text-gray-800">{client.name}</td>
                    <td className="px-2 text-gray-600">{client.page ? CLIENT_PAGES[client.page] || client.page : '—'}</td>
                    <td className="px-2 text-gray-600">{client.courseTitle || '—'}</td>
                    <td className="px-2 text-gray-400">{agoFrom(client.lastSeenAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.clients.count > data.clients.list.length && <p className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">بنعرض أحدث {data.clients.list.length} عميل.</p>}
      </section>
    </div>
  );
}
