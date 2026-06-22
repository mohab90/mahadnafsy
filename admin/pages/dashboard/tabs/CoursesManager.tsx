import React, { useRef, useEffect, useState } from 'react';
import { Plus, X, Radio, Users, Upload, Save, Search, BookOpen, Eye, Video, BarChart3, TrendingUp } from 'lucide-react';
import type { Course, CourseAccessSetting, CourseMaterial, Therapist, SubscriberItem, CourseLectureItem, CourseChapterItem } from '../../../types';
import { SafeHtml } from '../../../components/SafeHtml';

type RichField = 'shortDescription' | 'description';
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type Stats = { full: number; preview: number; limited: number };

interface Props {
  isAdmin: boolean;
  courses: Course[];
  therapists: Therapist[];
  subscribers: SubscriberItem[];
  chapters: CourseChapterItem[];
  lectures: CourseLectureItem[];
  instituteGalleryImages: string[];
  filteredCourses: Course[];
  courseDraft: Course; setCourseDraft: React.Dispatch<React.SetStateAction<Course>>;
  editingCourseId: string; setEditingCourseId: (v: string) => void;
  isCourseFormOpen: boolean; setIsCourseFormOpen: (v: boolean) => void;
  courseDetailsJson: string; setCourseDetailsJson: (v: string) => void;
  courseListSearch: string; setCourseListSearch: (v: string) => void;
  coursePainPoints: { left: string[]; right: string[] }; setCoursePainPoints: (v: { left: string[]; right: string[] }) => void;
  courseModulesDraft: { title: string; items: string[] }[]; setCourseModulesDraft: (v: { title: string; items: string[] }[]) => void;
  courseMaterialsDraft: CourseMaterial[]; setCourseMaterialsDraft: (v: CourseMaterial[]) => void;
  blankCourse: () => Course;
  slugify: (text: string) => string;
  normalizeAccessEntry: (entry?: CourseAccessSetting | 'preview' | 'full') => CourseAccessSetting;
  getCourseAccessStats: (courseId: string) => Stats;
  getCourseLectures: (courseId: string) => CourseLectureItem[];
  handleGalleryUpload: (files: FileList | null) => void;
  handleCertificateUpload: (files: FileList | null) => void;
  saveCourse: () => void;
  startEditCourse: (course: Course) => void;
  deleteCourse: (id: string) => void;
  updateCourse: (c: Course) => void;
  setLectureCourseId: (v: string) => void;
  setActiveTab: (tab: string) => void;
  setSubscriberCourseFilter: (v: string) => void;
  setAnalyticsCourseId: (v: string) => void;
  loadLessonAnalytics: (courseId: string) => void;
  notify: NotifyFn;
}

/** إدارة الكورسات — extracted from CoursesTab. Owns its rich-text (contentEditable)
 *  editor refs + commands + the seed-on-open effect. */
