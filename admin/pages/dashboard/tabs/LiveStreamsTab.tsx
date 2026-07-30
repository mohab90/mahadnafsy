import React, { useState } from 'react';
import { Calendar, Plus, Save, Users, Video } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import type { LiveStream } from '../../../types';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
}

type LiveStreamDraft = Omit<LiveStream, 'id' | 'createdAt'>;

const blankLiveStreamDraft = (): LiveStreamDraft => ({
  title: '',
  instructorName: '',
  scheduledAt: new Date().toISOString().slice(0, 16),
  durationMinutes: 60,
  streamUrl: '',
  platform: 'zoom',
  visibility: 'all_subscribers',
  targetCourseIds: [],
  status: 'upcoming',
  description: '',
});

const LiveStreamsTab: React.FC<Props> = ({ notify }) => {
  const { liveStreams, addLiveStream, updateLiveStream, deleteLiveStream, courses } = useSiteData();

  const [lsEdit, setLsEdit] = useState<LiveStream | null>(null);
  const [lsDraft, setLsDraft] = useState<LiveStreamDraft>(blankLiveStreamDraft());
  const [lsFormOpen, setLsFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSaveLiveStream = async () => {
    const now = new Date().toISOString();
    setSaving(true);
    const saved = lsEdit
      ? await updateLiveStream({ ...lsEdit, ...lsDraft })
      : await addLiveStream({ ...lsDraft, id: `ls-${Date.now()}`, createdAt: now });
    setSaving(false);
    if (!saved) { notify('error', 'تعذر حفظ البث المباشر.'); return; }
    setLsFormOpen(false); setLsEdit(null); setLsDraft(blankLiveStreamDraft());
    notify('success', 'تم حفظ البث المباشر.');
  };

  const visLabel = (v: LiveStream['visibility'], ids: string[]) => {
    if (v === 'all_subscribers') return { t: 'كل المشتركين', c: 'bg-green-50 text-green-700' };
    if (v === 'course_subscribers') return { t: `كورسات (${ids.length})`, c: 'bg-amber-50 text-amber-700' };
    if (v === 'community_all') return { t: 'كل المجتمع', c: 'bg-purple-50 text-purple-700' };
    return { t: 'المجتمع + المشتركين', c: 'bg-blue-50 text-blue-700' };
  };

  const sorted = [...liveStreams].sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex justify-between items-center">
        <h3 className="font-extrabold text-gray-800 text-base flex items-center gap-2"><Video size={18} className="text-primary-600" />البث المباشر ({liveStreams.length})</h3>
        <button onClick={() => { setLsFormOpen(true); setLsEdit(null); setLsDraft(blankLiveStreamDraft()); }}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-bold px-4 py-2 rounded-xl text-sm transition">
          <Plus size={15} />إضافة بث جديد
        </button>
      </div>
      {lsFormOpen && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
          <h4 className="font-bold text-gray-800">{lsEdit ? 'تعديل البث المباشر' : 'بث مباشر جديد'}</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="text-xs font-bold text-gray-600 mb-1 block">عنوان البث *</label><input value={lsDraft.title} onChange={e => setLsDraft(d => ({ ...d, title: e.target.value }))} placeholder="مثال: محاضرة علم النفس الإيجابي" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none" /></div>
            <div><label className="text-xs font-bold text-gray-600 mb-1 block">اسم المحاضر *</label><input value={lsDraft.instructorName} onChange={e => setLsDraft(d => ({ ...d, instructorName: e.target.value }))} placeholder="اسم المحاضر" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none" /></div>
            <div><label className="text-xs font-bold text-gray-600 mb-1 block">موعد البث *</label><input type="datetime-local" value={lsDraft.scheduledAt} onChange={e => setLsDraft(d => ({ ...d, scheduledAt: e.target.value }))} className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none" /></div>
            <div><label className="text-xs font-bold text-gray-600 mb-1 block">المدة (دقيقة)</label><input type="number" value={lsDraft.durationMinutes || ''} onChange={e => setLsDraft(d => ({ ...d, durationMinutes: Number(e.target.value) }))} placeholder="60" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none" /></div>
            <div className="md:col-span-2"><label className="text-xs font-bold text-gray-600 mb-1 block">رابط البث *</label><input type="url" value={lsDraft.streamUrl} onChange={e => setLsDraft(d => ({ ...d, streamUrl: e.target.value }))} placeholder="https://zoom.us/j/... أو https://youtube.com/live/..." className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none" dir="ltr" /></div>
            <div><label className="text-xs font-bold text-gray-600 mb-1 block">المنصة</label><select value={lsDraft.platform} onChange={e => setLsDraft(d => ({ ...d, platform: e.target.value as LiveStream['platform'] }))} className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none"><option value="zoom">Zoom</option><option value="youtube">YouTube Live</option><option value="meet">Google Meet</option><option value="other">أخرى</option></select></div>
            <div><label className="text-xs font-bold text-gray-600 mb-1 block">الحالة</label><select value={lsDraft.status} onChange={e => setLsDraft(d => ({ ...d, status: e.target.value as LiveStream['status'] }))} className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none"><option value="upcoming">📅 قادم</option><option value="live">🔴 مباشر الآن</option><option value="ended">✔ انتهى</option></select></div>
            <div className="md:col-span-2"><label className="text-xs font-bold text-gray-600 mb-1 block">الظهور للمشتركين</label><select value={lsDraft.visibility} onChange={e => setLsDraft(d => ({ ...d, visibility: e.target.value as LiveStream['visibility'], targetCourseIds: [] }))} className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none"><option value="all_subscribers">كل المشتركين</option><option value="course_subscribers">مشتركين كورسات محددة</option><option value="community_all">كل أعضاء المجتمع</option><option value="community_and_subscribers">المجتمع + المشتركين</option></select></div>
            {lsDraft.visibility === 'course_subscribers' && (
              <div className="md:col-span-2">
                <label className="text-xs font-bold text-gray-600 mb-1 block">الكورسات المستهدفة</label>
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto border border-gray-200 rounded-xl p-3">
                  {courses.map(course => (
                    <label key={course.id} className="flex items-center gap-2 cursor-pointer text-xs">
                      <input type="checkbox" checked={lsDraft.targetCourseIds.includes(String(course.id))} onChange={e => setLsDraft(d => ({ ...d, targetCourseIds: e.target.checked ? [...d.targetCourseIds, String(course.id)] : d.targetCourseIds.filter(id => id !== String(course.id)) }))} />
                      <span className="line-clamp-1 text-gray-700">{course.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="md:col-span-2"><label className="text-xs font-bold text-gray-600 mb-1 block">وصف (اختياري)</label><textarea value={lsDraft.description || ''} onChange={e => setLsDraft(d => ({ ...d, description: e.target.value }))} rows={2} placeholder="تفاصيل إضافية..." className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none resize-none" /></div>
            {lsDraft.status === 'ended' && <div className="md:col-span-2"><label className="text-xs font-bold text-gray-600 mb-1 block">رابط التسجيل</label><input type="url" value={lsDraft.recordingUrl || ''} onChange={e => setLsDraft(d => ({ ...d, recordingUrl: e.target.value }))} placeholder="https://..." dir="ltr" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:border-primary-400 focus:outline-none" /></div>}
          </div>
          <div className="flex gap-3">
            <button onClick={() => void handleSaveLiveStream()} disabled={saving || !lsDraft.title || !lsDraft.streamUrl || !lsDraft.instructorName} className="flex-1 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition text-sm flex items-center justify-center gap-2"><Save size={15} />{lsEdit ? 'تحديث البث' : 'حفظ البث'}</button>
            <button onClick={() => { setLsFormOpen(false); setLsEdit(null); }} className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-sm transition">إلغاء</button>
          </div>
        </div>
      )}
      {sorted.length === 0 && !lsFormOpen ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-12 text-center shadow-sm"><Video size={40} className="text-gray-200 mx-auto mb-4" /><p className="text-gray-500 font-bold">لا توجد بثوث مباشرة مضافة بعد</p></div>
      ) : (
        <div className="space-y-3">
          {sorted.map(ls => {
            const vl = visLabel(ls.visibility, ls.targetCourseIds);
            return (
              <div key={ls.id} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col sm:flex-row gap-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${ls.status === 'live' ? 'bg-red-100' : ls.status === 'upcoming' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  <Video size={20} className={ls.status === 'live' ? 'text-red-600' : ls.status === 'upcoming' ? 'text-blue-600' : 'text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="font-bold text-gray-900 text-sm">{ls.title}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ls.status === 'live' ? 'bg-red-100 text-red-700' : ls.status === 'upcoming' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{ls.status === 'live' ? '🔴 مباشر الآن' : ls.status === 'upcoming' ? '📅 قادم' : '✔ انتهى'}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${vl.c}`}>{vl.t}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    <span><Users size={11} className="inline ml-0.5" />{ls.instructorName}</span>
                    <span><Calendar size={11} className="inline ml-0.5" />{ls.scheduledAt.replace('T', ' ').slice(0, 16)}</span>
                    {ls.durationMinutes && <span>{ls.durationMinutes} دقيقة</span>}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <a href={ls.streamUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] bg-primary-50 text-primary-700 font-bold px-3 py-1 rounded-lg hover:bg-primary-100 transition">🔗 رابط البث</a>
                    {ls.recordingUrl && <a href={ls.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] bg-gray-100 text-gray-700 font-bold px-3 py-1 rounded-lg hover:bg-gray-200 transition">▶ التسجيل</a>}
                  </div>
                </div>
                <div className="flex flex-col gap-2 flex-shrink-0">
                  <button onClick={() => { setLsEdit(ls); setLsDraft({ ...ls }); setLsFormOpen(true); }} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-3 py-1.5 rounded-lg transition">✏ تعديل</button>
                  <button onClick={() => { if (confirm('حذف هذا البث؟')) void deleteLiveStream(ls.id).then(ok => notify(ok ? 'success' : 'error', ok ? 'تم حذف البث.' : 'تعذر حذف البث.')); }} className="text-xs bg-red-50 hover:bg-red-100 text-red-600 font-bold px-3 py-1.5 rounded-lg border border-red-200 transition">🗑 حذف</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default LiveStreamsTab;
