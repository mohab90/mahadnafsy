import { Fragment, useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldAlert, UserCheck, PhoneOff, Users, Wallet, ChevronDown, ChevronLeft, Ban, CheckCircle2, Unlock, Globe } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { type AttemptState, type LoginEvent, STATE_META, deviceLabel, fmtTime } from './loginUi';
import { LoginHistoryPanel } from './LoginHistoryPanel';

// «حسابات الدخول» and «سجل تسجيلات الدخول» in one page (16 Oct 2026).
//
// One row per account — the client's name and number, how many times it signed in, and the last
// attempt's address, device, status and reason — with the account's own history opened under the row
// and the actions on the right. «كل المحاولات» is the stream of every attempt, including the ones no
// account matches (a number nobody registered, a wrong code), which a list of accounts cannot show.

interface AccountRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  phone_verified_at: string | null;
  role: string | null;
  is_active: number;
  has_password: number;
  last_login: string | null;
  login_count: number | null;
  failed_7d: number;
  ips_7d: number;
  sharing_locked_until: string | null;
  sharing_lock_reason: string | null;
  has_active_session: number;
  active_session_last_seen_at: string | null;
  subscriber_id: string | null;
  client_code: string | null;
  last_ip: string | null;
  last_user_agent: string | null;
  last_status: AttemptState | null;
  last_reason: string | null;
  last_attempt_at: string | null;
}

interface Stats { total?: number; without_phone?: number; verified?: number; locked?: number; never?: number }

type FilterKey = '' | 'no_phone' | 'unverified' | 'locked' | 'inactive' | 'never';

const FILTERS: [FilterKey, string][] = [
  ['', 'الكل'],
  ['no_phone', 'بدون رقم'],
  ['unverified', 'رقم غير مُفعّل'],
  ['locked', 'موقوف مؤقتاً'],
  ['inactive', 'معطّل'],
  ['never', 'عمره ما دخل'],
];

/**
 * What the desk can do from here, handed down by the page that owns the data.
 *
 * A row on this screen is a person who signed up. Seeing them and not being
 * able to act on them is what «كتير من العملاء لم تتحول لقاعده البيانات» is:
 * the work — open their file, take their booking — lived on another screen
 * they had to find the person on again.
 */
export interface LoginAccountActions {
  /** Open this person's file. Given a subscriber id when they are already a client. */
  onOpenProfile?: (row: { id: string; subscriberId: string | null; clientCode: string | null; name: string | null }) => void;
  /** Book and take payment — converting them to a client first when they are not one. */
  onBookAndPay?: (row: { id: string; subscriberId: string | null; name: string | null }) => void;
  busyId?: string | null;
  notify?: (type: 'success' | 'error' | 'info', text: string) => void;
}

const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { credentials: 'include', ...init, headers: { ...adminAuthHeaders(), ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'تعذّر تنفيذ الطلب');
  return data;
};

/**
 * The account's state, in one place and in order of what stops them first. The old page printed up to
 * four labels at once and one of them — «مُفعّل» — was the phone's, read as the account's; and it said
 * «لا يمكنه الدخول» of every account without a number although one with a password can sign in with it.
 */
function accountState(r: AccountRow, now: number): { label: string; cls: string; reason: string } {
  if (!r.is_active) return { label: 'معطّل', cls: 'bg-gray-200 text-gray-700', reason: 'الحساب متعطّل من الإدارة' };
  if (r.sharing_locked_until && new Date(r.sharing_locked_until).getTime() > now) {
    return { label: 'موقوف مؤقتاً', cls: 'bg-amber-100 text-amber-800', reason: `${r.sharing_lock_reason || 'مشاركة الحساب'} — لحد ${fmtTime(r.sharing_locked_until)}` };
  }
  if (!r.phone && !r.has_password) return { label: 'مش هيقدر يدخل', cls: 'bg-red-100 text-red-700', reason: 'مفيش رقم واتساب ولا كلمة مرور' };
  if (r.last_status === 'failed') return { label: 'آخر محاولة فشلت', cls: 'bg-red-100 text-red-700', reason: r.last_reason || '—' };
  if (r.last_status === 'pending') return { label: STATE_META.pending.label, cls: STATE_META.pending.cls, reason: 'دخل كلمة المرور وماكتبش الكود' };
  if (r.last_status) return { label: 'سليم', cls: 'bg-green-100 text-green-700', reason: r.phone && !r.phone_verified_at ? 'الرقم لسه ما اتأكدش بكود' : '—' };
  return { label: 'عمره ما دخل', cls: 'bg-gray-100 text-gray-600', reason: r.phone ? (r.phone_verified_at ? 'مسجّل ولسه ما دخلش' : 'الرقم لسه ما اتأكدش بكود') : 'مفيش رقم — ما يقدرش يدخل بالواتساب' };
}

