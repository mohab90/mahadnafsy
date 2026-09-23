import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus, Radio, Save, Upload, Users, Video, X,
} from 'lucide-react';
import { Course } from '../../../types';
import { useSiteData, useEnsureLectures } from '../../../context/SiteDataContext';
import { SafeHtml } from '../../../../shared/ui/SafeHtml';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import { compressImageFile } from '../../../lib/imageBudget';
import { sanitizeRichHtml } from '../../../../shared/ui/sanitizeHtml';
import type { LessonAnalyticsRow } from './courses/LessonAnalyticsModal';
import { DiscountsView } from './courses/DiscountsView';
import type { TabKey } from '../navigation';
import TestimonialsPanel from './courses/TestimonialsPanel';
import BundlesPanel from './courses/BundlesPanel';
import LecturesPanel from './courses/LecturesPanel';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type RichField = 'shortDescription' | 'description';

const INP = 'w-full border border-gray-300 rounded-xl px-4 py-2.5';

type RichBtn = [command: string, label: string, arg?: string];
const RICH_BTNS_BASE: RichBtn[] = [['bold', 'عريض'], ['italic', 'مائل'], ['underline', 'تسطير'], ['formatBlock', 'H2', '<h2>'], ['formatBlock', 'H3', '<h3>'], ['insertUnorderedList', 'قائمة']];
const RICH_BTNS_SHORT: RichBtn[] = [...RICH_BTNS_BASE, ['removeFormat', 'مسح']];
const RICH_BTNS_LONG: RichBtn[] = [...RICH_BTNS_BASE, ['justifyRight', 'يمين'], ['justifyLeft', 'يسار'], ['removeFormat', 'مسح']];

const CourseInstructorsPanel = React.lazy(() => import('./courses/CourseInstructorsPanel').then(module => ({ default: module.CourseInstructorsPanel })));
const CourseListPanel = React.lazy(() => import('./courses/CourseListPanel').then(module => ({ default: module.CourseListPanel })));
const LessonAnalyticsModal = React.lazy(() => import('./courses/LessonAnalyticsModal').then(module => ({ default: module.LessonAnalyticsModal })));



// isPublished is set here on purpose. This form never sent the field at all, and
// the server falls back to `false`, so every course created through this screen
// was saved unpublished and simply never appeared on the site \u2014 "I added the
// course and it doesn't work". A course someone has just filled in and priced is
// meant to be sold; the toggle in the form below can still hold one back.
const slugify = (text: string): string => {
  const arabicToLatin: Record<string, string> = { '\u0623':'a','\u0625':'a','\u0622':'a','\u0627':'a','\u0628':'b','\u062a':'t','\u062b':'th','\u062c':'j','\u062d':'h','\u062e':'kh','\u062f':'d','\u0630':'z','\u0631':'r','\u0632':'z','\u0633':'s','\u0634':'sh','\u0635':'s','\u0636':'d','\u0637':'t','\u0638':'z','\u0639':'a','\u063a':'g','\u0641':'f','\u0642':'q','\u0643':'k','\u0644':'l','\u0645':'m','\u0646':'n','\u0647':'h','\u0648':'w','\u064a':'y','\u0649':'a','\u0629':'a','\u0621':'a' };
  return text.split('').map(c => arabicToLatin[c] ?? c).join('').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
};

const blankCourse = (): Course => ({ id: '', slug: '', title: '', description: '', shortDescription: '', instructor: '', thumbnail: '', category: 'General', type: 'Recorded', price: { EGP: 0, SAR: 0, USD: 0 }, originalPrice: { EGP: 0, SAR: 0, USD: 0 }, rating: 4.8, students: 0, modules: [], courseModules: [], duration: '', level: '\u0645\u0628\u062a\u062f\u0626', detailsContent: {}, promoVideoUrl: '', liveSessionUrl: '', galleryImages: [], certificateTemplateUrl: '', certificateTemplateName: '', isPublished: true });





