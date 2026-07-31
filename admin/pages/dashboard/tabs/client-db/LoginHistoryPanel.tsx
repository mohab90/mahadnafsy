import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogIn, RefreshCw, Search, ShieldAlert, Globe, Monitor, Download } from 'lucide-react';
import { adminAuthHeaders } from '../../../../lib/adminAuthHeaders';

// Sign-in log only. Deliberately separate from the client/lead database above:
// a login row is an authentication event, not a CRM record — it has no owner, no
// pipeline stage and no deal value, and mixing it into the client list made both
// harder to read. Backed by /api/admin/security/* which was already tenant-scoped
// and admin-gated but had no UI.

interface LoginRow {
  id: number;
  user_id: number | null;
  email: string | null;
  ip: string | null;
  user_agent: string | null;
  status: 'success' | 'failed' | '2fa_pending' | '2fa_success';
  failure_reason: string | null;
  created_at: string;
}

interface SecurityStats {
  total?: number;
  failed?: number;
  unique_ips?: number;
}

const STATUS_META: Record<LoginRow['status'], { label: string; cls: string }> = {
  success: { label: 'نجح', cls: 'bg-green-100 text-green-700' },
  failed: { label: 'فشل', cls: 'bg-red-100 text-red-700' },
  '2fa_pending': { label: 'بانتظار التحقق', cls: 'bg-amber-100 text-amber-700' },
  '2fa_success': { label: 'تحقق ثنائي', cls: 'bg-blue-100 text-blue-700' },
};

/** Turn a raw user-agent into something a non-technical admin can scan. */
function deviceLabel(ua: string | null): string {
  const s = String(ua || '');
  if (!s) return '—';
  const os = /Windows/i.test(s) ? 'Windows'
    : /Android/i.test(s) ? 'Android'
      : /iPhone|iPad|iOS/i.test(s) ? 'iOS'
        : /Mac OS X|Macintosh/i.test(s) ? 'macOS'
          : /Linux/i.test(s) ? 'Linux' : 'غير معروف';
  const browser = /Edg\//i.test(s) ? 'Edge'
    : /OPR\//i.test(s) ? 'Opera'
      : /Chrome\//i.test(s) ? 'Chrome'
        : /Firefox\//i.test(s) ? 'Firefox'
          : /Safari\//i.test(s) ? 'Safari' : '';
  return browser ? `${os} · ${browser}` : os;
}

const fmtTime = (value: string) => {
  try {
    return new Date(value).toLocaleString('ar-EG', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  } catch { return String(value || ''); }
};

export function LoginHistoryPanel() {
  const [rows, setRows] = useState<LoginRow[]>([]);
  const [stats, setStats] = useState<SecurityStats>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'' | LoginRow['status']>('');
  const [limit, setLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (email.trim()) qs.set('email', email.trim());
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
  }, [email, status, limit]);

  useEffect(() => { void load(); }, [load]);

  const exportCsv = () => {
    const header = ['التاريخ', 'البريد', 'IP', 'الجهاز', 'الحالة', 'سبب الفشل'];
    const body = rows.map(r => [
      fmtTime(r.created_at), r.email || '', r.ip || '', deviceLabel(r.user_agent),
      STATUS_META[r.status]?.label || r.status, r.failure_reason || '',
    ]);
    const csv = [header, ...body]
      .map(line => line.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `login-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Repeated failures from one IP are the signal worth surfacing — it separates a
  // user who forgot their password from someone probing accounts.
  const suspiciousIps = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.status !== 'failed' || !r.ip) continue;
      counts.set(r.ip, (counts.get(r.ip) || 0) + 1);
    }
    return [...counts.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><LogIn size={13} /> محاولات الدخول (7 أيام)</p>
          <p className="text-2xl font-black text-gray-800">{(stats.total ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-white border border-red-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><ShieldAlert size={13} /> محاولات فاشلة</p>
          <p className="text-2xl font-black text-red-600">{(stats.failed ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5"><Globe size={13} /> عناوين IP مختلفة</p>
          <p className="text-2xl font-black text-gray-800">{(stats.unique_ips ?? 0).toLocaleString()}</p>
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
            type="text" placeholder="بحث بالبريد الإلكتروني…" value={email}
            onChange={e => setEmail(e.target.value)}
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
          <option value="2fa_pending">بانتظار التحقق</option>
          <option value="2fa_success">تحقق ثنائي</option>
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
        <span className="text-xs text-gray-500 font-medium mr-auto">{rows.length.toLocaleString()} سجل</span>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr className="text-gray-500 text-right border-b border-gray-100">
                <th className="py-2.5 px-3 font-semibold">التاريخ والوقت</th>
                <th className="py-2.5 px-3 font-semibold">البريد الإلكتروني</th>
                <th className="py-2.5 px-3 font-semibold">IP</th>
                <th className="py-2.5 px-3 font-semibold">الجهاز</th>
                <th className="py-2.5 px-3 font-semibold">الحالة</th>
                <th className="py-2.5 px-3 font-semibold">السبب</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm">جارٍ التحميل…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="py-10 text-center text-gray-400 text-sm">
                  <Monitor size={30} className="mx-auto mb-2 opacity-40" />
                  لا توجد تسجيلات دخول مطابقة
                </td></tr>
              ) : rows.map(r => {
                const meta = STATUS_META[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-600' };
                return (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition">
                    <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    <td className="py-2.5 px-3 font-medium text-gray-800">{r.email || '—'}</td>
                    <td className="py-2.5 px-3 text-xs font-mono text-gray-600">{r.ip || '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-600" title={r.user_agent || ''}>{deviceLabel(r.user_agent)}</td>
                    <td className="py-2.5 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded-lg font-medium ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-gray-500">{r.failure_reason || '—'}</td>
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
