import React, { useState } from 'react';
import { Activity, Search } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';

interface Props {
  isSalesOnly: boolean;
}

const ActivityTab: React.FC<Props> = ({ isSalesOnly }) => {
  const {
    activityLogs,
    isAdmin,
    clearAllData,
    courses,
    bundles,
    lectures,
    chapters,
    therapists,
    testimonials,
    subscribers,
    leads,
    staffMembers,
    consultations,
    orders,
    communityPosts,
    communityLibraryItems,
    communityVideos,
    communityEvents,
    discounts,
    content,
  } = useSiteData();

  // Online users — no longer tracked (always empty)
  const onlineUsers: { uid: string; email?: string; displayName?: string; lastActiveAt: string }[] = [];

  const [activitySearch, setActivitySearch] = useState('');
  const [activityFilterActor, setActivityFilterActor] = useState('');
  const [activityFilterSection, setActivityFilterSection] = useState('');
  const [activityFilterDateFrom, setActivityFilterDateFrom] = useState('');
  const [activityFilterDateTo, setActivityFilterDateTo] = useState('');

  const sectionColors: Record<string, string> = {
    'إدارة الأكاديمية': 'bg-blue-50 text-blue-700 border-blue-200',
    'إدارة العملاء': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'الاستشارات': 'bg-sky-50 text-sky-700 border-sky-200',
    'المحاضرون': 'bg-violet-50 text-violet-700 border-violet-200',
    'المالية': 'bg-amber-50 text-amber-700 border-amber-200',
    'إدارة الفريق': 'bg-rose-50 text-rose-700 border-rose-200',
    'إعدادات الموقع': 'bg-gray-100 text-gray-600 border-gray-200',
    'المجتمع': 'bg-pink-50 text-pink-700 border-pink-200',
    'عام': 'bg-gray-50 text-gray-500 border-gray-100',
  };
  const actionIcons: Record<string, string> = {
    create: '➕', update: '✏️', delete: '🗑️', login: '🔑', logout: '🚪', bulk: '📦',
  };
  const actionColors: Record<string, string> = {
    create: 'text-emerald-600 font-bold', update: 'text-blue-600 font-bold',
    delete: 'text-red-600 font-bold', login: 'text-purple-600 font-bold',
  };

  // Unique actors from logs
  const allActors = [...new Set(activityLogs.map(l => l.actorName || l.actor || '').filter(Boolean))];
  const allSections = [...new Set(activityLogs.map(l => l.section || 'عام').filter(Boolean))];

  // Apply filters
  const filteredLogs = activityLogs.filter(row => {
    if (activityFilterActor && (row.actorName || row.actor || '') !== activityFilterActor) return false;
    if (activityFilterSection && (row.section || 'عام') !== activityFilterSection) return false;
    if (activitySearch) {
      const q = activitySearch.toLowerCase();
      if (!`${row.action} ${row.entity} ${row.label} ${row.actor || ''} ${row.actorName || ''}`.toLowerCase().includes(q)) return false;
    }
    if (activityFilterDateFrom || activityFilterDateTo) {
      const rowDate = (row.at || '').slice(0, 10);
      if (activityFilterDateFrom && rowDate < activityFilterDateFrom) return false;
      if (activityFilterDateTo && rowDate > activityFilterDateTo) return false;
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Online Now */}
      {isAdmin && onlineUsers.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2 text-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
            متصل الآن ({onlineUsers.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {onlineUsers.map(u => (
              <div key={u.uid} className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2 text-xs">
                <div className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center font-bold flex-shrink-0">
                  {(u.displayName || u.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-gray-800 leading-none">{u.displayName || u.email || u.uid.slice(0, 8)}</p>
                  <p className="text-gray-400 mt-0.5">{new Date(u.lastActiveAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main log card */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-gray-800 to-gray-700 px-5 py-4 text-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-extrabold text-lg flex items-center gap-2"><Activity size={18} />سجل النظام</h3>
            <p className="text-xs text-gray-300 mt-0.5">{filteredLogs.length} حركة {activityLogs.length !== filteredLogs.length ? `(من إجمالي ${activityLogs.length})` : ''}</p>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <button
                onClick={() => {
                  const now = new Date();
                  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                  const backup = { _meta: { createdAt: now.toISOString(), version: '1.0' }, courses, bundles, lectures, chapters, therapists, testimonials, subscribers, leads, staffMembers, consultations, orders, communityPosts, communityLibraryItems, communityVideos, communityEvents, discounts, content };
                  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a'); a.href = url; a.download = `backup_full_site_${stamp}.json`; a.click(); URL.revokeObjectURL(url);
                }}
                className="bg-green-500/20 border border-green-400/30 text-green-100 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-green-500/30 flex items-center gap-1.5"
              >💾 نسخة احتياطية</button>
            )}
            {!isSalesOnly && (
              <button
                onClick={() => {
                  if (!window.confirm('⚠️ سيتم مسح جميع البيانات. هل أنت متأكد؟')) return;
                  const typed = window.prompt('اكتب كلمة "حذف" للتأكيد:');
                  if (typed?.trim() !== 'حذف') { window.alert('تم الإلغاء.'); return; }
                  clearAllData();
                }}
                className="bg-red-500/20 border border-red-400/30 text-red-200 px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-red-500/30"
              >استعادة الافتراضي</button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex flex-wrap gap-2 items-center">
          <div className="relative shrink-0" style={{ minWidth: '180px' }}>
            <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="w-full border border-gray-300 rounded-lg pr-8 pl-3 py-1.5 text-xs bg-white focus:outline-none focus:border-primary-400" placeholder="بحث في السجل..." value={activitySearch} onChange={e => setActivitySearch(e.target.value)} />
          </div>
          <select className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white shrink-0" value={activityFilterSection} onChange={e => setActivityFilterSection(e.target.value)}>
            <option value="">كل الأقسام</option>
            {allSections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white shrink-0" value={activityFilterActor} onChange={e => setActivityFilterActor(e.target.value)}>
            <option value="">كل الموظفين</option>
            {allActors.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <input type="date" className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white shrink-0" value={activityFilterDateFrom} onChange={e => setActivityFilterDateFrom(e.target.value)} />
          <span className="text-xs text-gray-400 shrink-0">→</span>
          <input type="date" className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white shrink-0" value={activityFilterDateTo} onChange={e => setActivityFilterDateTo(e.target.value)} />
          {(activitySearch || activityFilterActor || activityFilterSection || activityFilterDateFrom || activityFilterDateTo) && (
            <button onClick={() => { setActivitySearch(''); setActivityFilterActor(''); setActivityFilterSection(''); setActivityFilterDateFrom(''); setActivityFilterDateTo(''); }}
              className="text-xs text-gray-500 hover:text-red-600 border border-gray-300 bg-white rounded-lg px-2 py-1.5 shrink-0">× مسح</button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm" dir="rtl">
            <thead className="bg-gray-50/80 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-600">الإجراء</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-600">القسم</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-600">التفاصيل</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-600">المسؤول</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-600">التوقيت</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">لا توجد سجلات تطابق الفلتر.</td></tr>
              ) : filteredLogs.map((row, idx) => (
                <tr key={row.id} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                  <td className="px-4 py-3">
                    <span className={`flex items-center gap-1.5 text-xs ${actionColors[row.action] || 'text-gray-700 font-medium'}`}>
                      <span>{actionIcons[row.action] || '•'}</span>
                      {row.action === 'create' ? 'إضافة' : row.action === 'update' ? 'تعديل' : row.action === 'delete' ? 'حذف' : row.action}
                    </span>
                    <span className="text-[10px] text-gray-400 block mt-0.5">{row.entity}</span>
                  </td>
                  <td className="px-4 py-3">
                    {row.section && (
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${sectionColors[row.section] || sectionColors['عام']}`}>
                        {row.section}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700 max-w-[220px] truncate" title={row.label}>{row.label}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                        {(row.actorName || row.actor || '?')[0].toUpperCase()}
                      </div>
                      <span className="text-xs text-gray-600 truncate max-w-[100px]">{row.actorName || row.actor?.split('@')[0] || '—'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{row.at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ActivityTab;
