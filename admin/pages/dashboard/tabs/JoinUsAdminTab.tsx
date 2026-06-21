import React, { useState } from 'react';
import { JoinUsApplication } from '../../../types';
import { useSiteData } from '../../../context/SiteDataContext';

const JoinUsAdminTab: React.FC = () => {
  const { joinUsApplications, updateJoinUsApplication, deleteJoinUsApplication } = useSiteData();

  const [juSearch, setJuSearch] = useState('');
  const [juStatusFilter, setJuStatusFilter] = useState<'all' | 'new' | 'reviewed' | 'accepted' | 'rejected'>('all');
  const [juTypeFilter, setJuTypeFilter] = useState<'all' | 'instructor' | 'consultant' | 'employee'>('all');
  const typeLabel = (t: string) => ({ instructor: 'مدرب', consultant: 'مستشار', employee: 'موظف' }[(t || '').toLowerCase()] || t);

  const statusCfg: Record<JoinUsApplication['status'], { label: string; cls: string }> = {
    new: { label: 'جديد', cls: 'bg-blue-100 text-blue-700' },
    pending: { label: 'قيد الانتظار', cls: 'bg-gray-100 text-gray-700' },
    reviewed: { label: 'قيد المراجعة', cls: 'bg-amber-100 text-amber-700' },
    accepted: { label: 'مقبول', cls: 'bg-emerald-100 text-emerald-700' },
    rejected: { label: 'مرفوض', cls: 'bg-red-100 text-red-700' },
  };

  const filteredApps = joinUsApplications.filter(app => {
    const q = juSearch.toLowerCase();
    const matchQ = !q || app.name.toLowerCase().includes(q) || app.email.toLowerCase().includes(q) || app.specialty.toLowerCase().includes(q);
    const matchStatus = juStatusFilter === 'all' || app.status === juStatusFilter;
    const matchType = juTypeFilter === 'all' || (app.type || '').toLowerCase() === juTypeFilter;
    return matchQ && matchStatus && matchType;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-5 animate-fade-in" dir="rtl">
      <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-2xl p-6 text-white">
        <h2 className="text-2xl font-extrabold flex items-center gap-2">🎓 طلبات الانضمام</h2>
        <p className="text-indigo-100 text-sm mt-1">مراجعة وإدارة طلبات المدربين والمستشارين والموظفين</p>
        <div className="flex gap-3 mt-4 flex-wrap text-center">
          {(['new', 'reviewed', 'accepted', 'rejected'] as JoinUsApplication['status'][]).map(s => (
            <div key={s} className="bg-white/20 rounded-xl px-4 py-2">
              <p className="text-xl font-black">{joinUsApplications.filter(a => a.status === s).length}</p>
              <p className="text-xs">{statusCfg[s].label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input value={juSearch} onChange={e => setJuSearch(e.target.value)} placeholder="بحث بالاسم أو البريد أو التخصص..."
          className="flex-1 min-w-48 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        <select value={juTypeFilter} onChange={e => setJuTypeFilter(e.target.value as typeof juTypeFilter)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
          <option value="all">كل الأنواع</option>
          <option value="instructor">مدرب / محاضر</option>
          <option value="consultant">مستشار نفسي</option>
          <option value="employee">موظف (وظيفة إدارية)</option>
        </select>
        <select value={juStatusFilter} onChange={e => setJuStatusFilter(e.target.value as typeof juStatusFilter)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm">
          <option value="all">كل الحالات</option>
          {Object.entries(statusCfg).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Applications list */}
      {filteredApps.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center text-gray-400">
          <p className="text-5xl mb-3">📋</p>
          <p className="font-medium">{juSearch || juStatusFilter !== 'all' ? 'لا توجد نتائج مطابقة' : 'لا توجد طلبات انضمام بعد'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredApps.map(app => (
            <div key={app.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-lg font-bold ${statusCfg[app.status].cls}`}>{statusCfg[app.status].label}</span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-lg">{typeLabel(app.type)}</span>
                    <span className="text-xs text-gray-400">{app.createdAt?.slice(0, 10)}</span>
                  </div>
                  <h4 className="font-bold text-gray-800 text-lg leading-tight">{app.name}</h4>
                  <p className="text-sm text-gray-600 mt-0.5">{app.specialty}</p>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm text-gray-500">
                    <span>📧 {app.email}</span>
                    <span>📞 {app.phone}</span>
                    {app.experience && <span>🕐 {app.experience}</span>}
                  </div>
                  {app.message && <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-xl px-3 py-2">💬 {app.message}</p>}
                  {app.linkedin && <a href={app.linkedin} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">🔗 LinkedIn</a>}
                  {app.adminNote && (
                    <div className="mt-2 text-xs bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-amber-800">
                      📝 ملاحظة المشرف: {app.adminNote}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <select value={app.status} onChange={e => updateJoinUsApplication({ ...app, status: e.target.value as JoinUsApplication['status'] })}
                    className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold">
                    {Object.entries(statusCfg).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  <button onClick={() => {
                    const note = window.prompt('ملاحظة للمشرف (اختياري):', app.adminNote || '');
                    if (note !== null) updateJoinUsApplication({ ...app, adminNote: note || undefined });
                  }} className="px-3 py-2 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold hover:bg-amber-100">
                    {app.adminNote ? '✏️ تعديل الملاحظة' : '📝 إضافة ملاحظة'}
                  </button>
                  <button onClick={() => { if (window.confirm('حذف هذا الطلب نهائياً؟')) deleteJoinUsApplication(app.id); }}
                    className="px-3 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100">حذف</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default JoinUsAdminTab;
