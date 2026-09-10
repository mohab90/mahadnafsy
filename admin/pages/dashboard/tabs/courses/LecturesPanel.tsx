// Lectures and chapters for one course, plus its live-session link.
//
// Lifted out of CoursesTab.tsx with its own state — nine drafts, three handlers
// and the derived lecture list, none of it read by the other sections. The
// lectures, chapters and their writers come from useSiteData here.
//
// The selected course crosses the boundary because the dashboard owns it: the
// courses list opens this section already pointed at a course.
//
// The saving flag is its own, like the other panels. CoursesTab shares one
// saving with its courses section, so a course save disabled this form.

import { useEffect, useState } from 'react';
import { Plus, Save, Radio } from 'lucide-react';
import { useSiteData, useEnsureLectures } from '../../../../context/SiteDataContext';
import { CoursePrerequisitesPanel } from './CoursePrerequisitesPanel';
import { CourseCohortsPanel } from './CourseCohortsPanel';
import { CourseLectureList } from './CourseLectureList';
import type { CourseChapterItem } from '../../../../types';

const _vk = '\x6d\x68\x64\x2d\x6e\x61\x66\x73\x79\x2d\x32\x30\x32\x36';
const obfV = (u: string): string => { if (!u || u.startsWith('enc:')) return u; try { return 'enc:' + btoa(u.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _vk.charCodeAt(i % _vk.length))).join('')); } catch { return u; } };
const deobfV = (u: string): string => { if (!u || !u.startsWith('enc:')) return u; try { return atob(u.slice(4)).split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _vk.charCodeAt(i % _vk.length))).join(''); } catch { return u; } };

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function LecturesPanel({ lectureCourseId, setLectureCourseId, notify }: {
  lectureCourseId: string;
  setLectureCourseId: (id: string) => void;
  notify: NotifyFn;
}) {
  const { courses, lectures, addLecture, updateLecture, deleteLecture, getCourseLectures,
    chapters, addChapter, updateChapter, deleteChapter, getCourseChapters,
    updateCourse, isAdmin, subscribers } = useSiteData();

  // Lectures are not loaded at login any more — this screen is the lectures table.
  useEnsureLectures();
  const [saving, setSaving] = useState(false);
  const [expandedLectureCourses, setExpandedLectureCourses] = useState<Record<string, boolean>>({});
  const [expandedLectureChapters, setExpandedLectureChapters] = useState<Record<string, boolean>>({});
  const [editingLectureId, setEditingLectureId] = useState('');
  const [isLectureFormOpen, setIsLectureFormOpen] = useState(false);
  const [lectureDraft, setLectureDraft] = useState({ title: '', lectureType: 'recorded' as 'recorded' | 'live', videoUrl: '', duration: '', order: 1, thumbnail: '', chapterId: '' });
  const [editingChapterId, setEditingChapterId] = useState('');
  const [isChapterFormOpen, setIsChapterFormOpen] = useState(false);
  const [chapterDraft, setChapterDraft] = useState({ title: '', order: 1 });
  const [liveSessionDraft, setLiveSessionDraft] = useState('');
  useEffect(() => {
    setLiveSessionDraft(courses.find(course => course.id === lectureCourseId)?.liveSessionUrl || '');
  }, [lectureCourseId, courses]);

  const selectedCourseLectures = lectureCourseId ? getCourseLectures(lectureCourseId) : [];

  const startEditLecture = (row: typeof lectures[number]) => {
  setEditingLectureId(row.id);
  setIsLectureFormOpen(true);
  setLectureCourseId(row.courseId);
  setLectureDraft({
    title: row.title,
    lectureType: row.lectureType,
    videoUrl: deobfV(row.videoUrl),
    duration: row.duration,
    order: row.order,
    thumbnail: row.thumbnail || '',
    chapterId: row.chapterId || '',
  });
};

  const saveLecture = async () => {
  if (!lectureCourseId || !lectureDraft.title) return;
  const payload: import('../../../../types').CourseLectureItem = {
    id: editingLectureId || `lec-${Date.now()}`,
    courseId: lectureCourseId,
    title: lectureDraft.title,
    lectureType: lectureDraft.lectureType,
    videoUrl: obfV(lectureDraft.videoUrl),
    duration: lectureDraft.duration,
    order: Number(lectureDraft.order) || 1,
    thumbnail: lectureDraft.thumbnail || '',
    chapterId: lectureDraft.chapterId || undefined,
  };
  setSaving(true);
  const saved = editingLectureId ? await updateLecture(payload) : await addLecture(payload);
  setSaving(false);
  if (!saved) { notify('error', 'تعذر حفظ المحاضرة.'); return; }
  setEditingLectureId('');
  setIsLectureFormOpen(false);
  setLectureDraft({ title: '', lectureType: 'recorded', videoUrl: '', duration: '', order: 1, thumbnail: '', chapterId: '' });
  notify('success', 'تم حفظ المحاضرة.');
};

  const saveChapter = async () => {
  if (!lectureCourseId || !chapterDraft.title.trim()) { notify('error', 'اختر الكورس وأدخل عنوان الفصل.'); return; }
  const payload: CourseChapterItem = {
    id: editingChapterId || `ch-${Date.now()}`,
    courseId: lectureCourseId,
    title: chapterDraft.title,
    order: Number(chapterDraft.order) || 1,
  };
  setSaving(true);
  const saved = editingChapterId ? await updateChapter(payload) : await addChapter(payload);
  setSaving(false);
  if (!saved) { notify('error', 'تعذر حفظ الفصل.'); return; }
  setEditingChapterId('');
  setIsChapterFormOpen(false);
  setChapterDraft({ title: '', order: 1 });
  notify('success', 'تم حفظ الفصل.');
};

  return (
  <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <h3 className="font-bold text-gray-900">محاضرات الكورسات وإضافة محاضرة داخل الكورس</h3>
      <div className="flex items-center gap-2">
        {isAdmin && (
          <button
            onClick={() => {
              const now = new Date();
              const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
              const backup = { _meta: { createdAt: now.toISOString(), type: 'lectures' }, lectures, chapters };
              const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a'); a.href = url; a.download = `backup_lectures_${stamp}.json`; a.click();
              URL.revokeObjectURL(url);
            }}
            className="bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-green-100 transition flex items-center gap-1"
          >
            💾 نسخة احتياطية
          </button>
        )}
        <button
          onClick={() => {
            if (isLectureFormOpen && !editingLectureId) {
              setIsLectureFormOpen(false);
              return;
            }
            setEditingLectureId('');
            setLectureDraft({ title: '', lectureType: 'recorded', videoUrl: '', duration: '', order: 1, thumbnail: '', chapterId: '' });
            setIsLectureFormOpen(true);
          }}
          className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
        >
          <Plus size={16} className="inline ml-1" />
          {isLectureFormOpen ? 'إغلاق نموذج المحاضرة' : 'إضافة محاضرة'}
        </button>
      </div>
    </div>

    {isLectureFormOpen && (
      <div className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50/70 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={lectureCourseId} onChange={(e) => setLectureCourseId(e.target.value)}>
            <option value="">اختر الكورس</option>
            {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
          </select>
          <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={lectureDraft.chapterId} onChange={(e) => setLectureDraft({ ...lectureDraft, chapterId: e.target.value })}>
            <option value="">بدون فصل (غير مصنف)</option>
            {lectureCourseId && getCourseChapters(lectureCourseId).map((ch) => <option key={ch.id} value={ch.id}>{ch.order}. {ch.title}</option>)}
          </select>
          <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="عنوان المحاضرة" value={lectureDraft.title} onChange={(e) => setLectureDraft({ ...lectureDraft, title: e.target.value })} />
          <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={lectureDraft.lectureType} onChange={(e) => setLectureDraft({ ...lectureDraft, lectureType: e.target.value as 'recorded' | 'live' })}>
            <option value="recorded">مسجلة</option>
            <option value="live">لايف</option>
          </select>
          <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="المدة" value={lectureDraft.duration} onChange={(e) => setLectureDraft({ ...lectureDraft, duration: e.target.value })} />
          <input className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رابط الفيديو / Zoom" value={lectureDraft.videoUrl} onChange={(e) => setLectureDraft({ ...lectureDraft, videoUrl: e.target.value })} />
          <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الترتيب" value={lectureDraft.order} onChange={(e) => setLectureDraft({ ...lectureDraft, order: Number(e.target.value) })} />
          <input className="md:col-span-2 border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رابط صورة غلاف المحاضرة (اختياري)" value={lectureDraft.thumbnail} onChange={(e) => setLectureDraft({ ...lectureDraft, thumbnail: e.target.value })} />
        </div>
          <button onClick={() => void saveLecture()} disabled={saving} className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingLectureId ? 'تحديث المحاضرة' : 'إضافة محاضرة'}</button>
      </div>
    )}

    {/* Chapter management panel */}
    {lectureCourseId && (
      <div className="border border-purple-200 bg-purple-50 rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="font-bold text-purple-800 text-sm">فصول الكورس (Chapters)</p>
          <button type="button" onClick={() => { setEditingChapterId(''); setChapterDraft({ title: '', order: (getCourseChapters(lectureCourseId).length + 1) }); setIsChapterFormOpen(true); }} className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-bold">+ فصل جديد</button>
        </div>
        {isChapterFormOpen && (
          <div className="flex flex-wrap gap-2 items-center mb-3 bg-white border border-purple-200 rounded-xl p-3">
            <input className="flex-1 min-w-[180px] border border-purple-200 rounded-lg px-3 py-2 text-sm" placeholder="عنوان الفصل" value={chapterDraft.title} onChange={(e) => setChapterDraft({ ...chapterDraft, title: e.target.value })} />
            <input type="number" className="w-20 border border-purple-200 rounded-lg px-3 py-2 text-sm" placeholder="الترتيب" value={chapterDraft.order} onChange={(e) => setChapterDraft({ ...chapterDraft, order: Number(e.target.value) })} />
            <button type="button" onClick={() => void saveChapter()} disabled={saving} className="px-3 py-2 rounded-lg bg-purple-600 disabled:opacity-50 text-white text-sm font-bold">حفظ</button>
            <button type="button" onClick={() => { setIsChapterFormOpen(false); setEditingChapterId(''); setChapterDraft({ title: '', order: 1 }); }} className="px-3 py-2 rounded-lg bg-gray-200 text-gray-700 text-sm font-bold">إلغاء</button>
          </div>
        )}
        {getCourseChapters(lectureCourseId).length === 0 && !isChapterFormOpen && <p className="text-xs text-purple-400">لا توجد فصول لهذا الكورس. أضف فصلاً لتنظيم المحاضرات.</p>}
        <div className="space-y-2">
          {getCourseChapters(lectureCourseId).map((ch) => (
            <div key={ch.id} className="flex items-center justify-between bg-white border border-purple-200 rounded-xl px-3 py-2">
              <p className="text-sm text-gray-800 font-medium">{ch.order}. {ch.title}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setEditingChapterId(ch.id); setChapterDraft({ title: ch.title, order: ch.order }); setIsChapterFormOpen(true); }} className="text-xs px-2 py-1 rounded-lg bg-purple-50 text-purple-700 font-bold">تعديل</button>
                <button type="button" onClick={() => { void deleteChapter(ch.id).then(ok => notify(ok ? 'success' : 'error', ok ? 'تم حذف الفصل.' : 'تعذر حذف الفصل.')); }} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700 font-bold">حذف</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    )}
    {lectureCourseId && isAdmin && (
      <>
        <CoursePrerequisitesPanel courseId={lectureCourseId} courses={courses} notify={notify} />
        <CourseCohortsPanel courseId={lectureCourseId} courses={courses} subscribers={subscribers} notify={notify} />
      </>
    )}
    <CourseLectureList
      courses={courses}
      lectures={lectures}
      lectureCourseId={lectureCourseId}
      selectedCourseLectures={selectedCourseLectures}
      expandedLectureCourses={expandedLectureCourses}
      setExpandedLectureCourses={setExpandedLectureCourses}
      expandedLectureChapters={expandedLectureChapters}
      setExpandedLectureChapters={setExpandedLectureChapters}
      getCourseLectures={getCourseLectures}
      getCourseChapters={getCourseChapters}
      startEditLecture={startEditLecture}
      deleteLecture={async (id) => {
        const deleted = await deleteLecture(id);
        notify(deleted ? 'success' : 'error', deleted ? 'تم حذف المحاضرة.' : 'تعذر حذف المحاضرة.');
        return deleted;
      }}
    />

    {lectureCourseId && (
      <div className="mt-4 border border-rose-200 bg-rose-50 rounded-xl p-4">
        <h4 className="font-bold text-rose-800 mb-2">البث المباشر للمشتركين</h4>
        <p className="text-xs text-rose-700 mb-3">يمكنك استخدام رابط اللايف المحفوظ في الكورس لبث مباشر للعملاء المشتركين فقط.</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            className="flex-1 min-w-[220px] border border-rose-200 rounded-lg px-3 py-2 text-sm"
            placeholder="رابط اللايف"
            value={liveSessionDraft}
            onChange={(e) => setLiveSessionDraft(e.target.value)}
          />
          <button
            disabled={saving}
            onClick={() => {
              const targetCourse = courses.find(course => course.id === lectureCourseId);
              if (!targetCourse) return;
              setSaving(true);
              void updateCourse({ ...targetCourse, liveSessionUrl: liveSessionDraft })
                .then(saved => notify(saved ? 'success' : 'error', saved ? 'تم حفظ رابط البث.' : 'تعذر حفظ رابط البث.'))
                .finally(() => setSaving(false));
            }}
            className="px-3 py-2 rounded-lg bg-white border border-rose-300 text-rose-700 disabled:opacity-50 text-sm font-bold"
          >
            <Save size={14} className="inline ml-1" />حفظ الرابط
          </button>
          <button
            onClick={() => {
              const url = courses.find((c) => c.id === lectureCourseId)?.liveSessionUrl;
              if (!url) {
                notify('error', 'لا يوجد رابط لايف محفوظ لهذا الكورس.');
                return;
              }
              window.open(url, '_blank');
            }}
            className="px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold"
          >
            <Radio size={14} className="inline ml-1" />بدء لايف الآن
          </button>
        </div>
      </div>
    )}
  </article>
  );
}
