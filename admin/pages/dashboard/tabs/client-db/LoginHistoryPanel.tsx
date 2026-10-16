import { useCallback, useEffect, useMemo, useState } from 'react';
import { cairoDateOnly } from '../../../../../shared/cairoDate';
import { LogIn, RefreshCw, Search, ShieldAlert, Globe, Monitor, Download } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';
import { downloadCsv } from '../../../../../shared/csv';
import { type LoginEvent, STATE_META, deviceLabel, fmtTime } from './loginUi';

// Every sign-in attempt, whoever it was for — the second mode of the sign-in page
// (LoginAccountsPanel). A login row is an authentication event, not a CRM record,
// so it stays out of the client list; but it shows who it was: the account's name
// and number, or the number or e-mail that was tried when no account matched.

interface SecurityStats {
  total?: number;
  failed?: number;
  unique_ips?: number;
}

export function LoginHistoryPanel() {
  const [rows, setRows] = useState<LoginEvent[]>([]);
  const [stats, setStats] = useState<SecurityStats>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | LoginEvent['status']>('');
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (search.trim()) qs.set('q', search.trim());
      if (status) qs.set('status', status);
      const [logRes, statRes] = await Promise.all([
        fetch(`/api/admin/security/login-history?${qs.toString()}`, { credentials: 'include', headers: adminAuthHeaders() }),
        fetch('/api/admin/security/stats', { credentials: 'include', headers: adminAuthHeaders() }),
      ]);
      if (!logRes.ok) throw new Error('تعذّر تحميل سجل الدخول');
      const log = await logRes.json();
      setRows(Array.isArray(log) ? log : (log?.rows || []));
      if (statRes.ok) setStats(await statRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }, [search, status, limit]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = () => {
    const header = ['التاريخ', 'العميل', 'الرقم', 'البريد', 'IP', 'الجهاز', 'الحالة', 'السبب'];
    const body = rows.map(r => [
      fmtTime(r.created_at), r.name || '', r.phone || '', r.email || '', r.ip || '', deviceLabel(r.user_agent),
      STATE_META[r.state]?.label || r.status, r.reason_label || '',
    ]);
    downloadCsv(`login-history-${cairoDateOnly()}`, [header, ...body]);
  };

  // Repeated failures from one IP are the signal worth surfacing — it separates a
  // user who forgot their password from someone probing accounts.
  const suspiciousIps = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.state !== 'failed' || !r.ip) continue;
      counts.set(r.ip, (counts.get(r.ip) || 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><LogIn size={13} /> محاولات الدخول (7 أيام)</p>
          <p className="text-2xl font-black text-gray-800">{(stats.total ?? 0).toLocaleString('ar-EG-u-nu-latn')}</p>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><ShieldAlert size={13} /> محاولات فاشلة</p>
          <p className="text-2xl font-black text-red-600">{(stats.failed ?? 0).toLocaleString('ar-EG-u-nu-latn')}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><Globe size={13} /> عناوين IP مختلفة</p>
          <p className="text-2xl font-black text-gray-800">{(stats.unique_ips ?? 0).toLocaleString('ar-EG-u-nu-latn')}</p>
        </div>
      </div>

      {suspiciousIps.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs font-bold text-amber-800 mb-1.5">عناوين IP بمحاولات فاشلة متكررة</p>
          <div className="flex flex-wrap gap-2">
            {suspiciousIps.map(([ip, n]) => (
              <span key={ip} className="bg-white border border-amber-300 rounded-lg px-2 py-1 text-xs font-mono">
                {ip} <span className="font-bold text-amber-700">×{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text" placeholder="بحث بالاسم أو الرقم أو البريد أو الـIP…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg pr-8 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>
        <select
          value={status} onChange={e => setStatus(e.target.value as typeof status)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
        >
          <option value="">كل الحالات</option>
          <option value="success">ناجحة</option>
          <option value="failed">فاشلة</option>
          <option value="2fa_pending">خطوة كلمة المرور (تحقق ثنائي)</option>
          <option value="2fa_success">اكتمل التحقق الثنائي</option>
        </select>
        <select
          value={limit} onChange={e => setLimit(Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-300"
        >
          <option value={100}>آخر 100</option>
          <option value={250}>آخر 250</option>
          <option value={500}>آخر 500</option>
        </select>
        <button
          onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition disabled:opacity-60"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
        <button
          onClick={exportCsv} disabled={!rows.length}
          className="flex items-center gap-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
        >
          <Download size={13} /> تصدير CSV
        </button>
        <span className="text-xs text-gray-500 font-medium mr-auto">{rows.length.toLocaleString('ar-EG-u-nu-latn')} سجل</span>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-gray-500 text-right border-b border-gray-100">
                <th className="py-2.5 px-3 font-semibold">التاريخ والوقت</th>
                <th className="py-2.5 px-3 font-semibold">العميل</th>
                <th className="py-2.5 px-3 font-semibold">الرقم</th>
                <th className="py-2.5 px-3 font-semibold">IP</th>
                <th className="py-2.5 px-3 font-semibold">الجهاز</th>
                <th className="py-2.5 px-3 font-semibold">الحالة</th>
                <th className="py-2.5 px-3 font-semibold">السبب</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-gray-400 text-sm">جارٍ التحميل…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-gray-400 text-sm">
                  <Monitor size={30} className="mx-auto mb-2 opacity-40" />
                  لا توجد تسجيلات دخول مطابقة
                </td></tr>
              ) : rows.map(r => {
                const meta = STATE_META[r.state] || { label: r.status, cls: 'bg-gray-100 text-gray-600' };
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition">
                    <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    <td className="py-2.5 px-3">
                      <p className="font-medium text-gray-800">{r.name || (r.user_id ? '—' : 'حساب مش معروف')}</p>
                      <p className="text-[11px] text-gray-400">{r.email || '—'}{r.client_code ? ` · ${r.client_code}` : ''}</p>
                    </td>
                    <td className="py-2.5 px-3 text-xs font-mono text-gray-600" dir="ltr">{r.phone || '—'}</td>
                    <td className="py-2.5 px-3 text-xs font-mono text-gray-600" dir="ltr">{r.ip || '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-600" title={r.user_agent || ''}>{deviceLabel(r.user_agent)}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{r.reason_label || '—'}</td>
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

export default LoginHistoryPanel;
