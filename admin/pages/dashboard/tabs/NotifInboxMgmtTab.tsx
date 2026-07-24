import { useEffect, useMemo, useState } from 'react';
import { Bell, Check, CheckCheck, Trash2, Search, Clock } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

type NotifRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  data_json?: string | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  system: 'النظام', lead: 'ليد', payment: 'دفع', subscriber: 'مشترك',
  staff: 'موظف', alert: 'تنبيه', reminder: 'تذكير', info: 'معلومة',
  ticket: 'تذكرة', hr: 'موارد بشرية', certificate: 'شهادة', warning: 'تحذير', broadcast: 'إعلان',
};
const TYPE_COLOR: Record<string, string> = {
  system: 'bg-gray-100 text-gray-600',
  lead: 'bg-blue-100 text-blue-700',
  payment: 'bg-emerald-100 text-emerald-700',
  subscriber: 'bg-violet-100 text-violet-700',
  staff: 'bg-indigo-100 text-indigo-700',
  alert: 'bg-red-100 text-red-700',
  warning: 'bg-orange-100 text-orange-700',
  reminder: 'bg-amber-100 text-amber-700',
  info: 'bg-cyan-100 text-cyan-700',
  ticket: 'bg-sky-100 text-sky-700',
  hr: 'bg-pink-100 text-pink-700',
  certificate: 'bg-yellow-100 text-yellow-700',
  broadcast: 'bg-purple-100 text-purple-700',
};

// Connected to the REAL notification system (routes/notifications.js, the
// same `notifications` table the header bell polls) — this tab used to read
// SiteDataContext's `notifications`, which is actually the unrelated
// marketing-broadcast list, so nothing a user/lead/payment/ticket/HR event
// ever generated showed up here (NOT-01). Mutations now hit the server
// instead of only a local Set (NOT-02).
export default function NotifInboxMgmtTab({ notify }: { notify: NotifyFn }) {
  const [rows, setRows] = useState<NotifRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [searchQ, setSearchQ] = useState('');

  const load = () => {
    setLoading(true);
    mysqlAdmin.getNotifications()
      .then(res => setRows((res.rows as unknown as NotifRow[]) || []))
      .catch(() => notify('error', 'تعذر تحميل الإشعارات'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() =>
    rows.filter(n =>
      (typeFilter === 'all' || n.type === typeFilter) &&
      (!showUnreadOnly || !n.read_at) &&
      (!searchQ || (n.message || n.title || '').toLowerCase().includes(searchQ.toLowerCase()))
    ),
    [rows, typeFilter, showUnreadOnly, searchQ]
  );

  async function markRead(id: string) {
    try {
      await mysqlAdmin.markNotificationRead(id);
      setRows(prev => prev.map(n => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch { notify('error', 'تعذر تحديث الإشعار'); }
  }

  async function markAllRead() {
    try {
      await mysqlAdmin.markAllNotificationsRead();
      setRows(prev => prev.map(n => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
      notify('success', 'تم تعليم كل الإشعارات كمقروءة');
    } catch { notify('error', 'تعذر تحديث الإشعارات'); }
  }

  async function deleteNotif(id: string) {
    try {
      await mysqlAdmin.deleteNotification(id);
      setRows(prev => prev.filter(n => n.id !== id));
    } catch { notify('error', 'تعذر حذف الإشعار'); }
  }

  const unreadCount = rows.filter(n => !n.read_at).length;
  const types = [...new Set(rows.map(n => n.type).filter(Boolean))];

  function timeAgo(dt: string) {
    if (!dt) return '';
    const diff = Date.now() - new Date(dt).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `منذ ${d} يوم`;
    if (h > 0) return `منذ ${h} ساعة`;
    if (m > 0) return `منذ ${m} دقيقة`;
    return 'الآن';
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-amber-500 to-yellow-500 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Bell size={22} />صندوق الإشعارات
              {unreadCount > 0 && (
                <span className="bg-white text-amber-600 text-xs font-extrabold px-2 py-0.5 rounded-full">{unreadCount}</span>
              )}
            </h2>
            <p className="text-amber-100 text-sm mt-1">إدارة جميع الإشعارات والتنبيهات</p>
          </div>
          {unreadCount > 0 && (
            <button onClick={() => { void markAllRead(); }} className="flex items-center gap-1 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-bold transition">
              <CheckCheck size={14} />تعليم الكل كمقروء
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute right-3 top-2.5 text-gray-400" />
          <input value={searchQ} onChange={e => setSearchQ(e.target.value)}
            placeholder="بحث في الإشعارات..."
            className="w-full border border-gray-200 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300" />
        </div>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
          <option value="all">كل الأنواع ({rows.length})</option>
          {types.map(t => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
        </select>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showUnreadOnly} onChange={e => setShowUnreadOnly(e.target.checked)} className="accent-amber-500" />
          <span className="text-sm text-gray-600">غير المقروء فقط</span>
        </label>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'إجمالي الإشعارات', val: rows.length, color: 'gray' },
          { label: 'غير مقروء', val: unreadCount, color: 'amber' },
          { label: 'مقروء', val: rows.length - unreadCount, color: 'emerald' },
          { label: 'المعروض', val: filtered.length, color: 'blue' },
        ].map(k => (
          <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
            <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
            <div className="text-xs text-gray-500 mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Notifications list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              <div className="w-8 h-8 border-4 border-amber-200 border-t-amber-500 rounded-full animate-spin mx-auto mb-3" />
              <p>جارٍ التحميل...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Bell size={36} className="mx-auto mb-3 text-gray-200" />
              <p>لا توجد إشعارات</p>
            </div>
          ) : (
            filtered.map(n => {
              const isRead = !!n.read_at;
              return (
                <div key={n.id} className={`flex items-start gap-3 px-4 py-4 hover:bg-gray-50 transition ${!isRead ? 'bg-amber-50/40' : ''}`}>
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${!isRead ? 'bg-amber-500' : 'bg-gray-200'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {n.title && <div className={`text-sm font-bold ${!isRead ? 'text-gray-900' : 'text-gray-600'}`}>{n.title}</div>}
                        <div className={`text-sm ${!isRead ? 'text-gray-800' : 'text-gray-500'} mt-0.5`}>{n.message || '—'}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {n.type && (
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${TYPE_COLOR[n.type] || 'bg-gray-100 text-gray-600'}`}>
                              {TYPE_LABEL[n.type] || n.type}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 flex items-center gap-1">
                            <Clock size={9} />{timeAgo(n.created_at || '')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!isRead && (
                          <button onClick={() => { void markRead(n.id); }} className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition" title="تعليم كمقروء">
                            <Check size={13} />
                          </button>
                        )}
                        <button onClick={() => { void deleteNotif(n.id); }} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition" title="حذف">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