export default function CoursesManager(p: Props) {
  const {
    isAdmin, courses, therapists, subscribers, chapters, lectures, instituteGalleryImages, filteredCourses,
    courseDraft, setCourseDraft, editingCourseId, setEditingCourseId, isCourseFormOpen, setIsCourseFormOpen,
    courseDetailsJson, setCourseDetailsJson, courseListSearch, setCourseListSearch,
    coursePainPoints, setCoursePainPoints, courseModulesDraft, setCourseModulesDraft,
    courseMaterialsDraft, setCourseMaterialsDraft, blankCourse, slugify, normalizeAccessEntry,
    getCourseAccessStats, getCourseLectures, handleGalleryUpload, handleCertificateUpload,
    saveCourse, startEditCourse, deleteCourse, updateCourse, setLectureCourseId, setActiveTab,
    setSubscriberCourseFilter, setAnalyticsCourseId, loadLessonAnalytics, notify,
  } = p;

  // Rich-text editors (self-contained — refs + commands + seed-on-open effect)
  const [activeRichField, setActiveRichField] = useState<RichField>('shortDescription');
  const shortDescriptionRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const certificateInputRef = useRef<HTMLInputElement | null>(null);
  const getEditorRef = (field: RichField) => (field === 'shortDescription' ? shortDescriptionRef : descriptionRef);
  const focusEditor = (field: RichField) => { setActiveRichField(field); getEditorRef(field).current?.focus(); };
  const syncEditorContent = (field: RichField) => { const editor = getEditorRef(field).current; setCourseDraft((prev) => ({ ...prev, [field]: editor?.innerHTML || '' })); };
  const runEditorCommand = (command: string, value?: string) => { document.execCommand(command, false, value); syncEditorContent(activeRichField); getEditorRef(activeRichField).current?.focus(); };
  // Seed the contentEditable DOM from the draft when the form opens / target changes.
  useEffect(() => {
    if (isCourseFormOpen) {
      if (shortDescriptionRef.current) shortDescriptionRef.current.innerHTML = courseDraft.shortDescription || '';
      if (descriptionRef.current) descriptionRef.current.innerHTML = courseDraft.description || '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCourseFormOpen, editingCourseId]);

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-bold text-gray-900">إدارة الكورسات</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
                const backup = { _meta: { createdAt: now.toISOString(), type: 'courses' }, courses, chapters, lectures };
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `backup_courses_${stamp}.json`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-green-100 transition flex items-center gap-1"
            >
              💾 نسخة احتياطية
            </button>
          )}
          <button
            onClick={() => {
              if (isCourseFormOpen && !editingCourseId) { setIsCourseFormOpen(false); return; }
              setEditingCourseId('');
              setCourseDraft(blankCourse());
              setCourseDetailsJson('{}');
              setIsCourseFormOpen(true);
            }}
            className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
          >
            <Plus size={16} className="inline ml-1" />
            {isCourseFormOpen ? 'إغلاق نموذج الكورس' : 'إنشاء كورس جديد'}
          </button>
        </div>
      </div>

      {isCourseFormOpen ? (
        <div className="border border-gray-200 rounded-2xl p-4 mb-5 bg-gray-50/60 space-y-4 min-h-[78vh]">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-bold text-gray-900">{editingCourseId ? 'تعديل بيانات الكورس' : 'إنشاء كورس جديد'}</h4>
            <button
              onClick={() => {
                setEditingCourseId('');
                setCourseDraft(blankCourse());
                setCourseDetailsJson('{}');
                setIsCourseFormOpen(false);
              }}
              className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 text-sm"
            >
              <X size={14} className="inline ml-1" />
              إلغاء
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">عنوان الكورس (عربي)</label>
              <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.title} onChange={(e) => {
                const title = e.target.value;
                // Auto-fill the slug only while it's still the auto value (English title preferred as source).
                const autoSlug = !editingCourseId && (!courseDraft.slug || courseDraft.slug === slugify(courseDraft.titleEn || courseDraft.title))
                  ? slugify(courseDraft.titleEn || title)
                  : courseDraft.slug;
                setCourseDraft({ ...courseDraft, title, slug: autoSlug });
              }} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">
                اسم الكورس بالإنجليزية — <span className="text-amber-600 font-bold">يظهر على الشهادة</span>
              </label>
              <input
                className="w-full border border-amber-300 rounded-xl px-4 py-2.5 text-sm ltr bg-amber-50"
                dir="ltr"
                placeholder="e.g. Cognitive Behavioral Therapy Diploma"
                value={courseDraft.titleEn || ''}
                onChange={(e) => {
                  const titleEn = e.target.value;
                  // When the slug is still auto, upgrade it to the (more accurate) English-title slug.
                  const autoSlug = !editingCourseId && (!courseDraft.slug || courseDraft.slug === slugify(courseDraft.titleEn || courseDraft.title))
                    ? slugify(titleEn || courseDraft.title)
                    : courseDraft.slug;
                  setCourseDraft({ ...courseDraft, titleEn, slug: autoSlug });
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">
                رابط URL الكورس (Slug) — <span className="text-primary-600 font-bold">مهم للـ SEO</span>
              </label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm font-mono ltr"
                  dir="ltr"
                  placeholder="cognitive-behavioral-therapy"
                  value={courseDraft.slug || ''}
                  onChange={(e) => setCourseDraft({ ...courseDraft, slug: e.target.value.replace(/[^a-z0-9-]/g, '').toLowerCase() })}
                />
                <button
                  type="button"
                  onClick={() => setCourseDraft({ ...courseDraft, slug: slugify(courseDraft.titleEn || courseDraft.title) })}
                  className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-bold text-gray-700 border border-gray-300 whitespace-nowrap"
                >
                  توليد تلقائي
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">الرابط: /c/{courseDraft.slug || 'slug'}</p>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">
                أسماء بديلة / مرادفات <span className="text-blue-600 font-normal text-[10px]">(للمطابقة مع فيسبوك ليدز — افصل بين الأسماء بفاصلة)</span>
              </label>
              <input
                className="w-full border border-blue-200 rounded-xl px-4 py-2.5 text-sm bg-blue-50"
                placeholder="مثال: دبلومة CBT, كورس العلاج المعرفي السلوكي, CBT Diploma"
                value={(courseDraft.aliases || []).join(', ')}
                onChange={(e) => {
                  const aliases = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                  setCourseDraft({ ...courseDraft, aliases });
                }}
              />
              <p className="text-[10px] text-blue-500 mt-1">عند وصول ليد من فيسبوك بأي من هذه الأسماء، يتم ربطه تلقائياً بهذا الكورس</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">المحاضر (من قائمة المحاضرين)</label>
              <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.instructor} onChange={(e) => setCourseDraft({ ...courseDraft, instructor: e.target.value })}>
                <option value="">اختر المحاضر</option>
                {therapists.map((row) => <option key={row.id} value={row.name}>{row.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">رابط صورة الغلاف</label>
              <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.thumbnail} onChange={(e) => setCourseDraft({ ...courseDraft, thumbnail: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">مدة الكورس (مثال: 12 أسبوع)</label>
              <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.duration} onChange={(e) => setCourseDraft({ ...courseDraft, duration: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">تصنيف الكورس</label>
              <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.category} onChange={(e) => setCourseDraft({ ...courseDraft, category: e.target.value as Course['category'] })}>
                <option value="General">عام</option><option value="Therapy">علاج</option><option value="Diagnosis">تشخيص</option><option value="Child">أطفال</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">نوع الكورس</label>
              <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.type} onChange={(e) => setCourseDraft({ ...courseDraft, type: e.target.value as Course['type'] })}>
                <option value="Recorded">مسجل</option><option value="Live">لايف</option><option value="Mix">مختلط</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">السعر الحالي EGP (جنيه)</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.price.EGP} onChange={(e) => setCourseDraft({ ...courseDraft, price: { ...courseDraft.price, EGP: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">السعر قبل الخصم EGP (جنيه)</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.originalPrice.EGP} onChange={(e) => setCourseDraft({ ...courseDraft, originalPrice: { ...courseDraft.originalPrice, EGP: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">السعر الحالي SAR (ريال)</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.price.SAR} onChange={(e) => setCourseDraft({ ...courseDraft, price: { ...courseDraft.price, SAR: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">السعر قبل الخصم SAR (ريال)</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.originalPrice.SAR} onChange={(e) => setCourseDraft({ ...courseDraft, originalPrice: { ...courseDraft.originalPrice, SAR: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">السعر الحالي USD (دولار)</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.price.USD} onChange={(e) => setCourseDraft({ ...courseDraft, price: { ...courseDraft.price, USD: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">السعر قبل الخصم USD (دولار)</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.originalPrice.USD} onChange={(e) => setCourseDraft({ ...courseDraft, originalPrice: { ...courseDraft.originalPrice, USD: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">عدد الطلاب المتوقع</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.students} onChange={(e) => setCourseDraft({ ...courseDraft, students: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">مستوى الكورس</label>
              <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.level} onChange={(e) => setCourseDraft({ ...courseDraft, level: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">فيديو برومو الكورس (YouTube/Vimeo/MP4)</label>
              <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="https://..." value={courseDraft.promoVideoUrl || ''} onChange={(e) => setCourseDraft({ ...courseDraft, promoVideoUrl: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">رابط البث المباشر للمشتركين (Zoom/Meet/YouTube Live)</label>
              <div className="flex flex-wrap gap-2">
                <input className="flex-1 min-w-[220px] border border-gray-300 rounded-xl px-4 py-2.5" placeholder="https://..." value={courseDraft.liveSessionUrl || ''} onChange={(e) => setCourseDraft({ ...courseDraft, liveSessionUrl: e.target.value })} />
                <button
                  type="button"
                  onClick={() => {
                    if (!courseDraft.liveSessionUrl) { notify('error', 'أدخل رابط البث المباشر أولاً.'); return; }
                    window.open(courseDraft.liveSessionUrl, '_blank');
                  }}
                  className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold"
                >
                  <Radio size={14} className="inline ml-1" />
                  بدء لايف للمشتركين
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!courseDraft.id) { notify('info', 'احفظ الكورس أولاً لعرض العملاء المسجلين.'); return; }
                    setSubscriberCourseFilter(courseDraft.id);
                    setActiveTab('subscribers');
                  }}
                  className="px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-sm font-bold"
                >
                  <Users size={14} className="inline ml-1" />
                  العملاء المسجلين: {courseDraft.id ? subscribers.filter((sub) => sub.enrolledCourseIds.includes(courseDraft.id)).length : 0}
                </button>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">الوصف القصير (WYSIWYG)</label>
              <div className="border border-gray-300 rounded-xl bg-white overflow-hidden">
                <div className="flex flex-wrap gap-2 p-2 border-b border-gray-200 bg-gray-50">
                  <button type="button" onClick={() => { focusEditor('shortDescription'); runEditorCommand('bold'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">عريض</button>
                  <button type="button" onClick={() => { focusEditor('shortDescription'); runEditorCommand('italic'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">مائل</button>
                  <button type="button" onClick={() => { focusEditor('shortDescription'); runEditorCommand('underline'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">تسطير</button>
                  <button type="button" onClick={() => { focusEditor('shortDescription'); runEditorCommand('formatBlock', '<h2>'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">H2</button>
                  <button type="button" onClick={() => { focusEditor('shortDescription'); runEditorCommand('formatBlock', '<h3>'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">H3</button>
                  <button type="button" onClick={() => { focusEditor('shortDescription'); runEditorCommand('insertUnorderedList'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">قائمة</button>
                  <button type="button" onClick={() => { focusEditor('shortDescription'); runEditorCommand('removeFormat'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">مسح</button>
                </div>
                <div
                  ref={shortDescriptionRef}
                  dir="rtl"
                  contentEditable
                  suppressContentEditableWarning
                  className="min-h-[120px] p-3 outline-none"
                  onFocus={() => setActiveRichField('shortDescription')}
                  onInput={(e) => { const html = (e.currentTarget as HTMLDivElement).innerHTML; setCourseDraft((prev) => ({ ...prev, shortDescription: html })); }}
                />
              </div>
              <div className="mt-2 border border-dashed border-gray-300 rounded-xl p-3 bg-white">
                <p className="text-xs font-bold text-gray-500 mb-2">معاينة مباشرة</p>
                <SafeHtml className="prose prose-sm max-w-none" html={courseDraft.shortDescription || '<p class="text-gray-400">لا يوجد نص بعد</p>'} />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">الوصف التفصيلي (WYSIWYG)</label>
              <div className="border border-gray-300 rounded-xl bg-white overflow-hidden">
                <div className="flex flex-wrap gap-2 p-2 border-b border-gray-200 bg-gray-50">
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('bold'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">عريض</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('italic'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">مائل</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('underline'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">تسطير</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('formatBlock', '<h2>'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">H2</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('formatBlock', '<h3>'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">H3</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('insertUnorderedList'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">قائمة</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('justifyRight'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">يمين</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('justifyLeft'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">يسار</button>
                  <button type="button" onClick={() => { focusEditor('description'); runEditorCommand('removeFormat'); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">مسح</button>
                </div>
                <div
                  ref={descriptionRef}
                  dir="rtl"
                  contentEditable
                  suppressContentEditableWarning
                  className="min-h-[180px] p-3 outline-none"
                  onFocus={() => setActiveRichField('description')}
                  onInput={(e) => { const html = (e.currentTarget as HTMLDivElement).innerHTML; setCourseDraft((prev) => ({ ...prev, description: html })); }}
                />
              </div>
              <div className="mt-2 border border-dashed border-gray-300 rounded-xl p-3 bg-white">
                <p className="text-xs font-bold text-gray-500 mb-2">معاينة مباشرة</p>
                <SafeHtml className="prose prose-sm max-w-none" html={courseDraft.description || '<p class="text-gray-400">لا يوجد نص بعد</p>'} />
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="block text-xs font-bold text-gray-600">معرض صور الخريجين</label>
                <button type="button" onClick={() => galleryInputRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-700">
                  <Upload size={14} className="inline ml-1" />رفع صور جديدة
                </button>
              </div>
              <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { handleGalleryUpload(e.target.files); e.target.value = ''; }} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                {(courseDraft.galleryImages || []).map((img, index) => (
                  <div key={`${img}-${index}`} className="relative border border-gray-200 rounded-lg overflow-hidden bg-white">
                    <img src={img} alt="gallery" className="w-full h-20 object-cover" />
                    <button
                      type="button"
                      onClick={() => setCourseDraft((prev) => ({ ...prev, galleryImages: (prev.galleryImages || []).filter((_, i) => i !== index) }))}
                      className="absolute top-1 left-1 bg-white/90 text-red-600 rounded-full p-1"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="border border-dashed border-gray-300 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-gray-600">اختر من معرض صور المعهد (حتى 5 صور):</p>
                {instituteGalleryImages.length === 0 ? (
                  <p className="text-xs text-gray-400">لا توجد صور في معرض المعهد بعد — أضفها من تبويب «معرض صور المعهد»</p>
                ) : (
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2 max-h-48 overflow-auto">
                    {instituteGalleryImages.map((img) => {
                      const alreadyAdded = (courseDraft.galleryImages || []).includes(img);
                      return (
                        <button
                          key={img}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => setCourseDraft((prev) => ({ ...prev, galleryImages: Array.from(new Set([...(prev.galleryImages || []), img])).slice(0, 10) }))}
                          className={`relative border-2 rounded-lg overflow-hidden transition ${alreadyAdded ? 'border-green-400 opacity-60 cursor-default' : 'border-gray-200 hover:border-primary-500 cursor-pointer'}`}
                        >
                          <img src={img} alt="institute" className="w-full h-14 object-cover" />
                          {alreadyAdded && (
                            <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center">
                              <span className="text-green-700 font-bold text-lg">✓</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="block text-xs font-bold text-gray-600">نموذج الشهادة (PDF/صورة)</label>
                <button type="button" onClick={() => certificateInputRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-700">
                  <Upload size={14} className="inline ml-1" />رفع نموذج الشهادة
                </button>
              </div>
              <input ref={certificateInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { handleCertificateUpload(e.target.files); e.target.value = ''; }} />
              <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 mb-2" placeholder="أو ضع رابط نموذج الشهادة" value={courseDraft.certificateTemplateUrl || ''} onChange={(e) => setCourseDraft({ ...courseDraft, certificateTemplateUrl: e.target.value })} />
              {courseDraft.certificateTemplateName && <p className="text-xs text-gray-500">آخر ملف مرفوع: {courseDraft.certificateTemplateName}</p>}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">محتوى صفحة تفاصيل الكورس (JSON keys)</label>
              <textarea className="w-full border border-gray-300 rounded-xl px-4 py-2.5 font-mono text-xs" rows={8} value={courseDetailsJson} onChange={(e) => setCourseDetailsJson(e.target.value)} />
            </div>

            {/* Pain / Solution UI */}
            <div className="md:col-span-2 border border-amber-200 bg-amber-50 rounded-xl p-4">
              <p className="text-xs font-bold text-amber-800 mb-3">هل هذه الدبلومة لك؟ — نقاط المشكلة (يسار) والحل (يمين)</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-red-700">مشاكل / تحديات (يسار)</p>
                  {[0, 1, 2].map((i) => (
                    <input key={i} className="w-full border border-red-200 rounded-lg px-3 py-2 text-sm bg-white" placeholder={`المشكلة ${i + 1}`} value={coursePainPoints.left[i]} onChange={(e) => { const l = [...coursePainPoints.left]; l[i] = e.target.value; setCoursePainPoints({ ...coursePainPoints, left: l }); }} />
                  ))}
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-green-700">حلول / نتائج (يمين)</p>
                  {[0, 1, 2].map((i) => (
                    <input key={i} className="w-full border border-green-200 rounded-lg px-3 py-2 text-sm bg-white" placeholder={`الحل ${i + 1}`} value={coursePainPoints.right[i]} onChange={(e) => { const r = [...coursePainPoints.right]; r[i] = e.target.value; setCoursePainPoints({ ...coursePainPoints, right: r }); }} />
                  ))}
                </div>
              </div>
            </div>

            {/* Module editor */}
            <div className="md:col-span-2 border border-indigo-200 bg-indigo-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-indigo-800">وحدات المنهج (Modules)</p>
                <button type="button" onClick={() => setCourseModulesDraft([...courseModulesDraft, { title: '', items: ['', '', ''] }])} className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold">+ وحدة جديدة</button>
              </div>
              {courseModulesDraft.length === 0 && <p className="text-xs text-indigo-400">لا توجد وحدات. اضغط "+ وحدة جديدة" للإضافة.</p>}
              <div className="space-y-3">
                {courseModulesDraft.map((mod, mi) => (
                  <div key={mi} className="border border-indigo-200 rounded-xl bg-white p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input className="flex-1 border border-indigo-200 rounded-lg px-3 py-1.5 text-sm" placeholder={`عنوان الوحدة ${mi + 1}`} value={mod.title} onChange={(e) => { const mods = [...courseModulesDraft]; mods[mi] = { ...mods[mi], title: e.target.value }; setCourseModulesDraft(mods); }} />
                      <button type="button" onClick={() => setCourseModulesDraft(courseModulesDraft.filter((_, i) => i !== mi))} className="text-red-500 text-xs font-bold px-2 py-1 rounded-lg hover:bg-red-50">حذف</button>
                    </div>
                    <div className="space-y-1.5">
                      {[0, 1, 2].map((ii) => (
                        <input key={ii} className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs" placeholder={`عنصر ${ii + 1}`} value={mod.items[ii] || ''} onChange={(e) => { const mods = [...courseModulesDraft]; const items = [...(mods[mi].items || ['', '', ''])]; items[ii] = e.target.value; mods[mi] = { ...mods[mi], items }; setCourseModulesDraft(mods); }} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Materials (PDFs) editor */}
            <div className="md:col-span-2 border border-emerald-200 bg-emerald-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-emerald-800">المادة العلمية (ملفات PDF)</p>
                <button type="button" onClick={() => setCourseMaterialsDraft([...courseMaterialsDraft, { id: `mat-${Date.now()}`, title: '', url: '', accessLevel: 'full' }])} className="px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold">+ ملف جديد</button>
              </div>
              {courseMaterialsDraft.length === 0 && <p className="text-xs text-emerald-600">لا توجد ملفات. اضغط "+ ملف جديد" للإضافة.</p>}
              <div className="space-y-2">
                {courseMaterialsDraft.map((mat, mi) => (
                  <div key={mat.id} className="border border-emerald-200 rounded-xl bg-white p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input className="flex-1 border border-emerald-200 rounded-lg px-3 py-1.5 text-sm" placeholder="عنوان الملف" value={mat.title} onChange={(e) => { const mats = [...courseMaterialsDraft]; mats[mi] = { ...mats[mi], title: e.target.value }; setCourseMaterialsDraft(mats); }} />
                      <select className="border border-emerald-200 rounded-lg px-2 py-1.5 text-xs bg-white" value={mat.accessLevel} onChange={(e) => { const mats = [...courseMaterialsDraft]; mats[mi] = { ...mats[mi], accessLevel: e.target.value as 'partial' | 'full' }; setCourseMaterialsDraft(mats); }}>
                        <option value="full">مشترك كامل</option>
                        <option value="partial">أي مشترك</option>
                      </select>
                      <button type="button" onClick={() => setCourseMaterialsDraft(courseMaterialsDraft.filter((_, i) => i !== mi))} className="text-red-500 text-xs font-bold px-2 py-1 rounded-lg hover:bg-red-50">حذف</button>
                    </div>
                    <input className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs" placeholder="رابط PDF (Firebase Storage أو رابط خارجي)" dir="ltr" value={mat.url} onChange={(e) => { const mats = [...courseMaterialsDraft]; mats[mi] = { ...mats[mi], url: e.target.value }; setCourseMaterialsDraft(mats); }} />
                  </div>
                ))}
              </div>
            </div>

            <div className="md:col-span-2 border border-gray-200 rounded-xl p-3 bg-white">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-bold text-gray-700">المحاضرات المسجلة المضافة لهذا الكورس</p>
                <button type="button" onClick={() => { setLectureCourseId(courseDraft.id); setActiveTab('lectures'); }} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold">
                  <Video size={13} className="inline ml-1" />إدارة المحاضرات
                </button>
              </div>
              {courseDraft.id ? (
                <div className="space-y-2 max-h-44 overflow-auto">
                  {getCourseLectures(courseDraft.id).filter((row) => row.lectureType === 'recorded').length === 0 && <p className="text-xs text-gray-500">لا توجد محاضرات مسجلة بعد.</p>}
                  {getCourseLectures(courseDraft.id).filter((row) => row.lectureType === 'recorded').map((row) => (
                    <div key={row.id} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">
                      <p className="text-xs text-gray-700">{row.order}. {row.title}</p>
                      <button type="button" onClick={() => window.open(row.videoUrl, '_blank')} className="text-xs text-primary-700 font-bold">فتح</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">بعد حفظ الكورس ستظهر المحاضرات المسجلة هنا.</p>
              )}
            </div>
          </div>

          {/* ── SEO Fields ── */}
          <div className="border border-violet-200 rounded-2xl p-4 bg-violet-50 space-y-3 mt-2">
            <p className="text-xs font-bold text-violet-700 mb-1">🔍 إعدادات SEO (اختياري)</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">عنوان SEO (seo_title) — يظهر في نتائج البحث</label>
                <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                  placeholder="عنوان مُحسَّن للبحث (50-60 حرفاً)" maxLength={120}
                  value={courseDraft.seo_title || ''}
                  onChange={e => setCourseDraft({ ...courseDraft, seo_title: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">وصف SEO (meta description)</label>
                <textarea className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm resize-none"
                  rows={2} placeholder="وصف مختصر يظهر في نتائج جوجل (150-160 حرفاً)" maxLength={300}
                  value={courseDraft.seo_description || ''}
                  onChange={e => setCourseDraft({ ...courseDraft, seo_description: e.target.value })} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">الكلمات المفتاحية (keywords) — مفصولة بفاصلة</label>
                <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm"
                  placeholder="علاج نفسي, صحة نفسية, دورات معهد..."
                  value={courseDraft.seo_keywords || ''}
                  onChange={e => setCourseDraft({ ...courseDraft, seo_keywords: e.target.value })} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setCourseDraft(prev => ({ ...prev, isPublished: !prev.isPublished }))}
                className={`relative w-10 h-6 rounded-full transition-colors ${courseDraft.isPublished ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${courseDraft.isPublished ? 'translate-x-5 right-auto left-1' : 'left-1'}`} />
              </div>
              <span className={`text-sm font-bold ${courseDraft.isPublished ? 'text-green-700' : 'text-gray-500'}`}>
                {courseDraft.isPublished ? 'منشور — يظهر للعملاء' : 'مسودة — غير منشور'}
              </span>
            </label>
            <button onClick={saveCourse} className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl transition">
              <Save size={16} className="inline ml-2" />
              {editingCourseId ? 'تحديث الكورس' : 'إضافة الكورس'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-500">إجمالي الكورسات</p>
              <p className="text-2xl font-extrabold text-gray-900">{courses.length}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-500">إجمالي المحاضرات</p>
              <p className="text-2xl font-extrabold text-gray-900">{lectures.length}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-500">مشتركين Full</p>
              <p className="text-2xl font-extrabold text-green-700">{subscribers.flatMap((s) => Object.values(s.courseAccess || {})).filter((v) => normalizeAccessEntry(v as CourseAccessSetting | 'preview' | 'full').mode === 'full').length}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-500">مشتركين Preview</p>
              <p className="text-2xl font-extrabold text-amber-700">{subscribers.flatMap((s) => Object.values(s.courseAccess || {})).filter((v) => normalizeAccessEntry(v as CourseAccessSetting | 'preview' | 'full').mode === 'preview').length}</p>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-xs text-gray-500">مشتركين Limited</p>
              <p className="text-2xl font-extrabold text-blue-700">{subscribers.flatMap((s) => Object.values(s.courseAccess || {})).filter((v) => normalizeAccessEntry(v as CourseAccessSetting | 'preview' | 'full').mode === 'limited').length}</p>
            </div>
          </div>

          <div className="mb-4">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={courseListSearch}
                onChange={(e) => setCourseListSearch(e.target.value)}
                placeholder="بحث باسم الكورس أو المحاضر أو التصنيف"
                className="w-full border border-gray-300 rounded-xl pr-10 pl-3 py-2.5"
              />
            </div>
          </div>

          <div className="space-y-3 max-h-[560px] overflow-auto">
            {filteredCourses.map((course) => {
              const lectureCount = getCourseLectures(course.id).length;
              const enrolled = subscribers.filter((sub) => sub.enrolledCourseIds.includes(course.id)).length;
              const accessStats = getCourseAccessStats(course.id);
              return (
                <div key={course.id} className="border border-gray-200 rounded-2xl p-4 bg-white">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="flex gap-3">
                      {course.thumbnail ? <img src={course.thumbnail} alt={course.title} className="w-20 h-20 rounded-xl object-cover border border-gray-200" /> : <div className="w-20 h-20 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center"><BookOpen size={24} className="text-gray-300" /></div>}
                      <div>
                        <h4 className="font-extrabold text-gray-900">{course.title}</h4>
                        <p className="text-xs text-gray-500 mt-1">المحاضر: {course.instructor} • {course.category} • {course.type}</p>
                        <p className="text-xs text-gray-500">السعر: {course.price.EGP} EGP | قبل الخصم: {course.originalPrice.EGP} EGP</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs min-w-[240px]">
                      <div className="bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200">محاضرات: <span className="font-bold">{lectureCount}</span></div>
                      <div className="bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-200">مشتركين: <span className="font-bold">{enrolled}</span></div>
                      <div className="bg-green-50 rounded-lg px-2 py-1.5 border border-green-200 text-green-700">Full: <span className="font-bold">{accessStats.full}</span></div>
                      <div className="bg-amber-50 rounded-lg px-2 py-1.5 border border-amber-200 text-amber-700">Preview: <span className="font-bold">{accessStats.preview}</span></div>
                      <div className="bg-blue-50 rounded-lg px-2 py-1.5 border border-blue-200 text-blue-700 col-span-2">Limited: <span className="font-bold">{accessStats.limited}</span></div>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => updateCourse({ ...course, isPublished: !course.isPublished })}
                      className={`px-3 py-1.5 rounded-lg text-sm font-bold ${course.isPublished ? 'bg-green-100 text-green-700' : 'bg-red-50 text-red-600'}`}
                    >
                      {course.isPublished ? '✓ منشور' : '✗ مسودة'}
                    </button>
                    <button onClick={() => window.open(`https://mahadnafsy.com/c/${course.slug || course.id}`, '_blank')} className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium"><Eye size={14} className="inline ml-1" />عرض</button>
                    <button onClick={() => startEditCourse(course)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm font-medium">تعديل</button>
                    <button onClick={() => { setLectureCourseId(course.id); setActiveTab('lectures'); }} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium"><Video size={14} className="inline ml-1" />المحاضرات</button>
                    <button onClick={() => { setSubscriberCourseFilter(course.id); setActiveTab('subscribers'); }} className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium"><Users size={14} className="inline ml-1" />العملاء المسجلين ({enrolled})</button>
                    <button onClick={() => {
                      if (!course.liveSessionUrl) { notify('error', 'لا يوجد رابط لايف محفوظ لهذا الكورس.'); return; }
                      window.open(course.liveSessionUrl, '_blank');
                    }} className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 text-sm font-medium"><Radio size={14} className="inline ml-1" />بث مباشر</button>
                    <button onClick={() => { setSubscriberCourseFilter(course.id); setActiveTab('subscribers'); notify('info', `إحصائيات وصول ${course.title}: Full ${accessStats.full} / Preview ${accessStats.preview} / Limited ${accessStats.limited}`); }} className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium"><BarChart3 size={14} className="inline ml-1" />إحصائيات</button>
                    <button onClick={() => { setAnalyticsCourseId(course.id); loadLessonAnalytics(course.id); }} className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 text-sm font-medium"><TrendingUp size={14} className="inline ml-1" />مشاهدات المحاضرات</button>
                    <button onClick={() => deleteCourse(course.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm font-medium">حذف</button>
                  </div>
                </div>
              );
            })}
            {filteredCourses.length === 0 && <p className="text-sm text-gray-500">لا توجد كورسات مطابقة للبحث الحالي.</p>}
          </div>
        </>
      )}
    </article>
  );
}