export function LoginAccountsPanel({ onOpenProfile, onBookAndPay, busyId, notify }: LoginAccountActions = {}) {
  const [mode, setMode] = useState<'accounts' | 'events'>('accounts');
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterKey>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, LoginEvent[] | 'loading'>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (q.trim()) params.set('q', q.trim());
      if (filter) params.set('filter', filter);
      const data = await json(`/api/admin/security/accounts?${params}`);
      setRows(data?.rows || []);
      setStats(data?.stats || {});
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [q, filter]);

  useEffect(() => { if (mode === 'accounts') void load(); }, [load, mode]);

  const toggle = async (r: AccountRow) => {
    if (openId === r.id) { setOpenId(null); return; }
    setOpenId(r.id);
    setHistory(h => ({ ...h, [r.id]: 'loading' }));
    try {
      const events = await json(`/api/admin/security/accounts/${encodeURIComponent(r.id)}/logins?limit=50`);
      setHistory(h => ({ ...h, [r.id]: events }));
    } catch { setHistory(h => ({ ...h, [r.id]: [] })); }
  };

  const act = async (r: AccountRow, kind: 'toggle-active' | 'unlock') => {
    setActing(`${r.id}:${kind}`);
    try {
      const out = await json(`/api/admin/security/accounts/${encodeURIComponent(r.id)}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      notify?.('success', out?.message || 'تم');
      await load();
    } catch (e) {
      notify?.('error', e instanceof Error ? e.message : 'تعذّر التنفيذ');
    } finally { setActing(null); }
  };

  const num = (n: number | undefined) => (n ?? 0).toLocaleString('ar-EG-u-nu-latn');
  const columns = 9;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs w-fit">
        {([['accounts', 'الحسابات'], ['events', 'كل المحاولات']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setMode(key)}
            className={`px-4 py-2 font-bold transition ${mode === key ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{label}</button>
        ))}
      </div>

      {mode === 'events' ? <LoginHistoryPanel /> : (<>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><Users size={13} /> إجمالي الحسابات</p>
            <p className="text-2xl font-black text-gray-800">{num(stats.total)}</p>
          </div>
          <div className="bg-white border border-red-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><PhoneOff size={13} /> بدون رقم واتساب</p>
            <p className="text-2xl font-black text-red-600">{num(Number(stats.without_phone))}</p>
          </div>
          <div className="bg-white border border-green-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><UserCheck size={13} /> رقم مُفعّل</p>
            <p className="text-2xl font-black text-green-700">{num(Number(stats.verified))}</p>
          </div>
          <div className="bg-white border border-amber-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><ShieldAlert size={13} /> موقوف مؤقتاً</p>
            <p className="text-2xl font-black text-amber-600">{num(Number(stats.locked))}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><Globe size={13} /> عمره ما دخل</p>
            <p className="text-2xl font-black text-gray-700">{num(Number(stats.never))}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" placeholder="بحث بالاسم أو الرقم أو الكود أو البريد…" value={q} onChange={e => setQ(e.target.value)}
              className="w-full border border-gray-200 rounded-lg pr-8 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300" />
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs flex-wrap">
            {FILTERS.map(([key, label]) => (
              <button key={key || 'all'} onClick={() => setFilter(key)}
                className={`px-3 py-1.5 font-bold transition ${filter === key ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{label}</button>
            ))}
          </div>
          <button onClick={() => void load()} disabled={loading}
            className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-60">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
          <span className="text-xs text-gray-500 font-medium mr-auto">{num(rows.length)} حساب</span>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-gray-50">
                <tr className="text-gray-500 text-right border-b border-gray-100">
                  <th className="py-2.5 px-3 font-semibold">العميل</th>
                  <th className="py-2.5 px-3 font-semibold">الرقم</th>
                  <th className="py-2.5 px-3 font-semibold">مرات الدخول</th>
                  <th className="py-2.5 px-3 font-semibold">آخر محاولة</th>
                  <th className="py-2.5 px-3 font-semibold">IP</th>
                  <th className="py-2.5 px-3 font-semibold">الجهاز</th>
                  <th className="py-2.5 px-3 font-semibold">الحالة</th>
                  <th className="py-2.5 px-3 font-semibold">السبب</th>
                  <th className="py-2.5 px-3 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={columns} className="py-10 text-center text-gray-400 text-sm">جارٍ التحميل…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={columns} className="py-10 text-center text-gray-400 text-sm">لا توجد حسابات مطابقة</td></tr>
                ) : rows.map(r => {
                  const state = accountState(r, now);
                  const locked = r.sharing_locked_until && new Date(r.sharing_locked_until).getTime() > now;
                  const opened = openId === r.id;
                  const events = history[r.id];
                  return (
                    <Fragment key={r.id}>
                      <tr className={`border-b border-gray-50 transition ${opened ? 'bg-emerald-50/40' : 'hover:bg-gray-50/60'}`}>
                        <td className="py-2.5 px-3">
                          <button type="button" onClick={() => void toggle(r)} className="flex items-start gap-1.5 text-right" title="سجل دخول الحساب ده">
                            {opened ? <ChevronDown size={14} className="mt-0.5 text-gray-400" /> : <ChevronLeft size={14} className="mt-0.5 text-gray-400" />}
                            <span>
                              <span className="block font-medium text-gray-800">{r.name || '—'}</span>
                              <span className="block text-[11px] text-gray-400">{r.email || '—'}{r.client_code ? ` · ${r.client_code}` : ''}</span>
                            </span>
                          </button>
                        </td>
                        <td className="py-2.5 px-3">
                          {r.phone ? <span className="font-mono text-xs" dir="ltr">{r.phone}</span>
                            : <span className="text-xs text-red-600 font-bold flex items-center gap-1"><PhoneOff size={12} /> لا يوجد</span>}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-gray-700">
                          <span className="font-bold">{num(r.login_count ?? 0)}</span>
                          {r.failed_7d > 0 && <span className="block text-[10px] text-red-600">{num(r.failed_7d)} فاشلة (7 أيام)</span>}
                          {r.ips_7d > 1 && <span className="block text-[10px] text-amber-700">{num(r.ips_7d)} شبكات (7 أيام)</span>}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fmtTime(r.last_attempt_at || r.last_login)}</td>
                        <td className="py-2.5 px-3 text-xs font-mono text-gray-600" dir="ltr">{r.last_ip || '—'}</td>
                        <td className="py-2.5 px-3 text-xs text-gray-600" title={r.last_user_agent || ''}>{deviceLabel(r.last_user_agent)}</td>
                        <td className="py-2.5 px-3">
                          <span className={`text-[11px] px-2 py-0.5 rounded-lg font-medium ${state.cls}`}>{state.label}</span>
                          {r.has_active_session ? <span className="block text-[10px] text-emerald-700 mt-0.5">جلسة نشطة · {fmtTime(r.active_session_last_seen_at)}</span> : null}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-gray-500 max-w-[240px]">{state.reason}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {onOpenProfile && (
                              <button type="button" onClick={() => onOpenProfile({ id: r.id, subscriberId: r.subscriber_id, clientCode: r.client_code, name: r.name })}
                                className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] font-bold text-gray-700 transition hover:bg-gray-50"
                                title={r.subscriber_id ? 'فتح ملف العميل' : 'لسه تسجيل موقع — هيتحوّل لعميل أول ما تفتح ملفه'}>
                                <UserCheck size={12} /> الملف
                              </button>
                            )}
                            {onBookAndPay && (
                              <button type="button" disabled={busyId === r.id} onClick={() => onBookAndPay({ id: r.id, subscriberId: r.subscriber_id, name: r.name })}
                                className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                                title="حجز ودفع — يحوّله لعميل لو لسه تسجيل">
                                <Wallet size={12} /> {busyId === r.id ? 'جارٍ…' : 'حجز ودفع'}
                              </button>
                            )}
                            {locked && (
                              <button type="button" disabled={acting === `${r.id}:unlock`} onClick={() => void act(r, 'unlock')}
                                className="flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60" title="فك الإيقاف المؤقت دلوقتي">
                                <Unlock size={12} /> فك الإيقاف
                              </button>
                            )}
                            <button type="button" disabled={acting === `${r.id}:toggle-active`} onClick={() => void act(r, 'toggle-active')}
                              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold disabled:opacity-60 ${r.is_active ? 'border-red-200 bg-white text-red-700 hover:bg-red-50' : 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'}`}
                              title={r.is_active ? 'تعطيل الحساب — هيطلع من جلسته' : 'تفعيل الحساب'}>
                              {r.is_active ? <><Ban size={12} /> تعطيل</> : <><CheckCircle2 size={12} /> تفعيل</>}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {opened && (
                        <tr className="bg-gray-50/70">
                          <td colSpan={columns} className="px-6 py-3">
                            {events === 'loading' || !events ? <p className="text-xs text-gray-400">جارٍ التحميل…</p>
                              : events.length === 0 ? <p className="text-xs text-gray-400">مفيش محاولات دخول متسجلة للحساب ده.</p>
                                : (
                                  <table className="w-full text-xs">
                                    <thead><tr className="text-gray-400 text-right"><th className="py-1 px-2 font-semibold">الوقت</th><th className="py-1 px-2 font-semibold">IP</th><th className="py-1 px-2 font-semibold">الجهاز</th><th className="py-1 px-2 font-semibold">الحالة</th><th className="py-1 px-2 font-semibold">السبب</th></tr></thead>
                                    <tbody>
                                      {events.map(ev => (
                                        <tr key={ev.id} className="border-t border-gray-100">
                                          <td className="py-1.5 px-2 whitespace-nowrap text-gray-600">{fmtTime(ev.created_at)}</td>
                                          <td className="py-1.5 px-2 font-mono text-gray-600" dir="ltr">{ev.ip || '—'}</td>
                                          <td className="py-1.5 px-2 text-gray-600" title={ev.user_agent || ''}>{deviceLabel(ev.user_agent)}</td>
                                          <td className="py-1.5 px-2"><span className={`px-2 py-0.5 rounded-lg font-medium ${STATE_META[ev.state].cls}`}>{STATE_META[ev.state].label}</span></td>
                                          <td className="py-1.5 px-2 text-gray-500">{ev.reason_label || '—'}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </>)}
    </div>
  );
}

export default LoginAccountsPanel;
