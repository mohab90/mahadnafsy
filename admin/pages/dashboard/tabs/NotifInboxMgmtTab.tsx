import React, { useMemo, useState } from 'react';
import { Bell, Check, CheckCheck, Trash2, Filter, Search, Clock, User, Tag, RefreshCw } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const TYPE_LABEL: Record<string, string> = {
  system: 'النظام', lead: 'ليد', payment: 'دفع', subscription: 'اشتراك',
  staff: 'موظف', alert: 'تنبيه', reminder: 'تذكير', info: 'معلومة',
};
const TYPE_COLOR: Record<string, string> = {
  system: 'bg-gray-100 text-gray-600',
  lead: 'bg-blue-100 text-blue-700',
  payment: 'bg-emerald-100 text-emerald-700',
  subscription: 'bg-violet-100 text-violet-700',
  staff: 'bg-indigo-100 text-indigo-700',
  alert: 'bg-red-100 text-red-700',
  reminder: 'bg-amber-100 text-amber-700',
  info: 'bg-cyan-100 text-cyan-700',
};

export default function NotifInboxMgmtTab({ notify }: { notify: NotifyFn }) {
  const { notifications } = useSiteData();
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState('all');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

  const allNotifs = useMemo(() =>
    [...notifications]
      .filter(n => !deleted.has(n.id))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [notifications, deleted]
  );

  const filtered = useMemo(() =>
    allNotifs.filter(n =>
      (typeFilter === 'all' || n.type === typeFilter) &&
      (!showUnreadOnly || (!n.isRead && !readIds.has(n.id))) &&
      (!searchQ || (n.message || n.title || '').toLowerCase().includes(searchQ.toLowerCase()))
    ),
    [allNotifs, typeFilter, showUnreadOnly, searchQ, readIds]
  );

  function markRead(id: string) {
    setReadIds(prev => new Set([...prev, id]));
  }

  function markAllRead() {
    setReadIds(new Set(allNotifs.map(n => n.id)));
    notify('success', 'تم تعليم كل الإشعارات كمقروءة');
  }

  function deleteNotif(id: string) {
    setDeleted(prev => new Set([...prev, id]));
  }

  const unreadCount = allNotifs.filter(n => !n.isRead && !readIds.has(n.id)).length;
  const types = [...new Set(notifications.map(n => n.type).filter(Boolean))];

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
            <button onClick={markAllRead} className="flex items-center gap-1 px-3 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-xs font-bold transition">
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
          <option value="all">كل الأنواع ({allNotifs.length})</option>
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
          { label: 'إجمالي الإشعارات', val: allNotifs.length, color: 'gray' },
          { label: 'غير مقروء', val: unreadCount, color: 'amber' },
          { label: 'مقروء', val: allNotifs.length - unreadCount, color: 'emerald' },
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
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Bell size={36} className="mx-auto mb-3 text-gray-200" />
              <p>لا توجد إشعارات</p>
            </div>
          ) : (
            filtered.map(n => {
              const isRead = n.isRead || readIds.has(n.id);
              return (
                <div key={n.id} className={`flex items-start gap-3 px-4 py-4 hover:bg-gray-50 transition ${!isRead ? 'bg-amber-50/40' : ''}`}>
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${!isRead ? 'bg-amber-500' : 'bg-gray-200'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        {n.title && <div className={`text-sm font-bold ${!isRead ? 'text-gray-900' : 'text-gray-600'}`}>{n.title}</div>}
                        <div className={`text-sm ${!isRead ? 'text-gray-800' : 'text-gray-500'} mt-0.5`}>{n.message || n.body || '—'}</div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {n.type && (
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${TYPE_COLOR[n.type] || 'bg-gray-100 text-gray-600'}`}>
                              {TYPE_LABEL[n.type] || n.type}
                            </span>
                          )}
                          <span className="text-[10px] text-gray-400 flex items-center gap-1">
                            <Clock size={9} />{timeAgo(n.createdAt || '')}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!isRead && (
                          <button onClick={() => markRead(n.id)} className="p-1.5 text-amber-500 hover:bg-amber-50 rounded-lg transition" title="تعليم كمقروء">
                            <Check size={13} />
                          </button>
                        )}
                        <button onClick={() => deleteNotif(n.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition" title="حذف">
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
