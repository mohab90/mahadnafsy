import React, { useState } from 'react';
import { NotificationBroadcast } from '../../../types';
import { useSiteData } from '../../../context/SiteDataContext';

const NotificationsAdminTab: React.FC = () => {
  const { notifications, addNotification, updateNotification, deleteNotification } = useSiteData();

  const [notifDraft, setNotifDraft] = useState({ title: '', body: '', type: 'info' as 'info' | 'offer' | 'update' });
  const [editingNotifId, setEditingNotifId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cancelNotifEdit = () => {
    setEditingNotifId('');
    setNotifDraft({ title: '', body: '', type: 'info' });
  };

  const saveNotif = async () => {
    if (!notifDraft.title.trim() || !notifDraft.body.trim()) { alert('العنوان والنص مطلوبان'); return; }
    setSaving(true);
    setError('');
    try {
      if (editingNotifId) {
        const existing = notifications.find(n => n.id === editingNotifId);
        await updateNotification({ ...notifDraft, id: editingNotifId, createdAt: existing?.createdAt || new Date().toISOString(), active: existing?.active ?? true });
      } else {
        await addNotification({ ...notifDraft, id: `notif-${Date.now()}`, createdAt: new Date().toISOString(), active: true });
      }
      cancelNotifEdit();
    } catch {
      setError('تعذر حفظ الإشعار. لم يتم تغيير النسخة المنشورة للعملاء.');
    } finally {
      setSaving(false);
    }
  };

  const mutateNotification = async (action: () => Promise<void>) => {
    setSaving(true);
    setError('');
    try { await action(); }
    catch { setError('تعذر تحديث الإشعار. لم يتم تغيير النسخة المنشورة للعملاء.'); }
    finally { setSaving(false); }
  };

  const startEditNotif = (n: NotificationBroadcast) => {
    setEditingNotifId(n.id);
    setNotifDraft({ title: n.title, body: n.body, type: n.type });
  };

  const typeColors: Record<string, string> = { info: 'bg-blue-100 text-blue-700', offer: 'bg-emerald-100 text-emerald-700', update: 'bg-purple-100 text-purple-700' };
  const typeLabels: Record<string, string> = { info: 'معلومات', offer: 'عرض', update: 'تحديث' };

  return (
    <div className="space-y-5 animate-fade-in" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-600 to-purple-600 rounded-2xl p-6 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold flex items-center gap-2">🔔 إشعارات المشتركين</h2>
            <p className="text-violet-100 text-sm mt-1">إرسال إشعارات وإعلانات لجميع المشتركين</p>
          </div>
          <div className="flex gap-3 text-center">
            <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black">{notifications.length}</p><p className="text-xs">إجمالي</p></div>
            <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black text-green-200">{notifications.filter(n => n.active).length}</p><p className="text-xs">نشطة</p></div>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <h3 className="font-bold text-gray-800 mb-4">{editingNotifId ? '✏️ تعديل الإشعار' : '➕ إرسال إشعار جديد'}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">عنوان الإشعار</label>
            <input type="text" placeholder="مثال: عرض خاص لعملائنا المميزين" value={notifDraft.title}
              onChange={e => setNotifDraft(p => ({ ...p, title: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">نوع الإشعار</label>
            <select value={notifDraft.type} onChange={e => setNotifDraft(p => ({ ...p, type: e.target.value as 'info' | 'offer' | 'update' }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400">
              <option value="info">معلومات</option>
              <option value="offer">عرض خاص</option>
              <option value="update">تحديث</option>
            </select>
          </div>
          <div className="sm:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">نص الإشعار</label>
            <textarea rows={3} placeholder="اكتب نص الإشعار هنا..." value={notifDraft.body}
              onChange={e => setNotifDraft(p => ({ ...p, body: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <button onClick={() => void saveNotif()} disabled={saving} className="px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white rounded-xl text-sm font-bold transition flex items-center gap-2">
            <span>{saving ? 'جارٍ الحفظ...' : editingNotifId ? '💾 حفظ التعديل' : '📢 إرسال الإشعار'}</span>
          </button>
          {editingNotifId && (
            <button onClick={cancelNotifEdit} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-bold transition">إلغاء</button>
          )}
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-bold text-gray-800 mb-4">الإشعارات المرسلة ({notifications.length})</h3>
        {notifications.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <div className="text-5xl mb-3">🔔</div>
            <p className="font-medium">لا يوجد إشعارات بعد</p>
            <p className="text-sm mt-1">استخدم الفورم أعلاه لإرسال أول إشعار للمشتركين</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...notifications].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(n => (
              <div key={n.id} className={`flex flex-col sm:flex-row sm:items-start gap-3 p-4 rounded-xl border transition ${editingNotifId === n.id ? 'border-violet-300 bg-violet-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-lg font-bold ${typeColors[n.type] || 'bg-gray-100 text-gray-600'}`}>{typeLabels[n.type] || n.type}</span>
                    {n.active ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-lg">نشط</span> : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-lg">موقف</span>}
                    <span className="text-xs text-gray-400">{n.createdAt?.slice(0, 10)}</span>
                  </div>
                  <p className="font-bold text-gray-800 text-sm">{n.title}</p>
                  <p className="text-gray-600 text-sm mt-1">{n.body}</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => startEditNotif(n)} className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition">تعديل</button>
                  <button disabled={saving} onClick={() => void mutateNotification(() => updateNotification({ ...n, active: !n.active }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${n.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                    {n.active ? 'وقف' : 'تفعيل'}
                  </button>
                  <button disabled={saving} onClick={() => { if (window.confirm('حذف هذا الإشعار؟')) void mutateNotification(() => deleteNotification(n.id)); }}
                    className="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition">حذف</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsAdminTab;
