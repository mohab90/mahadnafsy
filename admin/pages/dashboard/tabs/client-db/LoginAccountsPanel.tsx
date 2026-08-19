import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, ShieldAlert, UserCheck, PhoneOff, Users, CheckCircle2, Circle } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

// The sign-in accounts themselves — who can actually get into the system, and
// how. Separate from the login-history view next to it, which is a stream of
// events. Since a WhatsApp number became the identity, an account without one
// simply cannot sign in; that has to be visible to staff here rather than
// arriving as a customer complaint.

interface AccountRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  phone_verified_at: string | null;
  role: string | null;
  is_active: number;
  last_login: string | null;
  login_count: number | null;
  sharing_locked_until: string | null;
  sharing_lock_reason: string | null;
  has_active_session: number;
  active_session_last_seen_at: string | null;
  subscriber_id: string | null;
  client_code: string | null;
}

interface Stats { total?: number; without_phone?: number; verified?: number; locked?: number }

type FilterKey = '' | 'no_phone' | 'unverified' | 'locked' | 'inactive';

const FILTERS: [FilterKey, string][] = [
  ['', 'الكل'],
  ['no_phone', 'بدون رقم واتساب'],
  ['unverified', 'رقم غير مُفعّل'],
  ['locked', 'موقوف مؤقتاً'],
  ['inactive', 'غير نشط'],
];

const fmt = (value: string | null) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('ar-EG-u-nu-latn', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return String(value); }
};

export function LoginAccountsPanel() {
  const [rows, setRows] = useState<AccountRow[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterKey>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (q.trim()) params.set('q', q.trim());
      if (filter) params.set('filter', filter);
      const res = await fetch(`/api/admin/security/accounts?${params}`, { credentials: 'include', headers: adminAuthHeaders() });
      if (!res.ok) throw new Error('تعذّر تحميل الحسابات');
      const data = await res.json();
      setRows(data?.rows || []);
      setStats(data?.stats || {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [q, filter]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><Users size={13} /> إجمالي الحسابات</p>
          <p className="text-2xl font-black text-gray-800">{(stats.total ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><PhoneOff size={13} /> بدون رقم واتساب</p>
          <p className="text-2xl font-black text-red-600">{(stats.without_phone ?? 0).toLocaleString()}</p>
          <p className="text-[10px] text-red-500 mt-0.5">لا يستطيعون تسجيل الدخول</p>
        </div>
        <div className="bg-white border border-green-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><UserCheck size={13} /> رقم مُفعّل</p>
          <p className="text-2xl font-black text-green-700">{(stats.verified ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><ShieldAlert size={13} /> موقوف مؤقتاً</p>
          <p className="text-2xl font-black text-amber-600">{(stats.locked ?? 0).toLocaleString()}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text" placeholder="بحث بالاسم أو الرقم أو البريد…" value={q}
            onChange={e => setQ(e.target.value)}
            className="w-full border border-gray-200 rounded-lg pr-8 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          {FILTERS.map(([key, label]) => (
            <button
              key={key || 'all'} onClick={() => setFilter(key)}
              className={`px-3 py-1.5 font-bold transition ${filter === key ? 'bg-emerald-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
        <span className="text-xs text-gray-500 font-medium mr-auto">{rows.length.toLocaleString()} حساب</span>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-gray-500 text-right border-b border-gray-100">
                <th className="py-2.5 px-3 font-semibold">العميل</th>
                <th className="py-2.5 px-3 font-semibold">رقم الواتساب</th>
                <th className="py-2.5 px-3 font-semibold">الحالة</th>
                <th className="py-2.5 px-3 font-semibold">آخر دخول</th>
                <th className="py-2.5 px-3 font-semibold">مرات الدخول</th>
                <th className="py-2.5 px-3 font-semibold">جلسة نشطة</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm">جارٍ التحميل…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm">لا توجد حسابات مطابقة</td></tr>
              ) : rows.map(r => {
                const locked = r.sharing_locked_until && new Date(r.sharing_locked_until) > new Date();
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition">
                    <td className="py-2.5 px-3">
                      <p className="font-medium text-gray-800">{r.name || '—'}</p>
                      <p className="text-[11px] text-gray-400">{r.email || '—'}{r.client_code ? ` · ${r.client_code}` : ''}</p>
                    </td>
                    <td className="py-2.5 px-3">
                      {r.phone ? (
                        <span className="font-mono text-xs" dir="ltr">{r.phone}</span>
                      ) : (
                        <span className="text-xs text-red-600 font-bold flex items-center gap-1">
                          <PhoneOff size={12} /> لا يوجد
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-wrap gap-1">
                        {!r.is_active && <span className="text-[11px] px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500 font-medium">غير نشط</span>}
                        {locked && (
                          <span className="text-[11px] px-2 py-0.5 rounded-lg bg-amber-100 text-amber-700 font-medium" title={r.sharing_lock_reason || ''}>
                            موقوف حتى {fmt(r.sharing_locked_until)}
                          </span>
                        )}
                        {r.phone && (
                          r.phone_verified_at
                            ? <span className="text-[11px] px-2 py-0.5 rounded-lg bg-green-100 text-green-700 font-medium flex items-center gap-1"><CheckCircle2 size={11} /> مُفعّل</span>
                            : <span className="text-[11px] px-2 py-0.5 rounded-lg bg-gray-100 text-gray-500 font-medium flex items-center gap-1"><Circle size={11} /> لم يُفعّل بعد</span>
                        )}
                        {!r.phone && <span className="text-[11px] px-2 py-0.5 rounded-lg bg-red-100 text-red-700 font-medium">لا يمكنه الدخول</span>}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fmt(r.last_login)}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-600">{(r.login_count ?? 0).toLocaleString()}</td>
                    <td className="py-2.5 px-3">
                      {r.has_active_session
                        ? <span className="text-[11px] px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-700 font-medium">نشطة · {fmt(r.active_session_last_seen_at)}</span>
                        : <span className="text-[11px] text-gray-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default LoginAccountsPanel;