interface Props {
  notify: NotifyFn;
  activeTab: string;
  setActiveTab: (tab: TabKey) => void;
  lectureCourseId: string;
  setLectureCourseId: (id: string) => void;
  subscriberCourseFilter: string;
  setSubscriberCourseFilter: (id: string) => void;
  policyDrafts: Record<string, string>;
  setPolicyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export default function CoursesTab({
  notify, activeTab, setActiveTab,
  lectureCourseId, setLectureCourseId,
  subscriberCourseFilter: _scf, setSubscriberCourseFilter,
  policyDrafts, setPolicyDrafts,
}: Props) {
  void _scf;
  const {
    courses, addCourse, updateCourse, deleteCourse,
    lectures, getCourseLectures,
    chapters,
    therapists,
    
    subscribers,
    
    content,
    isAdmin,
  } = useSiteData();

  // Lectures are not loaded at login any more — the course cards count lectures, and the editor lists the recorded ones.
  useEnsureLectures();

  // The same content key Dashboard used to parse and hand down. Parsed where it
  // is read instead, so the value has one owner per reader rather than a prop
  // threaded through two screens.
  const instituteGalleryImages = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(content['institute.gallery.images'] || '[]');
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
    } catch {
      return [];
    }
  }, [content]);

  // ── State ───────────────────────────────────────────────────────────────
  const [editingCourseId, setEditingCourseId] = useState('');
  const [courseDraft, setCourseDraft] = useState<Course>(blankCourse());
  const [courseDetailsJson, setCourseDetailsJson] = useState('{}');
  const [courseListSearch, setCourseListSearch] = useState('');
  const [isCourseFormOpen, setIsCourseFormOpen] = useState(false);
  const [activeRichField, setActiveRichField] = useState<RichField>('shortDescription');
  const shortDescriptionRef = useRef<HTMLDivElement | null>(null);
  const descriptionRef = useRef<HTMLDivElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const certificateInputRef = useRef<HTMLInputElement | null>(null);
  const [courseModulesDraft, setCourseModulesDraft] = useState<{ title: string; items: string[] }[]>([]);
  const [courseMaterialsDraft, setCourseMaterialsDraft] = useState<import('../../../types').CourseMaterial[]>([]);
  const [coursePainPoints, setCoursePainPoints] = useState<{ left: string[]; right: string[] }>({ left: ['', '', ''], right: ['', '', ''] });
  const [catalogSaving, setCatalogSaving] = useState(false);
  // ── Lesson Analytics ─────────────────────────────────────────────────────
  const [analyticsRows, setAnalyticsRows] = useState<LessonAnalyticsRow[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsCourseId, setAnalyticsCourseId] = useState('');

  const loadLessonAnalytics = async (courseId: string) => {
    if (!courseId) return;
    setAnalyticsLoading(true);
    try {
      const rows = await mysqlAdmin.getLessonAnalytics(courseId) as unknown as LessonAnalyticsRow[];
      setAnalyticsRows(rows);
    } catch { /* ignore */ } finally { setAnalyticsLoading(false); }
  };

  useEffect(() => {
    if (activeTab === 'analytics') {
      const firstCourse = courses[0];
      if (firstCourse && !analyticsCourseId) { setAnalyticsCourseId(firstCourse.id); loadLessonAnalytics(firstCourse.id); }
    }
    // Fires when the analytics tab is opened, nothing else. courses and
    // analyticsCourseId are read only to pick a default on first open —
    // depending on them would re-run this on every catalogue refresh, and on the
    // very id this effect just set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isCourseFormOpen) {
      if (shortDescriptionRef.current) shortDescriptionRef.current.innerHTML = sanitizeRichHtml(courseDraft.shortDescription);
      if (descriptionRef.current) descriptionRef.current.innerHTML = sanitizeRichHtml(courseDraft.description);
    }
    // Seeds the two contentEditable panes when the form opens, and only then.
    // courseDraft.description/shortDescription are deliberately not listed:
    // these are uncontrolled elements, so re-running this on each edit would
    // rewrite innerHTML under the cursor and lose the caret mid-sentence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCourseFormOpen, editingCourseId]);

  // ── Computed ─────────────────────────────────────────────────────────────
  const filteredCourses = courses.filter((course) => {
    const text = `${course.title} ${course.instructor} ${course.category} ${course.level}`.toLowerCase();
    return text.includes(courseListSearch.toLowerCase());
  });
  // ── Handlers ──────────────────────────────────────────────────────────────
  const getEditorRef = (field: RichField) => (field === 'shortDescription' ? shortDescriptionRef : descriptionRef);
  const focusEditor = (field: RichField) => { setActiveRichField(field); getEditorRef(field).current?.focus(); };
  const syncEditorContent = (field: RichField) => { const editor = getEditorRef(field).current; setCourseDraft((prev) => ({ ...prev, [field]: sanitizeRichHtml(editor?.innerHTML || '') })); };
  const runEditorCommand = (command: string, value?: string) => { document.execCommand(command, false, value); syncEditorContent(activeRichField); getEditorRef(activeRichField).current?.focus(); };
  const renderRichEditor = (label: string, field: RichField, minH: string, buttons: RichBtn[]) => (
    <div className="md:col-span-2">
      <label className="block text-xs font-bold text-gray-600 mb-1">{label}</label>
      <div className="border border-gray-300 rounded-xl bg-white overflow-hidden">
        <div className="flex flex-wrap gap-2 p-2 border-b border-gray-200 bg-gray-50">
          {buttons.map(([cmd, lbl, arg]) => (
            <button key={lbl} type="button" onClick={() => { focusEditor(field); runEditorCommand(cmd, arg); }} className="px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-xs font-bold">{lbl}</button>
          ))}
        </div>
        <div ref={getEditorRef(field)} dir="rtl" contentEditable suppressContentEditableWarning className={`${minH} p-3 outline-none`} onFocus={() => setActiveRichField(field)} onInput={(e) => { const html = sanitizeRichHtml((e.currentTarget as HTMLDivElement).innerHTML); setCourseDraft((prev) => ({ ...prev, [field]: html })); }} />
      </div>
      <div className="mt-2 border border-dashed border-gray-300 rounded-xl p-3 bg-white">
        <p className="text-xs font-bold text-gray-500 mb-2">معاينة مباشرة</p>
        <SafeHtml className="prose prose-sm max-w-none" html={courseDraft[field] || '<p class="text-gray-400">لا يوجد نص بعد</p>'} />
      </div>
    </div>
  );
  const priceField = (label: string, group: 'price' | 'originalPrice', cur: 'EGP' | 'SAR' | 'USD') => (
    <div>
      <label className="block text-xs font-bold text-gray-600 mb-1">{label}</label>
      <input type="number" className={INP} value={courseDraft[group][cur]} onChange={(e) => setCourseDraft({ ...courseDraft, [group]: { ...courseDraft[group], [cur]: Number(e.target.value) } })} />
    </div>
  );
  const readFileAsDataUrl = (file: File, maxPx = 900, quality = 0.78) => compressImageFile(file, { maxPx, quality });
  const handleGalleryUpload = async (files: FileList | null) => { if (!files || files.length === 0) return; try { const uploaded = await Promise.all(Array.from(files).map((file) => readFileAsDataUrl(file))); setCourseDraft((prev) => ({ ...prev, galleryImages: Array.from(new Set([...(prev.galleryImages || []), ...uploaded])) })); } catch { notify('error', '\u0627\u0644\u0635\u0648\u0631\u0629 \u0643\u0628\u064a\u0631\u0629 \u062c\u062f\u0627\u064b \u0623\u0648 \u062a\u0639\u0630\u0631 \u0636\u063a\u0637\u0647\u0627. \u062c\u0631\u0628 \u0635\u0648\u0631\u0629 \u0623\u0635\u063a\u0631.'); } };
  const handleCertificateUpload = async (files: FileList | null) => { const file = files?.[0]; if (!file) return; try { const uploaded = await readFileAsDataUrl(file, 1200, 0.82); setCourseDraft((prev) => ({ ...prev, certificateTemplateUrl: uploaded, certificateTemplateName: file.name })); } catch { notify('error', '\u0646\u0645\u0648\u0630\u062c \u0627\u0644\u0634\u0647\u0627\u062f\u0629 \u0643\u0628\u064a\u0631 \u062c\u062f\u0627\u064b \u0623\u0648 \u062a\u0639\u0630\u0631 \u0636\u063a\u0637\u0647.'); } };
const startEditCourse = (course: Course) => {
  setEditingCourseId(course.id);
  setCourseDraft({
    ...course,
    modules: [...course.modules],
    courseModules: course.courseModules ? course.courseModules.map(m => ({ ...m, items: [...m.items] })) : [],
    promoVideoUrl: course.promoVideoUrl || '',
    liveSessionUrl: course.liveSessionUrl || '',
    galleryImages: [...(course.galleryImages || [])],
    certificateTemplateUrl: course.certificateTemplateUrl || '',
    certificateTemplateName: course.certificateTemplateName || '',
  });
  const dc = course.detailsContent || {};
  setCoursePainPoints({
    left: [dc['courseDetails.pain.left1'] || '', dc['courseDetails.pain.left2'] || '', dc['courseDetails.pain.left3'] || ''],
    right: [dc['courseDetails.pain.right1'] || '', dc['courseDetails.pain.right2'] || '', dc['courseDetails.pain.right3'] || ''],
  });
  setCourseModulesDraft(
    course.courseModules?.length
      ? course.courseModules.map(m => ({ ...m, items: [...m.items] }))
      : course.modules.map(t => ({ title: t, items: ['', '', ''] }))
  );
  setCourseMaterialsDraft(course.materials ? course.materials.map(m => ({ ...m })) : []);
  setCourseDetailsJson(JSON.stringify(course.detailsContent ?? {}, null, 2));
  setIsCourseFormOpen(true);
  setActiveTab('courses');
};

const saveCourse = async () => {
  // Use DOM to reliably extract plain text (handles spans, encoded entities, br tags, etc.)
  const stripHtmlTags = (html: string): string => {
    try {
      const el = document.createElement('div');
      el.innerHTML = sanitizeRichHtml(html);
      return (el.textContent ?? el.innerText ?? '').replace(/\s+/g, ' ').trim();
    } catch {
      return html.replace(/<[^>]*>/g, '').trim();
    }
  };
  const cleanWordHtml = (html: string) =>
    html
      .replace(/\s+style="[^"]*"/gi, '')
      .replace(/\s+lang="[^"]*"/gi, '')
      .replace(/\s+dir="[^"]*"/gi, '')
      .replace(/\s+class="[^"]*mso[^"]*"/gi, '')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '');
  if (!courseDraft.title.trim()) {
    notify('error', 'لا يمكن حفظ الكورس بدون عنوان.');
    return;
  }
  if (!courseDraft.instructor.trim()) {
    notify('error', 'اختر المحاضر من قائمة المحاضرين قبل الحفظ.');
    return;
  }
  const selectedInstructor = therapists.find((row) => row.name === courseDraft.instructor);
  if (!selectedInstructor) {
    notify('error', 'المحاضر المختار غير موجود في قائمة المحاضرين.');
    return;
  }
  // An unlinked lecturer is NOT a reason to refuse the save. This used to hard-
  // return here, and since no therapist in this tenant has a staff account
  // linked, it blocked creating *any* course at all — the reported bug. The
  // staff link only unlocks two optional extras (an instructor revenue share
  // via instructor_rates, and the lecturer opening their own course from their
  // own login); the course itself is perfectly valid with just the name, and
  // courses.instructor_id is nullable precisely for that. Warn and continue.
  // No instructor in this institute is linked to a staff account, so this fired
  // on every single save and read as a failure — it is neither. Say plainly
  // that the save is going ahead, and where to do the linking if the revenue
  // share is actually wanted, instead of stating a fact with no next step.
  if (!selectedInstructor.staffId) {
    notify('info', `سيُحفظ الكورس باسم ${selectedInstructor.name}. لربطه بحساب موظف (لنسبة الإيراد ودخوله لكورسه): المحاضرون ← عدّل المحاضر ← ربط بحساب موظف — اختياري.`);
  }
  let parsedDetails: Record<string, string> = {};
  try {
    const raw = courseDetailsJson.trim();
    parsedDetails = raw ? JSON.parse(raw) : {};
  } catch {
    notify('error', 'تنسيق JSON في تفاصيل صفحة الكورس غير صحيح.');
    return;
  }

  // Merge pain points (visible per-course fields)
  if (coursePainPoints.left[0]) parsedDetails['courseDetails.pain.left1'] = coursePainPoints.left[0];
  if (coursePainPoints.left[1]) parsedDetails['courseDetails.pain.left2'] = coursePainPoints.left[1];
  if (coursePainPoints.left[2]) parsedDetails['courseDetails.pain.left3'] = coursePainPoints.left[2];
  if (coursePainPoints.right[0]) parsedDetails['courseDetails.pain.right1'] = coursePainPoints.right[0];
  if (coursePainPoints.right[1]) parsedDetails['courseDetails.pain.right2'] = coursePainPoints.right[1];
  if (coursePainPoints.right[2]) parsedDetails['courseDetails.pain.right3'] = coursePainPoints.right[2];

  const filteredModules = courseModulesDraft.filter(m => m.title.trim());
  const payload = {
    ...courseDraft,
    id: courseDraft.id || courseDraft.slug || `c-${Date.now()}`,
    slug: courseDraft.slug || courseDraft.id || `c-${Date.now()}`,
    shortDescription: stripHtmlTags(courseDraft.shortDescription || ''),
    description: cleanWordHtml(courseDraft.description || ''),
    thumbnail: courseDraft.thumbnail || '',
    modules: filteredModules.map(m => m.title),
    courseModules: filteredModules,
    detailsContent: parsedDetails,
    galleryImages: courseDraft.galleryImages || [],
    promoVideoUrl: courseDraft.promoVideoUrl || '',
    liveSessionUrl: courseDraft.liveSessionUrl || '',
    certificateTemplateUrl: courseDraft.certificateTemplateUrl || '',
    certificateTemplateName: courseDraft.certificateTemplateName || '',
    materials: courseMaterialsDraft.filter(m => m.title.trim() && m.url.trim()),
  };
  setCatalogSaving(true);
  const saved = editingCourseId ? await updateCourse(payload) : await addCourse(payload);
  setCatalogSaving(false);
  if (!saved) { notify('error', 'تعذر حفظ الكورس.'); return; }
  setEditingCourseId('');
  setCourseDraft(blankCourse());
  setCourseDetailsJson('{}');
  setCourseModulesDraft([]);
  setCourseMaterialsDraft([]);
  setCoursePainPoints({ left: ['', '', ''], right: ['', '', ''] });
  setIsCourseFormOpen(false);
  notify('success', `تم حفظ الكورس بنجاح: ${payload.title}`);
};










  return (
    <>  {activeTab === 'courses' && (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-bold text-gray-900">إدارة الكورسات</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
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
              if (isCourseFormOpen && !editingCourseId) {
                setIsCourseFormOpen(false);
                return;
              }
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
                // Auto-generate slug only if not edited manually yet
                const autoSlug = !editingCourseId && (!courseDraft.slug || courseDraft.slug === slugify(courseDraft.title))
                  ? slugify(title)
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
                onChange={(e) => setCourseDraft({ ...courseDraft, titleEn: e.target.value })}
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
                  onClick={() => setCourseDraft({ ...courseDraft, slug: slugify(courseDraft.title) })}
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
            {/* There was no publish control on this form at all, so nothing ever
                sent is_published and the server's default of false applied to
                every course created here — saved, but invisible on the site. */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">حالة النشر</label>
              <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-4 py-2.5 cursor-pointer select-none">
                <input type="checkbox" className="rounded"
                  checked={courseDraft.isPublished !== false}
                  onChange={(e) => setCourseDraft({ ...courseDraft, isPublished: e.target.checked })} />
                <span className={`text-sm font-bold ${courseDraft.isPublished !== false ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {courseDraft.isPublished !== false ? 'منشور — ظاهر للعملاء على الموقع' : 'مسودة — غير ظاهر على الموقع'}
                </span>
              </label>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">المحاضر (من قائمة المحاضرين)</label>
              <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.instructor} onChange={(e) => {
                const therapist = therapists.find(row => row.name === e.target.value);
                setCourseDraft({ ...courseDraft, instructor: e.target.value, instructorId: therapist?.staffId });
              }}>
                <option value="">اختر المحاضر</option>
                {/* The ● marks lecturers linked to a staff account. Only those can
                    receive an instructor revenue share (instructor_rates) or open
                    their own course from their login — an unlinked lecturer still
                    works fine, their name just shows on the course. */}
                {therapists.map((row) => (
                  <option key={row.id} value={row.name}>
                    {row.name}{row.staffId ? ' ●' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">● = مرتبط بحساب موظف (يستحق نسبة إيراد ويقدر يفتح كورسه). بدون ربط الكورس يتحفظ عادي باسم المحاضر فقط.</p>
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
            {priceField('السعر الحالي EGP (جنيه)', 'price', 'EGP')}
            {priceField('السعر قبل الخصم EGP (جنيه)', 'originalPrice', 'EGP')}
            {priceField('السعر الحالي SAR (ريال)', 'price', 'SAR')}
            {priceField('السعر قبل الخصم SAR (ريال)', 'originalPrice', 'SAR')}
            {priceField('السعر الحالي USD (دولار)', 'price', 'USD')}
            {priceField('السعر قبل الخصم USD (دولار)', 'originalPrice', 'USD')}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">عدد الطلاب المتوقع</label>
              <input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.students} onChange={(e) => setCourseDraft({ ...courseDraft, students: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">مستوى الكورس</label>
              <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5" value={courseDraft.level} onChange={(e) => setCourseDraft({ ...courseDraft, level: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">مدة إتاحة الكورس للعميل (بالشهور)</label>
              <input
                type="number" min={0} placeholder="سيبها فاضية = مفتوح بدون نهاية"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5"
                value={courseDraft.accessMonths ?? ''}
                onChange={(e) => setCourseDraft({ ...courseDraft, accessMonths: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <p className="text-[11px] text-gray-400 mt-1">بيتحسب من يوم اشتراك كل عميل. العملاء الحاليين مش هيتأثروا.</p>
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
                    if (!courseDraft.liveSessionUrl) {
                      notify('error', 'أدخل رابط البث المباشر أولاً.');
                      return;
                    }
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
                    if (!courseDraft.id) {
                      notify('info', 'احفظ الكورس أولاً لعرض العملاء المسجلين.');
                      return;
                    }
                    setSubscriberCourseFilter(courseDraft.id);
                    setActiveTab('client');
                  }}
                  className="px-3 py-2 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 text-sm font-bold"
                >
                  <Users size={14} className="inline ml-1" />
                  العملاء المسجلين: {courseDraft.id ? subscribers.filter((sub) => sub.enrolledCourseIds.includes(courseDraft.id)).length : 0}
                </button>
              </div>
            </div>

            {renderRichEditor('الوصف القصير (WYSIWYG)', 'shortDescription', 'min-h-[120px]', RICH_BTNS_SHORT)}

            {renderRichEditor('الوصف التفصيلي (WYSIWYG)', 'description', 'min-h-[180px]', RICH_BTNS_LONG)}

            <div className="md:col-span-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="block text-xs font-bold text-gray-600">معرض صور الخريجين</label>
                <button type="button" onClick={() => galleryInputRef.current?.click()} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-bold text-gray-700">
                  <Upload size={14} className="inline ml-1" />رفع صور جديدة
                </button>
              </div>
              <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void handleGalleryUpload(e.target.files); e.target.value = ''; }} />
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
              <input ref={certificateInputRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { void handleCertificateUpload(e.target.files); e.target.value = ''; }} />
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

          <button onClick={() => void saveCourse()} disabled={catalogSaving} className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-bold px-5 py-2.5 rounded-xl transition">
            <Save size={16} className="inline ml-2" />
            {editingCourseId ? 'تحديث الكورس' : 'إضافة الكورس'}
          </button>
        </div>
      ) : (
        <CourseListPanel
          courses={courses}
          filteredCourses={filteredCourses}
          lecturesCount={lectures.length}
          subscribers={subscribers}
          search={courseListSearch}
          onSearchChange={setCourseListSearch}
          getCourseLectures={getCourseLectures}
          onEditCourse={startEditCourse}
          onOpenLectures={(courseId) => { setLectureCourseId(courseId); setActiveTab('lectures'); }}
          onOpenSubscribers={(courseId) => { setSubscriberCourseFilter(courseId); setActiveTab('client'); }}
          onShowAccessStats={(course, accessStats) => {
            setSubscriberCourseFilter(course.id);
            setActiveTab('client');
            notify('info', `إحصائيات وصول ${course.title}: Full ${accessStats.full} / Preview ${accessStats.preview} / Limited ${accessStats.limited}`);
          }}
          onOpenAnalytics={(courseId) => { setAnalyticsCourseId(courseId); loadLessonAnalytics(courseId); }}
          onDeleteCourse={async (id) => {
            const deleted = await deleteCourse(id);
            notify(deleted ? 'success' : 'error', deleted ? 'تم حذف الكورس.' : 'تعذر حذف الكورس.');
            return deleted;
          }}
          notifyMissingLiveUrl={() => notify('error', 'لا يوجد رابط لايف محفوظ لهذا الكورس.')}
        />
      )}
    </article>
  )}

  {activeTab === 'lectures' && (
    <LecturesPanel lectureCourseId={lectureCourseId} setLectureCourseId={setLectureCourseId} notify={notify} />
  )}

  <CourseInstructorsPanel activeTab={activeTab} notify={notify} />

  {activeTab === 'bundles' && <BundlesPanel notify={notify} />}

  {activeTab === 'testimonials' && <TestimonialsPanel notify={notify} />}

  {/* ═══════════════════════════════════════════════════════════════════
      DISCOUNTS TAB — الخصومات والكوبونات
  ═══════════════════════════════════════════════════════════════════ */}
  {activeTab === 'discounts' && <DiscountsView notify={notify} policyDrafts={policyDrafts} setPolicyDrafts={setPolicyDrafts} />}

    {analyticsCourseId && (
      <LessonAnalyticsModal
        course={courses.find((course) => course.id === analyticsCourseId)}
        rows={analyticsRows}
        loading={analyticsLoading}
        onClose={() => setAnalyticsCourseId('')}
      />
    )}

    </>
  );
}
