import React, { useMemo, useState, useEffect } from 'react';
import { Shield, AlertTriangle, CheckCircle, XCircle, Eye, Lock, Unlock, Search, RefreshCw, Activity, User, Clock, Globe, Plus, Trash2, Server, Key } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { ActivityLogItem } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

interface IpEntry { id: string; ip: string; label: string; addedAt: string; active: boolean; }
interface IpApiRow { id: string | number; ip: string; label: string | null; created_at: string; }

const SECURITY_ACTIONS = ['login', 'logout', 'login_failed', 'password_changed', 'role_changed', 'permission_granted', 'permission_revoked', 'account_locked', 'account_unlocked', 'bulk_delete', 'export_data', 'settings_changed'];
const SENSITIVE_ACTIONS = ['bulk_delete', 'export_data', 'role_changed', 'account_locked', 'settings_changed', 'permission_granted', 'permission_revoked'];

function isSuspicious(logs: ActivityLogItem[], actorId: string, windowHours = 1): boolean {
  const cutoff = new Date(Date.now() - windowHours * 3600000).toISOString();
  return logs.filter(l => l.actor === actorId && l.at >= cutoff).length > 20;
}

const SecurityDashboardTab: React.FC<Props> = ({ notify }) => {
  const { activityLogs, staffMembers } = useSiteData();
  const [subTab, setSubTab] = useState<'overview' | 'activity' | 'ip' | 'access'>('overview');
  const [ipList, setIpList] = useState<IpEntry[]>([]);
  const [newIp, setNewIp] = useState('');
  const [newIpLabel, setNewIpLabel] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  // IP whitelist is backed by the real, server-enforced ip_whitelist table.
  const reloadIps = React.useCallback(async () => {
    try {
      const r = await fetch('/api/admin/ip-whitelist', { credentials: 'include' });
      if (!r.ok) throw new Error('load');
      const d = await r.json() as { whitelist: IpApiRow[] };
      setIpList((d.whitelist || []).map(w => ({ id: String(w.id), ip: w.ip, label: w.label || 'غير محدد', addedAt: w.created_at, active: true })));
    } catch { setIpList([]); }
  }, []);
  useEffect(() => { void reloadIps(); }, [reloadIps]);

  const securityLogs = useMemo(() =>
    activityLogs.filter(l => SECURITY_ACTIONS.includes(l.action) || SENSITIVE_ACTIONS.includes(l.action))
      .sort((a, b) => b.at.localeCompare(a.at)),
    [activityLogs, refreshKey]
  );

  const allAuditLogs = useMemo(() =>
    [...activityLogs].sort((a, b) => b.at.localeCompare(a.at))
      .filter(l => {
        if (eventFilter !== 'all' && l.action !== eventFilter) return false;
        if (searchTerm) {
          const q = searchTerm.toLowerCase();
          return l.actorName?.toLowerCase().includes(q) || l.label?.toLowerCase().includes(q) || l.action.toLowerCase().includes(q);
        }
        return true;
      }).slice(0, 100),
    [activityLogs, eventFilter, searchTerm, refreshKey]
  );

  const stats = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const loginLogs = activityLogs.filter(l => l.action === 'login');
    const failedLogins = activityLogs.filter(l => l.action === 'login_failed');
    const todayActivity = activityLogs.filter(l => l.at.startsWith(today)).length;
    const sensitiveCount = activityLogs.filter(l => SENSITIVE_ACTIONS.includes(l.action)).length;
    const uniqueActors = new Set(activityLogs.map(l => l.actor)).size;
    const suspiciousActors = staffMembers.filter(s => isSuspicious(activityLogs, s.id)).length;

    return { logins: loginLogs.length, failedLogins: failedLogins.length, todayActivity, sensitiveCount, uniqueActors, suspiciousActors };
  }, [activityLogs, staffMembers, refreshKey]);

  const staffAccessReview = useMemo(() =>
    staffMembers.map(s => {
      const myLogs = activityLogs.filter(l => l.actor === s.id);
      const lastActivity = myLogs.length > 0 ? myLogs.sort((a, b) => b.at.localeCompare(a.at))[0] : null;
      const sensitive = myLogs.filter(l => SENSITIVE_ACTIONS.includes(l.action)).length;
      const suspicious = isSuspicious(activityLogs, s.id);
      return { member: s, actionCount: myLogs.length, lastActivity, sensitive, suspicious };
    }).sort((a, b) => b.actionCount - a.actionCount),
    [staffMembers, activityLogs, refreshKey]
  );

  const actionColors: Record<string, string> = {
    login: 'text-green-600', login_failed: 'text-red-600', logout: 'text-gray-500',
    bulk_delete: 'text-red-700', export_data: 'text-amber-600', role_changed: 'text-purple-600',
    account_locked: 'text-red-700', settings_changed: 'text-indigo-600',
  };

  const addIp = async () => {
    if (!newIp.trim()) { notify('error', 'أدخل عنوان IP'); return; }
    try {
      const r = await fetch('/api/admin/ip-whitelist', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: newIp.trim(), label: newIpLabel.trim() || null }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || 'add'); }
      setNewIp(''); setNewIpLabel('');
      await reloadIps();
      notify('success', 'تم إضافة IP');
    } catch (e) { notify('error', e instanceof Error && e.message === 'Invalid IP format' ? 'صيغة IP غير صحيحة' : 'فشل إضافة IP'); }
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className={`bg-gradient-to-l rounded-2xl p-5 text-white ${stats.suspiciousActors > 0 ? 'from-red-700 to-rose-600' : 'from-slate-800 to-gray-700'}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Shield size={22} /> لوحة الأمان</h2>
            <p className="text-slate-300 text-sm mt-0.5">مراجعة الأنشطة والصلاحيات والسجلات الأمنية</p>
          </div>
          <button onClick={() => setRefreshKey(k => k + 1)}
            className="text-sm bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
            <RefreshCw size={13} /> تحديث
          </button>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-4">
          {[
            { label: 'تسجيل دخول', value: stats.logins, bg: 'bg-white/15' },
            { label: 'محاولات فاشلة', value: stats.failedLogins, bg: stats.failedLogins > 5 ? 'bg-red-500/30' : 'bg-white/15' },
            { label: 'نشاط اليوم', value: stats.todayActivity, bg: 'bg-white/15' },
            { label: 'أنشطة حساسة', value: stats.sensitiveCount, bg: stats.sensitiveCount > 0 ? 'bg-amber-500/25' : 'bg-white/15' },
            { label: 'مستخدمون نشطون', value: stats.uniqueActors, bg: 'bg-white/15' },
            { label: 'مشبوهون', value: stats.suspiciousActors, bg: stats.suspiciousActors > 0 ? 'bg-red-500/30' : 'bg-green-500/25' },
          ].map(s => (
            <div key={s.label} className={`${s.bg} rounded-xl p-2 text-center`}>
              <div className="text-xl font-black">{s.value}</div>
              <div className="text-xs text-slate-300">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Alerts */}
      {(stats.failedLogins > 5 || stats.suspiciousActors > 0) && (
        <div className="space-y-2">
          {stats.failedLogins > 5 && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
              <AlertTriangle size={15} className="shrink-0" />
              تحذير: {stats.failedLogins} محاولة دخول فاشلة — تحقق من البروتوكولات الأمنية
            </div>
          )}
          {stats.suspiciousActors > 0 && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-700">
              <AlertTriangle size={15} className="shrink-0" />
              {stats.suspiciousActors} مستخدم لديهم نشاط مرتفع بشكل غير معتاد خلال الساعة الأخيرة
            </div>
          )}
        </div>
      )}

      {/* Sub tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          ['overview', '🛡️ نظرة عامة'],
          ['activity', '📋 سجل الأنشطة'],
          ['ip', '🌐 قائمة IP'],
          ['access', '👤 مراجعة الوصول'],
        ] as const).map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${subTab === k ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-gray-600 border-gray-200 hover:border-slate-400'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Overview */}
      {subTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Recent security events */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-800">آخر الأحداث الأمنية</h3>
            </div>
            <div className="divide-y divide-gray-50">
              {securityLogs.slice(0, 8).length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">لا سجلات أمنية</div>
              ) : securityLogs.slice(0, 8).map(log => (
                <div key={log.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`text-xs font-medium ${actionColors[log.action] || 'text-gray-600'} shrink-0 mt-0.5`}>
                    {SENSITIVE_ACTIONS.includes(log.action) ? '⚠️' : '•'} {log.action}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{log.label || log.entity}</p>
                    <p className="text-xs text-gray-400">{log.actorName || log.actor}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{log.at.slice(11, 16)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Sensitive actions breakdown */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-4">الأنشطة الحساسة</h3>
            {SENSITIVE_ACTIONS.map(action => {
              const count = activityLogs.filter(l => l.action === action).length;
              const max = Math.max(...SENSITIVE_ACTIONS.map(a => activityLogs.filter(l => l.action === a).length), 1);
              if (count === 0) return null;
              return (
                <div key={action} className="flex items-center gap-3 mb-3">
                  <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${actionColors[action] || 'text-gray-600'} bg-gray-50 border border-gray-100 w-36 shrink-0`}>{action}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.round(count / max * 100)}%` }} />
                  </div>
                  <span className="text-sm font-bold text-gray-700 w-5 text-right">{count}</span>
                </div>
              );
            })}
            {activityLogs.filter(l => SENSITIVE_ACTIONS.includes(l.action)).length === 0 && (
              <p className="text-center text-gray-400 text-sm py-4">لا أنشطة حساسة</p>
            )}
          </div>
        </div>
      )}

      {/* Activity Log */}
      {subTab === 'activity' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute right-3 top-2.5 text-gray-400" />
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="بحث في السجلات..."
                className="w-full pr-8 pl-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
            </div>
            <select value={eventFilter} onChange={e => setEventFilter(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none">
              <option value="all">كل الأنشطة</option>
              {[...new Set(activityLogs.map(l => l.action))].slice(0, 20).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <span className="text-sm text-gray-400 self-center">{allAuditLogs.length} سجل</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-50">
              {allAuditLogs.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <Activity size={36} className="mx-auto mb-3 opacity-20" />
                  <p>لا سجلات</p>
                </div>
              ) : allAuditLogs.map(log => (
                <div key={log.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50">
                  <div className="flex items-center gap-1.5 shrink-0 w-36">
                    {SENSITIVE_ACTIONS.includes(log.action) ? <AlertTriangle size={11} className="text-amber-500" /> : <Activity size={11} className="text-gray-400" />}
                    <span className={`text-xs font-mono ${actionColors[log.action] || 'text-gray-500'}`}>{log.action}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 truncate">{log.label || log.entity}</p>
                    <p className="text-xs text-gray-400">{log.actorName || log.actor}</p>
                  </div>
                  {log.section && <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100 shrink-0">{log.section}</span>}
                  <span className="text-xs text-gray-400 shrink-0 w-32 text-left" dir="ltr">{log.at.slice(0, 16).replace('T', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* IP Whitelist */}
      {subTab === 'ip' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700 flex items-start gap-2">
            <Globe size={15} className="shrink-0 mt-0.5" />
            <p>قائمة عناوين IP المصرح لها بالوصول للنظام. هذه بيانات للمراجعة فقط — التطبيق الفعلي يتم على مستوى الخادم.</p>
          </div>
          {/* Add form */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
            <h3 className="font-bold text-gray-800 mb-3">إضافة IP جديد</h3>
            <div className="flex flex-wrap gap-3">
              <input value={newIp} onChange={e => setNewIp(e.target.value)} placeholder="192.168.1.1 أو 10.0.0.0/24"
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 flex-1 min-w-[150px]" dir="ltr" />
              <input value={newIpLabel} onChange={e => setNewIpLabel(e.target.value)} placeholder="وصف (مكتب، منزل...)"
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 flex-1 min-w-[150px]" />
              <button onClick={addIp} className="bg-slate-700 text-white px-5 py-2 rounded-xl font-bold text-sm hover:bg-slate-800 flex items-center gap-1.5">
                <Plus size={14} /> إضافة
              </button>
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-100">
              {ipList.map(entry => (
                <div key={entry.id} className={`flex items-center gap-3 px-4 py-3 ${!entry.active ? 'opacity-50' : ''}`}>
                  <Globe size={14} className={entry.active ? 'text-green-500' : 'text-gray-400'} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-700">{entry.ip}</span>
                      <span className="text-xs text-gray-500">{entry.label}</span>
                    </div>
                    <p className="text-xs text-gray-400">أضيف {entry.addedAt.slice(0, 10)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${entry.active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                    {entry.active ? '● نشط' : 'معطل'}
                  </span>
                  <button onClick={async () => {
                      try {
                        const r = await fetch(`/api/admin/ip-whitelist/${entry.id}`, { method: 'DELETE', credentials: 'include' });
                        if (!r.ok) throw new Error('del');
                        await reloadIps();
                        notify('success', 'تم حذف IP');
                      } catch { notify('error', 'فشل حذف IP'); }
                    }}
                    className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              ))}
              {ipList.length === 0 && <div className="py-8 text-center text-gray-400 text-sm">لا إدخالات</div>}
            </div>
          </div>
        </div>
      )}

      {/* Access Review */}
      {subTab === 'access' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
            <h3 className="font-bold text-gray-800">مراجعة صلاحيات الوصول</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {staffAccessReview.length === 0 ? (
              <div className="py-12 text-center text-gray-400">لا بيانات</div>
            ) : staffAccessReview.map(({ member, actionCount, lastActivity, sensitive, suspicious }) => (
              <div key={member.id} className={`flex items-center gap-3 px-4 py-3 ${suspicious ? 'bg-red-50' : ''}`}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${suspicious ? 'bg-red-500' : member.status === 'active' ? 'bg-slate-600' : 'bg-gray-400'}`}>
                  {member.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm text-gray-800">{member.name}</span>
                    {suspicious && <span className="text-xs bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle size={10} /> مشبوه</span>}
                    {sensitive > 0 && <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">{sensitive} حساسة</span>}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {actionCount} نشاط
                    {lastActivity && <> · آخر نشاط: {lastActivity.at.slice(0, 16).replace('T', ' ')}</>}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-gray-700">{member.permissions?.length || 0}</div>
                  <div className="text-xs text-gray-400">صلاحية</div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${member.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                    {member.status === 'active' ? 'نشط' : 'معطل'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityDashboardTab;
