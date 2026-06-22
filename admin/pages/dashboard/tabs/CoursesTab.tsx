import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  BarChart3, BookOpen, ChevronDown, Eye, Plus, Radio, Save,
  Search, Upload, Users, Video, X, TrendingUp,
} from 'lucide-react';
import { Bundle, Course, CourseChapterItem, CourseAccessSetting, DiscountRule, Therapist, TherapistAvailabilitySlot } from '../../../types';
import { meetingProviderLabels, defaultMeetingBaseUrls } from '../../../lib/consultations';
import { useSiteData } from '../../../context/SiteDataContext';
import { SafeHtml } from '../../../components/SafeHtml';
import { mysqlAdmin } from '../../../lib/mysqlapi';
import TestimonialsManager from './TestimonialsManager';
import BundlesManager from './BundlesManager';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type RichField = 'shortDescription' | 'description';

const _vk = '\x6d\x68\x64\x2d\x6e\x61\x66\x73\x79\x2d\x32\x30\x32\x36';
const obfV = (u: string): string => { if (!u || u.startsWith('enc:')) return u; try { return 'enc:' + btoa(u.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _vk.charCodeAt(i % _vk.length))).join('')); } catch { return u; } };
const deobfV = (u: string): string => { if (!u || !u.startsWith('enc:')) return u; try { return atob(u.slice(4)).split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _vk.charCodeAt(i % _vk.length))).join(''); } catch { return u; } };

const slugify = (text: string): string => {
  const arabicToLatin: Record<string, string> = { '\u0623':'a','\u0625':'a','\u0622':'a','\u0627':'a','\u0628':'b','\u062a':'t','\u062b':'th','\u062c':'j','\u062d':'h','\u062e':'kh','\u062f':'d','\u0630':'z','\u0631':'r','\u0632':'z','\u0633':'s','\u0634':'sh','\u0635':'s','\u0636':'d','\u0637':'t','\u0638':'z','\u0639':'a','\u063a':'g','\u0641':'f','\u0642':'q','\u0643':'k','\u0644':'l','\u0645':'m','\u0646':'n','\u0647':'h','\u0648':'w','\u064a':'y','\u0649':'a','\u0629':'a','\u0621':'a' };
  return text.split('').map(c => arabicToLatin[c] ?? c).join('').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
};

const blankCourse = (): Course => ({ id: '', slug: '', title: '', description: '', shortDescription: '', instructor: '', thumbnail: '', category: 'General', type: 'Recorded', price: { EGP: 0, SAR: 0, USD: 0 }, originalPrice: { EGP: 0, SAR: 0, USD: 0 }, rating: 4.8, students: 0, modules: [], courseModules: [], duration: '', level: '\u0645\u0628\u062a\u062f\u0626', detailsContent: {}, promoVideoUrl: '', liveSessionUrl: '', galleryImages: [], certificateTemplateUrl: '', certificateTemplateName: '', isPublished: true });

const blankTherapist = (): Therapist => ({ id: '', name: '', specialty: '', image: '', experience: 1, rating: 4.8, price: { EGP: 0, SAR: 0, USD: 0 }, title: '', bio: '', featured: false, sortOrder: 99, showOnHome: false, showOnAbout: false, languages: [], focusAreas: [], qualifications: [], consultationSettings: { enabled: false, sessionDurationMinutes: 50, sessionPrice: { EGP: 0, SAR: 0, USD: 0 }, meetingProvider: 'google_meet', providerBaseUrl: defaultMeetingBaseUrls.google_meet, autoCreateMeetingLink: true, intakeFormUrl: '', bookingNotes: '', availableSlots: [], portal: { username: '', password: '', temporaryPassword: true } } });

const blankTherapistSlot = (): TherapistAvailabilitySlot => ({ id: `slot-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`, day: 'sunday', startTime: '17:00', endTime: '17:50', timezone: 'Africa/Cairo', label: '', meetingLink: '', isActive: true });
interface Props {
  notify: NotifyFn;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  lectureCourseId: string;
  setLectureCourseId: (id: string) => void;
  subscriberCourseFilter: string;
  setSubscriberCourseFilter: (id: string) => void;
  instituteGalleryImages: string[];
  policyDrafts: Record<string, string>;
  setPolicyDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

export default function CoursesTab({
  notify, activeTab, setActiveTab,
  lectureCourseId, setLectureCourseId,
  subscriberCourseFilter: _scf, setSubscriberCourseFilter,
  instituteGalleryImages,
  policyDrafts, setPolicyDrafts,
}: Props) {
  void _scf;
  const {
    courses, addCourse, updateCourse, deleteCourse,
    lectures, addLecture, updateLecture, deleteLecture, getCourseLectures,
    chapters, addChapter, updateChapter, deleteChapter, getCourseChapters,
    therapists, addTherapist, updateTherapist, deleteTherapist,
    bundles, addBundle, updateBundle, deleteBundle,
    testimonials, addTestimonial, updateTestimonial, deleteTestimonial,
    discounts, addDiscount, updateDiscount, deleteDiscount,
    subscribers, consultations,
    content, setContentValue,
    isAdmin,
  } = useSiteData();

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
  const therapistImageInputRef = useRef<HTMLInputElement | null>(null);
  const [editingTherapistId, setEditingTherapistId] = useState('');
  const [isTherapistFormOpen, setIsTherapistFormOpen] = useState(false);
  const [therapistDraft, setTherapistDraft] = useState<Therapist>(blankTherapist());
  const [editingBundleId, setEditingBundleId] = useState('');
  const [isBundleFormOpen, setIsBundleFormOpen] = useState(false);
  const [bundleTitle, setBundleTitle] = useState('');
  const [bundleTitleEn, setBundleTitleEn] = useState('');
  const [bundleSlug, setBundleSlug] = useState('');
  const [bundleVideoUrl, setBundleVideoUrl] = useState('');
  const [bundleShortDesc, setBundleShortDesc] = useState('');
  const [bundleDescription, setBundleDescription] = useState('');
  const [bundleCourseIds, setBundleCourseIds] = useState<string[]>([]);
  const [bundlePrice, setBundlePrice] = useState({ EGP: 0, SAR: 0, USD: 0 });
  const [bundleOriginalPrice, setBundleOriginalPrice] = useState({ EGP: 0, SAR: 0, USD: 0 });
  const [bundleDetailsJson, setBundleDetailsJson] = useState('{}');
  const [bundleIsPublished, setBundleIsPublished] = useState(true);
  const [editingTestimonialId, setEditingTestimonialId] = useState<number | null>(null);
  const [isTestimonialFormOpen, setIsTestimonialFormOpen] = useState(false);
  const [testimonialDraft, setTestimonialDraft] = useState({ id: 0, name: '', role: '', text: '', image: '' });
  const [expandedLectureCourses, setExpandedLectureCourses] = useState<Record<string, boolean>>({});
  const [expandedLectureChapters, setExpandedLectureChapters] = useState<Record<string, boolean>>({});
  const [editingLectureId, setEditingLectureId] = useState('');
  const [isLectureFormOpen, setIsLectureFormOpen] = useState(false);
  const [lectureDraft, setLectureDraft] = useState({ title: '', lectureType: 'recorded' as 'recorded' | 'live', videoUrl: '', duration: '', order: 1, thumbnail: '', chapterId: '' });
  const [editingChapterId, setEditingChapterId] = useState('');
  const [isChapterFormOpen, setIsChapterFormOpen] = useState(false);
  const [chapterDraft, setChapterDraft] = useState({ title: '', order: 1 });
  const [discountDraft, setDiscountDraft] = useState<Omit<DiscountRule, 'id' | 'createdAt'>>({ type: 'course', targetId: '', discountPercent: 10, label: '', promoCode: '', active: true, expiresAt: '' });
  const [editingDiscountId, setEditingDiscountId] = useState('');

  // ── Promo Codes (new backend system) ────────────────────────────────────
  type PromoCode = { id: string; code: string; discount_type: 'percent' | 'fixed'; discount_value: number; min_order_amount: number; max_uses: number | null; used_count: number; expires_at: string | null; active: number };
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoForm, setPromoForm] = useState({ code: '', discount_type: 'percent' as 'percent' | 'fixed', discount_value: 10, min_order_amount: 0, max_uses: '', expires_at: '' });
  const [promoFormOpen, setPromoFormOpen] = useState(false);

  // ── Lesson Analytics ─────────────────────────────────────────────────────
  type LessonAnalyticsRow = { id: string; title: string; sort_order: number; view_count: number };
  const [analyticsRows, setAnalyticsRows] = useState<LessonAnalyticsRow[]>([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsCourseId, setAnalyticsCourseId] = useState('');

  const loadPromoCodes = async () => {
    setPromoLoading(true);
    try {
      const rows = await mysqlAdmin.listPromoCodes() as unknown as PromoCode[];
      setPromoCodes(rows);
    } catch { /* ignore */ } finally { setPromoLoading(false); }
  };

  const loadLessonAnalytics = async (courseId: string) => {
    if (!courseId) return;
    setAnalyticsLoading(true);
    try {
      const rows = await mysqlAdmin.getLessonAnalytics(courseId) as unknown as LessonAnalyticsRow[];
      setAnalyticsRows(rows);
    } catch { /* ignore */ } finally { setAnalyticsLoading(false); }
  };

  useEffect(() => {
    if (activeTab === 'discounts') loadPromoCodes();
    if (activeTab === 'analytics') {
      const firstCourse = courses[0];
      if (firstCourse && !analyticsCourseId) { setAnalyticsCourseId(firstCourse.id); loadLessonAnalytics(firstCourse.id); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // ── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isCourseFormOpen) {
      if (shortDescriptionRef.current) shortDescriptionRef.current.innerHTML = courseDraft.shortDescription || '';
      if (descriptionRef.current) descriptionRef.current.innerHTML = courseDraft.description || '';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCourseFormOpen, editingCourseId]);

  // ── Computed ─────────────────────────────────────────────────────────────
  const selectedCourseLectures = lectureCourseId ? getCourseLectures(lectureCourseId) : [];
  const filteredCourses = courses.filter((course) => {
    const text = `${course.title} ${course.instructor} ${course.category} ${course.level}`.toLowerCase();
    return text.includes(courseListSearch.toLowerCase());
  });
  const courseAccessStatsMap = useMemo(() => {
    const map = new Map<string, { full: number; preview: number; limited: number }>();
    const normalizeEntry = (entry?: { mode?: string } | string): { mode: string } => {
      if (entry === 'full') return { mode: 'full' };
      if (entry === 'preview' || !entry) return { mode: 'preview' };
      return { mode: (entry as { mode: string }).mode || 'preview' };
    };
    courses.forEach(c => { map.set(c.id, { full: 0, preview: 0, limited: 0 }); });
    subscribers.forEach(sub => {
      (sub.enrolledCourseIds || []).forEach(courseId => {
        const stats = map.get(courseId);
        if (!stats) return;
        const access = normalizeEntry(sub.courseAccess?.[courseId]);
        if (access.mode === 'full') stats.full++;
        else if (access.mode === 'limited') stats.limited++;
        else stats.preview++;
      });
    });
    return map;
  }, [courses, subscribers]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const normalizeAccessEntry = (entry?: CourseAccessSetting | 'preview' | 'full'): CourseAccessSetting => {
    if (entry === 'full') return { mode: 'full' };
    if (entry === 'preview') return { mode: 'preview' };
    if (!entry) return { mode: 'preview' };
    if (entry.mode === 'limited') { const rawLimit = Number(entry.lectureLimit || 1); return { mode: 'limited', lectureLimit: Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 1 }; }
    return { mode: entry.mode };
  };
  const getEditorRef = (field: RichField) => (field === 'shortDescription' ? shortDescriptionRef : descriptionRef);
  const focusEditor = (field: RichField) => { setActiveRichField(field); getEditorRef(field).current?.focus(); };
  const syncEditorContent = (field: RichField) => { const editor = getEditorRef(field).current; setCourseDraft((prev) => ({ ...prev, [field]: editor?.innerHTML || '' })); };
  const runEditorCommand = (command: string, value?: string) => { document.execCommand(command, false, value); syncEditorContent(activeRichField); getEditorRef(activeRichField).current?.focus(); };
  const readFileAsDataUrl = (file: File, maxPx = 900, quality = 0.78) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file-read-failed'));
    reader.onload = (ev) => {
      const img = document.createElement('img');
      img.onerror = () => reject(new Error('image-load-failed'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxPx || height > maxPx) { if (width > height) { height = Math.round((height / width) * maxPx); width = maxPx; } else { width = Math.round((width / height) * maxPx); height = maxPx; } }
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d'); if (!ctx) { resolve(String(ev.target?.result || '')); return; }
        ctx.drawImage(img, 0, 0, width, height); resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = String(ev.target?.result || '');
    };
    reader.readAsDataURL(file);
  });
  const handleGalleryUpload = async (files: FileList | null) => { if (!files || files.length === 0) return; try { const uploaded = await Promise.all(Array.from(files).map((file) => readFileAsDataUrl(file))); setCourseDraft((prev) => ({ ...prev, galleryImages: Array.from(new Set([...(prev.galleryImages || []), ...uploaded])) })); } catch { notify('error', '\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0631\u0641\u0639 \u0635\u0648\u0631 \u0645\u0639\u0631\u0636 \u0627\u0644\u062e\u0631\u064a\u062c\u064a\u0646.'); } };
  const handleCertificateUpload = async (files: FileList | null) => { const file = files?.[0]; if (!file) return; try { const uploaded = await readFileAsDataUrl(file); setCourseDraft((prev) => ({ ...prev, certificateTemplateUrl: uploaded, certificateTemplateName: file.name })); } catch { notify('error', '\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0631\u0641\u0639 \u0646\u0645\u0648\u0630\u062c \u0627\u0644\u0634\u0647\u0627\u062f\u0629.'); } };
  const handleTherapistImageUpload = async (files: FileList | null) => { const file = files?.[0]; if (!file) return; try { const uploaded = await readFileAsDataUrl(file); setTherapistDraft((prev) => ({ ...prev, image: uploaded })); } catch { notify('error', '\u062d\u062f\u062b \u062e\u0637\u0623 \u0623\u062b\u0646\u0627\u0621 \u0631\u0641\u0639 \u0635\u0648\u0631\u0629 \u0627\u0644\u0645\u062d\u0627\u0636\u0631.'); } };
  const getCourseAccessStats = (courseId: string) => courseAccessStatsMap.get(courseId) ?? { full: 0, preview: 0, limited: 0 };
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

const saveCourse = () => {
  // Use DOM to reliably extract plain text (handles spans, encoded entities, br tags, etc.)
  const stripHtmlTags = (html: string): string => {
    try {
      const el = document.createElement('div');
      el.innerHTML = html;
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
  if (!therapists.some((row) => row.name === courseDraft.instructor)) {
    notify('error', 'المحاضر المختار غير موجود في قائمة المحاضرين.');
    return;
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
  const tempId = `c-${Date.now()}`;
  const payload = {
    ...courseDraft,
    id: courseDraft.id || courseDraft.slug || tempId,
    slug: courseDraft.slug || courseDraft.id || tempId,
    isPublished: courseDraft.isPublished ?? false,
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
  if (editingCourseId) updateCourse(payload); else addCourse(payload);
  setEditingCourseId('');
  setCourseDraft(blankCourse());
  setCourseDetailsJson('{}');
  setCourseModulesDraft([]);
  setCourseMaterialsDraft([]);
  setCoursePainPoints({ left: ['', '', ''], right: ['', '', ''] });
  setIsCourseFormOpen(false);
  notify('success', `تم حفظ الكورس بنجاح: ${payload.title}`);
};

const startEditTherapist = (row: Therapist) => {
  setEditingTherapistId(row.id);
  setIsTherapistFormOpen(true);
  setTherapistDraft({
    ...row,
    languages: [...(row.languages || [])],
    focusAreas: [...(row.focusAreas || [])],
    qualifications: [...(row.qualifications || [])],
    consultationSettings: row.consultationSettings
      ? {
          ...row.consultationSettings,
          sessionPrice: { ...row.consultationSettings.sessionPrice },
          availableSlots: row.consultationSettings.availableSlots.map((slot) => ({ ...slot })),
          portal: { ...row.consultationSettings.portal },
        }
      : blankTherapist().consultationSettings,
  });
  setActiveTab('instructors');
};

const saveTherapist = () => {
  if (!therapistDraft.name.trim()) {
    notify('error', 'لا يمكن حفظ المحاضر بدون اسم.');
    return;
  }
  if (therapistDraft.consultationSettings?.enabled) {
    if ((therapistDraft.consultationSettings.availableSlots || []).filter((slot) => slot.isActive).length === 0) {
      notify('error', 'أضف موعداً متاحاً واحداً على الأقل قبل تفعيل الاستشارات.');
      return;
    }
  }
  const payload = {
    ...therapistDraft,
    id: therapistDraft.id || `t-${Date.now()}`,
    image: therapistDraft.image || '',
    languages: (therapistDraft.languages || []).filter(Boolean),
    focusAreas: (therapistDraft.focusAreas || []).filter(Boolean),
    qualifications: (therapistDraft.qualifications || []).filter(Boolean),
    consultationSettings: therapistDraft.consultationSettings
      ? {
          ...therapistDraft.consultationSettings,
          providerBaseUrl:
            therapistDraft.consultationSettings.providerBaseUrl ||
            defaultMeetingBaseUrls[therapistDraft.consultationSettings.meetingProvider],
          availableSlots: therapistDraft.consultationSettings.availableSlots.map((slot) => ({
            ...slot,
            timezone: slot.timezone || 'Africa/Cairo',
          })),
        }
      : undefined,
  };
  if (editingTherapistId) updateTherapist(payload); else addTherapist(payload);
  setEditingTherapistId('');
  setIsTherapistFormOpen(false);
  setTherapistDraft(blankTherapist());
  notify('success', `تم حفظ المحاضر: ${payload.name}`);
};

const startEditBundle = (row: Bundle) => {
  setEditingBundleId(row.id);
  setIsBundleFormOpen(true);
  setBundleTitle(row.title);
  setBundleTitleEn(row.titleEn || '');
  setBundleSlug(row.slug || '');
  setBundleVideoUrl(row.videoUrl || '');
  setBundleShortDesc(row.shortDescription || '');
  setBundleDescription(row.description);
  setBundleCourseIds(row.courses.map((c) => c.id));
  setBundlePrice({ ...row.price });
  setBundleOriginalPrice({ ...row.originalPrice });
  setBundleDetailsJson(JSON.stringify(row.detailsContent ?? {}, null, 2));
  setBundleIsPublished(row.isPublished !== false);
  setActiveTab('bundles');
};

const saveBundle = () => {
  if (!bundleTitle.trim()) {
    notify('error', 'لا يمكن حفظ المسار بدون عنوان.');
    return;
  }
  if (bundleCourseIds.length === 0) {
    notify('error', 'اختر كورس واحد على الأقل داخل المسار قبل الحفظ.');
    return;
  }
  let parsedDetails: Record<string, string> = {};
  try {
    const raw = bundleDetailsJson.trim();
    parsedDetails = raw ? JSON.parse(raw) : {};
  } catch {
    notify('error', 'تنسيق JSON في تفاصيل صفحة المسار غير صحيح.');
    return;
  }

  const selectedCourses = courses.filter((c) => bundleCourseIds.includes(c.id));
  const rawSlug = bundleSlug.trim().replace(/\s+/g, '-').toLowerCase();
  const payload: Bundle = {
    id: editingBundleId || `b-${Date.now()}`,
    title: bundleTitle,
    titleEn: bundleTitleEn.trim() || undefined,
    slug: rawSlug || undefined,
    videoUrl: bundleVideoUrl.trim() || undefined,
    shortDescription: bundleShortDesc.trim() || undefined,
    description: bundleDescription,
    courses: selectedCourses,
    price: { ...bundlePrice },
    originalPrice: { ...bundleOriginalPrice },
    detailsContent: parsedDetails,
    isPublished: bundleIsPublished,
  };
  if (editingBundleId) updateBundle(payload); else addBundle(payload);
  setEditingBundleId('');
  setIsBundleFormOpen(false);
  setBundleTitle('');
  setBundleTitleEn('');
  setBundleSlug('');
  setBundleVideoUrl('');
  setBundleShortDesc('');
  setBundleDescription('');
  setBundleCourseIds([]);
  setBundlePrice({ EGP: 0, SAR: 0, USD: 0 });
  setBundleOriginalPrice({ EGP: 0, SAR: 0, USD: 0 });
  setBundleDetailsJson('{}');
  setBundleIsPublished(true);
  notify('success', `تم حفظ المسار: ${payload.title}`);
};

const startEditTestimonial = (row: { id: number; name: string; role: string; text: string; image: string }) => {
  setEditingTestimonialId(row.id);
  setIsTestimonialFormOpen(true);
  setTestimonialDraft({ ...row });
  setActiveTab('testimonials');
};

const saveTestimonial = () => {
  if (!testimonialDraft.name || !testimonialDraft.text) return;
  const payload = {
    ...testimonialDraft,
    id: testimonialDraft.id || Date.now(),
    image: testimonialDraft.image || '',
  };
  if (editingTestimonialId) updateTestimonial(payload); else addTestimonial(payload);
  setEditingTestimonialId(null);
  setIsTestimonialFormOpen(false);
  setTestimonialDraft({ id: 0, name: '', role: '', text: '', image: '' });
};

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
  setActiveTab('lectures');
};

const saveLecture = () => {
  if (!lectureCourseId || !lectureDraft.title) return;
  const payload: import('../../../types').CourseLectureItem = {
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
  if (editingLectureId) updateLecture(payload); else addLecture(payload);
  setEditingLectureId('');
  setIsLectureFormOpen(false);
  setLectureDraft({ title: '', lectureType: 'recorded', videoUrl: '', duration: '', order: 1, thumbnail: '', chapterId: '' });
};

const saveChapter = () => {
  if (!lectureCourseId || !chapterDraft.title.trim()) { notify('error', 'اختر الكورس وأدخل عنوان الفصل.'); return; }
  const payload: CourseChapterItem = {
    id: editingChapterId || `ch-${Date.now()}`,
    courseId: lectureCourseId,
    title: chapterDraft.title,
    order: Number(chapterDraft.order) || 1,
  };
  if (editingChapterId) updateChapter(payload); else addChapter(payload);
  setEditingChapterId('');
  setIsChapterFormOpen(false);
  setChapterDraft({ title: '', order: 1 });
  notify('success', 'تم حفظ الفصل.');
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
                      if (!course.liveSessionUrl) {
                        notify('error', 'لا يوجد رابط لايف محفوظ لهذا الكورس.');
                        return;
                      }
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
  )}

  {activeTab === 'lectures' && (
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
            <button onClick={saveLecture} className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingLectureId ? 'تحديث المحاضرة' : 'إضافة محاضرة'}</button>
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
              <button type="button" onClick={saveChapter} className="px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-bold">حفظ</button>
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
                  <button type="button" onClick={() => { deleteChapter(ch.id); notify('success', 'تم حذف الفصل.'); }} className="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-700 font-bold">حذف</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ===== Grouped lecture list: Course → Chapter → Lecture ===== */}
      <div className="mt-5 border-t pt-4 space-y-3 max-h-[600px] overflow-auto">
        {(() => {
          // Helper: single lecture row JSX
          const lectureRow = (row: typeof lectures[0]) => (
            <div key={row.id} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl p-3">
              <div>
                <p className="font-bold text-gray-800 text-sm">{row.title}</p>
                <p className="text-xs text-gray-500">{row.lectureType === 'live' ? 'لايف' : 'مسجلة'} • ترتيب {row.order}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEditLecture(row)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button>
                <button onClick={() => deleteLecture(row.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button>
              </div>
            </div>
          );

          // Chapter group: header + lecture rows
          const chapterGroup = (chId: string, chTitle: string, chOrder: number, rows: typeof lectures) => (
            <div key={chId} className="mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1.5 rounded-lg mb-1.5">
                <span className="w-5 h-5 bg-purple-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">{chOrder || '—'}</span>
                {chTitle}
                <span className="mr-auto text-purple-400 font-normal">({rows.length} محاضرة)</span>
              </div>
              <div className="space-y-1 pr-3">
                {rows.map(lectureRow)}
              </div>
            </div>
          );

          if (lectureCourseId) {
            // Single course selected — group by chapter
            const courseChapters = getCourseChapters(lectureCourseId).sort((a, b) => a.order - b.order);
            const uncategorized = selectedCourseLectures.filter((l) => !l.chapterId || !courseChapters.some((ch) => ch.id === l.chapterId)).sort((a, b) => a.order - b.order);
            if (selectedCourseLectures.length === 0) return <p className="text-sm text-gray-500 text-center py-6">لا توجد محاضرات لهذا الكورس. أضف محاضرة من الأعلى.</p>;
            return (
              <>
                {courseChapters.map((ch) => {
                  const chLectures = selectedCourseLectures.filter((l) => l.chapterId === ch.id).sort((a, b) => a.order - b.order);
                  if (chLectures.length === 0) return null;
                  return chapterGroup(ch.id, ch.title, ch.order, chLectures);
                })}
                {uncategorized.length > 0 && chapterGroup('__uncat__', 'غير مصنفة', 0, uncategorized)}
              </>
            );
          } else {
            // No course selected — accordion: course → chapter → lecture
            const coursesWithLectures = courses.filter((c) => getCourseLectures(c.id).length > 0);
            if (coursesWithLectures.length === 0) return <p className="text-sm text-gray-500 text-center py-6">لا توجد محاضرات. اختر كورساً وأضف محاضرات.</p>;
            return (
              <>
                {coursesWithLectures.map((course) => {
                  const courseLectures = getCourseLectures(course.id);
                  const isCourseOpen = !!expandedLectureCourses[course.id];
                  const courseChapters = getCourseChapters(course.id).sort((a, b) => a.order - b.order);
                  const uncategorized = courseLectures.filter((l) => !l.chapterId || !courseChapters.some((ch) => ch.id === l.chapterId)).sort((a, b) => a.order - b.order);
                  return (
                    <div key={course.id} className="border border-indigo-200 rounded-2xl overflow-hidden">
                      {/* Course header — click to toggle */}
                      <button
                        type="button"
                        onClick={() => setExpandedLectureCourses((prev) => ({ ...prev, [course.id]: !prev[course.id] }))}
                        className="w-full flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 font-bold text-sm transition"
                      >
                        <BookOpen size={14} />
                        <span className="flex-1 text-right truncate">{course.title}</span>
                        <span className="bg-indigo-500 text-white text-xs font-normal px-2 py-0.5 rounded-full whitespace-nowrap">{courseLectures.length} محاضرة</span>
                        <ChevronDown size={14} className={`transition-transform duration-200 shrink-0 ${isCourseOpen ? 'rotate-180' : ''}`} />
                      </button>
                      {/* Sections list — visible when course is expanded */}
                      {isCourseOpen && (
                        <div className="p-3 space-y-2 bg-gray-50">
                          {courseChapters.map((ch) => {
                            const chLectures = courseLectures.filter((l) => l.chapterId === ch.id).sort((a, b) => a.order - b.order);
                            if (chLectures.length === 0) return null;
                            const chKey = course.id + '__' + ch.id;
                            const isChOpen = !!expandedLectureChapters[chKey];
                            return (
                              <div key={ch.id} className="rounded-xl overflow-hidden border border-purple-200">
                                {/* Section header — click to toggle */}
                                <button
                                  type="button"
                                  onClick={() => setExpandedLectureChapters((prev) => ({ ...prev, [chKey]: !prev[chKey] }))}
                                  className="w-full flex items-center gap-2 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 px-3 py-1.5 transition"
                                >
                                  <span className="w-5 h-5 bg-purple-600 text-white rounded-full flex items-center justify-center text-[10px] font-bold shrink-0">{ch.order || '—'}</span>
                                  <span className="flex-1 text-right">{ch.title}</span>
                                  <span className="text-purple-400 font-normal whitespace-nowrap">({chLectures.length} محاضرة)</span>
                                  <ChevronDown size={12} className={`transition-transform duration-200 shrink-0 ${isChOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {isChOpen && (
                                  <div className="space-y-1 p-2 bg-white">
                                    {chLectures.map(lectureRow)}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {uncategorized.length > 0 && (() => {
                            const chKey = course.id + '__uncat__';
                            const isChOpen = !!expandedLectureChapters[chKey];
                            return (
                              <div className="rounded-xl overflow-hidden border border-gray-200">
                                <button
                                  type="button"
                                  onClick={() => setExpandedLectureChapters((prev) => ({ ...prev, [chKey]: !prev[chKey] }))}
                                  className="w-full flex items-center gap-2 text-xs font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 transition"
                                >
                                  <span className="flex-1 text-right">غير مصنفة</span>
                                  <span className="text-gray-400 font-normal whitespace-nowrap">({uncategorized.length} محاضرة)</span>
                                  <ChevronDown size={12} className={`transition-transform duration-200 shrink-0 ${isChOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {isChOpen && (
                                  <div className="space-y-1 p-2 bg-white">
                                    {uncategorized.map(lectureRow)}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          }
        })()}
      </div>
      {lectureCourseId && (
        <div className="mt-4 border border-rose-200 bg-rose-50 rounded-xl p-4">
          <h4 className="font-bold text-rose-800 mb-2">البث المباشر للمشتركين</h4>
          <p className="text-xs text-rose-700 mb-3">يمكنك استخدام رابط اللايف المحفوظ في الكورس لبث مباشر للعملاء المشتركين فقط.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              className="flex-1 min-w-[220px] border border-rose-200 rounded-lg px-3 py-2 text-sm"
              placeholder="رابط اللايف"
              value={courses.find((c) => c.id === lectureCourseId)?.liveSessionUrl || ''}
              onChange={(e) => {
                const targetCourse = courses.find((c) => c.id === lectureCourseId);
                if (!targetCourse) return;
                updateCourse({ ...targetCourse, liveSessionUrl: e.target.value });
              }}
            />
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
  )}

  {activeTab === 'instructors' && (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="font-bold text-gray-900">إدارة المحاضرين</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
                const backup = { _meta: { createdAt: now.toISOString(), type: 'instructors' }, therapists };
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `backup_instructors_${stamp}.json`; a.click();
                URL.revokeObjectURL(url);
              }}
              className="bg-green-50 text-green-700 border border-green-200 px-3 py-2 rounded-xl text-sm font-bold hover:bg-green-100 transition flex items-center gap-1"
            >
              💾 نسخة احتياطية
            </button>
          )}
          <button
            onClick={() => {
              if (isTherapistFormOpen && !editingTherapistId) {
                setIsTherapistFormOpen(false);
                return;
              }
              setEditingTherapistId('');
              setTherapistDraft(blankTherapist());
              setIsTherapistFormOpen(true);
            }}
            className="bg-primary-600 hover:bg-primary-700 text-white rounded-xl px-4 py-2.5 font-bold text-sm"
          >
            <Plus size={16} className="inline ml-1" />
            {isTherapistFormOpen ? 'إغلاق نموذج المحاضر' : 'إضافة محاضر'}
          </button>
        </div>
      </div>

      {isTherapistFormOpen && (
        <div className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50/70 space-y-4">
          <input ref={therapistImageInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void handleTherapistImageUpload(e.target.files); e.target.value = ''; }} />

          <div className="flex flex-col lg:flex-row gap-4">
            <div className="w-full lg:w-56 shrink-0 border border-dashed border-gray-300 rounded-2xl bg-white p-4 text-center">
              <div className="w-32 h-32 mx-auto rounded-2xl overflow-hidden bg-gray-100 border border-gray-200">
                {therapistDraft.image ? (
                  <img src={therapistDraft.image} alt={therapistDraft.name || 'therapist'} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-xs text-gray-400">لا توجد صورة</div>
                )}
              </div>
              <div className="mt-3 space-y-2">
                <button type="button" onClick={() => therapistImageInputRef.current?.click()} className="w-full px-3 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold">
                  <Upload size={14} className="inline ml-1" />رفع صورة
                </button>
                <input className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm" placeholder="أو ضع رابط الصورة" value={therapistDraft.image} onChange={(e) => setTherapistDraft({ ...therapistDraft, image: e.target.value })} />
              </div>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="الاسم" value={therapistDraft.name} onChange={(e) => setTherapistDraft({ ...therapistDraft, name: e.target.value })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="التخصص الرئيسي" value={therapistDraft.specialty} onChange={(e) => setTherapistDraft({ ...therapistDraft, specialty: e.target.value })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="المسمى الوظيفي" value={therapistDraft.title || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, title: e.target.value })} />
              <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="سنوات الخبرة" value={therapistDraft.experience} onChange={(e) => setTherapistDraft({ ...therapistDraft, experience: Number(e.target.value) })} />
              <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="التقييم" min={0} max={5} step="0.1" value={therapistDraft.rating} onChange={(e) => setTherapistDraft({ ...therapistDraft, rating: Number(e.target.value) })} />
              <input type="number" className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="رقم الترتيب (1 = أول، 99 = آخر)" min={1} value={therapistDraft.sortOrder ?? 99} onChange={(e) => setTherapistDraft({ ...therapistDraft, sortOrder: Number(e.target.value) })} />
              <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-4 py-2.5 bg-white text-sm font-medium text-gray-700">
                <input type="checkbox" checked={Boolean(therapistDraft.featured)} onChange={(e) => setTherapistDraft({ ...therapistDraft, featured: e.target.checked })} />
                إبراز المحاضر في الصفحة العامة
              </label>
              <label className={`flex items-center gap-2 border-2 rounded-xl px-4 py-2.5 text-sm font-bold cursor-pointer transition-colors ${
                therapistDraft.showOnHome
                  ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                  : 'border-dashed border-gray-300 bg-white text-gray-500'
              }`}>
                <input type="checkbox" checked={Boolean(therapistDraft.showOnHome)} onChange={(e) => setTherapistDraft({ ...therapistDraft, showOnHome: e.target.checked })} />
                🏠 يظهر في الصفحة الرئيسية
                {!therapistDraft.showOnHome && <span className="text-xs text-red-400 mr-1">(غير مفعّل)</span>}
              </label>
              <label className={`flex items-center gap-2 border-2 rounded-xl px-4 py-2.5 text-sm font-bold cursor-pointer transition-colors ${
                therapistDraft.showOnAbout
                  ? 'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-dashed border-gray-300 bg-white text-gray-500'
              }`}>
                <input type="checkbox" checked={Boolean(therapistDraft.showOnAbout)} onChange={(e) => setTherapistDraft({ ...therapistDraft, showOnAbout: e.target.checked })} />
                ℹ️ يظهر في فريق العمل (عن المعهد)
                {!therapistDraft.showOnAbout && <span className="text-xs text-red-400 mr-1">(غير مفعّل)</span>}
              </label>
              <textarea className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" rows={4} placeholder="النبذة المهنية" value={therapistDraft.bio || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, bio: e.target.value })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="اللغات مفصولة بفاصلة" value={(therapistDraft.languages || []).join(', ')} onChange={(e) => setTherapistDraft({ ...therapistDraft, languages: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="محاور الخبرة أو المجالات العلاجية مفصولة بفاصلة" value={(therapistDraft.focusAreas || []).join(', ')} onChange={(e) => setTherapistDraft({ ...therapistDraft, focusAreas: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
              <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="المؤهلات والشهادات مفصولة بفاصلة" value={(therapistDraft.qualifications || []).join(', ')} onChange={(e) => setTherapistDraft({ ...therapistDraft, qualifications: e.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} />
            </div>
          </div>

          <div className="border border-gray-200 rounded-2xl bg-white p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-gray-900">تفعيل خدمة الجلسات والاستشارات</h4>
                <p className="text-xs text-gray-500">عند التفعيل سيظهر المحاضر في صفحة الاستشارات ويُفتح له حساب دخول لبوابته.</p>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm font-bold text-gray-700">
                <input
                  type="checkbox"
                  checked={Boolean(therapistDraft.consultationSettings?.enabled)}
                  onChange={(e) => setTherapistDraft({
                    ...therapistDraft,
                    consultationSettings: {
                      ...(therapistDraft.consultationSettings || blankTherapist().consultationSettings!),
                      enabled: e.target.checked,
                    },
                  })}
                />
                {therapistDraft.consultationSettings?.enabled ? 'الخدمة مفعلة' : 'الخدمة غير مفعلة'}
              </label>
            </div>

            {therapistDraft.consultationSettings?.enabled && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">مدة الجلسة (بالدقائق)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="مثال: 60" value={therapistDraft.consultationSettings.sessionDurationMinutes} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionDurationMinutes: Number(e.target.value) || 0 } })} /></div>
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">سعر الجلسة EGP (جنيه مصري)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" value={therapistDraft.consultationSettings.sessionPrice.EGP} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionPrice: { ...therapistDraft.consultationSettings!.sessionPrice, EGP: Number(e.target.value) || 0 } } })} /></div>
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">سعر الجلسة SAR (ريال سعودي)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" value={therapistDraft.consultationSettings.sessionPrice.SAR} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionPrice: { ...therapistDraft.consultationSettings!.sessionPrice, SAR: Number(e.target.value) || 0 } } })} /></div>
                  <div><label className="block text-xs font-bold text-gray-600 mb-1">سعر الجلسة USD (دولار أمريكي)</label><input type="number" className="w-full border border-gray-300 rounded-xl px-4 py-2.5" placeholder="0" value={therapistDraft.consultationSettings.sessionPrice.USD} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, sessionPrice: { ...therapistDraft.consultationSettings!.sessionPrice, USD: Number(e.target.value) || 0 } } })} /></div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <select className="border border-gray-300 rounded-xl px-4 py-2.5" value={therapistDraft.consultationSettings.meetingProvider} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, meetingProvider: e.target.value as 'zoom' | 'google_meet' | 'custom', providerBaseUrl: defaultMeetingBaseUrls[e.target.value as 'zoom' | 'google_meet' | 'custom'] } })}>
                    <option value="google_meet">Google Meet</option>
                    <option value="zoom">Zoom</option>
                    <option value="custom">رابط مخصص</option>
                  </select>
                  <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="رابط الأساس أو endpoint الخاص بالمنصة" value={therapistDraft.consultationSettings.providerBaseUrl} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, providerBaseUrl: e.target.value } })} />
                  <label className="flex items-center gap-2 border border-gray-300 rounded-xl px-4 py-2.5 bg-gray-50 text-sm font-medium text-gray-700">
                    <input type="checkbox" checked={therapistDraft.consultationSettings.autoCreateMeetingLink} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, autoCreateMeetingLink: e.target.checked } })} />
                    توليد رابط اجتماع تلقائياً
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="اسم المستخدم لبوابة المحاضر" value={therapistDraft.consultationSettings.portal.username} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, portal: { ...therapistDraft.consultationSettings!.portal, username: e.target.value } } })} />
                  <input className="border border-gray-300 rounded-xl px-4 py-2.5" placeholder="كلمة المرور" value={therapistDraft.consultationSettings.portal.password} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, portal: { ...therapistDraft.consultationSettings!.portal, password: e.target.value } } })} />
                  <input className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" placeholder="رابط نموذج intake أو استبيان ما قبل الجلسة" value={therapistDraft.consultationSettings.intakeFormUrl || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, intakeFormUrl: e.target.value } })} />
                  <textarea className="border border-gray-300 rounded-xl px-4 py-2.5 md:col-span-2" rows={3} placeholder="تعليمات الحجز أو تجهيزات ما قبل الجلسة" value={therapistDraft.consultationSettings.bookingNotes || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, bookingNotes: e.target.value } })} />
                </div>

                <div className="border border-gray-200 rounded-2xl p-4 bg-gray-50/60 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h5 className="font-bold text-gray-900">المواعيد المتاحة</h5>
                      <p className="text-xs text-gray-500">هذه المواعيد ستظهر في صفحات الاستشارة العامة وسيُبنى عليها جدول المحاضر.</p>
                    </div>
                    <button type="button" onClick={() => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: [...therapistDraft.consultationSettings!.availableSlots, blankTherapistSlot()] } })} className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold">
                      <Plus size={14} className="inline ml-1" />إضافة موعد
                    </button>
                  </div>

                  <div className="space-y-3">
                    {therapistDraft.consultationSettings.availableSlots.map((slot, index) => (
                      <div key={slot.id} className="grid grid-cols-1 md:grid-cols-6 gap-2 border border-gray-200 rounded-xl bg-white p-3">
                        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={slot.day} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, day: e.target.value as TherapistAvailabilitySlot['day'] } : item) } })}>
                          <option value="saturday">السبت</option>
                          <option value="sunday">الأحد</option>
                          <option value="monday">الاثنين</option>
                          <option value="tuesday">الثلاثاء</option>
                          <option value="wednesday">الأربعاء</option>
                          <option value="thursday">الخميس</option>
                          <option value="friday">الجمعة</option>
                        </select>
                        <input type="time" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={slot.startTime} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, startTime: e.target.value } : item) } })} />
                        <input type="time" className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={slot.endTime} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, endTime: e.target.value } : item) } })} />
                        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="وصف الموعد" value={slot.label || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item) } })} />
                        <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="رابط مباشر اختياري للجلسة" value={slot.meetingLink || ''} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, meetingLink: e.target.value } : item) } })} />
                        <div className="flex gap-2 items-center">
                          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                            <input type="checkbox" checked={slot.isActive} onChange={(e) => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.map((item, itemIndex) => itemIndex === index ? { ...item, isActive: e.target.checked } : item) } })} />
                            متاح
                          </label>
                          <button type="button" onClick={() => setTherapistDraft({ ...therapistDraft, consultationSettings: { ...therapistDraft.consultationSettings!, availableSlots: therapistDraft.consultationSettings!.availableSlots.filter((_, itemIndex) => itemIndex !== index) } })} className="px-2 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-bold">
                            حذف
                          </button>
                        </div>
                      </div>
                    ))}
                    {therapistDraft.consultationSettings.availableSlots.length === 0 && <p className="text-sm text-gray-500">لم تتم إضافة أي مواعيد بعد.</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          <button onClick={saveTherapist} className="bg-primary-600 hover:bg-primary-700 text-white font-bold px-5 py-2.5 rounded-xl transition">{editingTherapistId ? 'تحديث المحاضر' : 'إضافة محاضر'}</button>
        </div>
      )}
      <div className="mt-5 border-t pt-4 grid grid-cols-1 xl:grid-cols-2 gap-3 max-h-[620px] overflow-auto">
        {[...therapists].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)).map((row) => (
          <div key={row.id} className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img src={row.image || ''} alt={row.name} className="w-14 h-14 rounded-2xl object-cover border border-gray-200 bg-white" />
                <div className="min-w-0">
                  <p className="font-bold text-gray-800 truncate">{row.name}</p>
                  <p className="text-xs text-gray-500 truncate">{row.title || row.specialty}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500">ترتيب: {row.sortOrder ?? 99}</span>
                    {row.showOnHome && <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-700">الرئيسية</span>}
                    {row.showOnAbout && <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">عن المعهد</span>}
                    <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${row.consultationSettings?.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                      {row.consultationSettings?.enabled ? 'يستقبل جلسات' : 'تدريب فقط'}
                    </span>
                    {row.consultationSettings?.enabled && (
                      <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700">
                        {meetingProviderLabels[row.consultationSettings.meetingProvider]}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  onClick={() => updateTherapist({ ...row, showOnHome: !row.showOnHome })}
                  title="تبديل الظهور في الصفحة الرئيسية"
                  className={`px-2 py-1.5 rounded-lg text-xs font-bold transition ${row.showOnHome ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200' : 'bg-gray-100 text-gray-400 hover:bg-indigo-50 hover:text-indigo-600'}`}
                >🏠</button>
                <button
                  onClick={() => updateTherapist({ ...row, showOnAbout: !row.showOnAbout })}
                  title="تبديل الظهور في فريق العمل"
                  className={`px-2 py-1.5 rounded-lg text-xs font-bold transition ${row.showOnAbout ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-gray-100 text-gray-400 hover:bg-amber-50 hover:text-amber-600'}`}
                >ℹ️</button>
                <button onClick={() => startEditTherapist(row)} className="px-3 py-1.5 rounded-lg bg-primary-50 text-primary-700 text-sm">تعديل</button>
                <button onClick={() => deleteTherapist(row.id)} className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-sm">حذف</button>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4 text-sm">
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">الخبرة</p>
                <p className="font-bold text-gray-900">{row.experience} سنة</p>
              </div>
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">التقييم</p>
                <p className="font-bold text-gray-900">{row.rating}</p>
              </div>
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">سعر الاستشارة</p>
                <p className="font-bold text-gray-900">{row.consultationSettings?.enabled ? row.consultationSettings.sessionPrice.EGP : row.price.EGP} ج.م</p>
              </div>
              <div className="border border-gray-200 rounded-xl p-3 bg-white">
                <p className="text-xs text-gray-500">جلسات مرتبطة</p>
                <p className="font-bold text-gray-900">{consultations.filter((item) => item.therapistId === row.id || item.therapistName === row.name).length}</p>
              </div>
            </div>

            {row.consultationSettings?.enabled && (
              <div className="mt-4 border border-gray-200 rounded-xl bg-white p-3 space-y-2">
                <p className="text-xs text-gray-500">بوابة المحاضر</p>
                <p className="text-sm font-bold text-gray-800">{row.consultationSettings.portal.username}</p>
                <p className="text-xs text-gray-500">المواعيد المتاحة: {(row.consultationSettings.availableSlots || []).filter((slot) => slot.isActive).length}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  )}

  {activeTab === 'bundles' && (
    <BundlesManager
      isAdmin={isAdmin}
      bundles={bundles}
      courses={courses}
      isBundleFormOpen={isBundleFormOpen}
      setIsBundleFormOpen={setIsBundleFormOpen}
      editingBundleId={editingBundleId}
      setEditingBundleId={setEditingBundleId}
      bundleTitle={bundleTitle}
      setBundleTitle={setBundleTitle}
      bundleTitleEn={bundleTitleEn}
      setBundleTitleEn={setBundleTitleEn}
      bundleSlug={bundleSlug}
      setBundleSlug={setBundleSlug}
      bundleVideoUrl={bundleVideoUrl}
      setBundleVideoUrl={setBundleVideoUrl}
      bundleShortDesc={bundleShortDesc}
      setBundleShortDesc={setBundleShortDesc}
      bundleDescription={bundleDescription}
      setBundleDescription={setBundleDescription}
      bundleCourseIds={bundleCourseIds}
      setBundleCourseIds={setBundleCourseIds}
      bundlePrice={bundlePrice}
      setBundlePrice={setBundlePrice}
      bundleOriginalPrice={bundleOriginalPrice}
      setBundleOriginalPrice={setBundleOriginalPrice}
      bundleDetailsJson={bundleDetailsJson}
      setBundleDetailsJson={setBundleDetailsJson}
      bundleIsPublished={bundleIsPublished}
      setBundleIsPublished={setBundleIsPublished}
      saveBundle={saveBundle}
      startEditBundle={startEditBundle}
      deleteBundle={deleteBundle}
      updateBundle={updateBundle}
    />
  )}

  {activeTab === 'testimonials' && (
    <TestimonialsManager
      testimonials={testimonials}
      draft={testimonialDraft}
      setDraft={setTestimonialDraft}
      isFormOpen={isTestimonialFormOpen}
      setIsFormOpen={setIsTestimonialFormOpen}
      editingId={editingTestimonialId}
      setEditingId={setEditingTestimonialId}
      onSave={saveTestimonial}
      onStartEdit={startEditTestimonial}
      onDelete={deleteTestimonial}
    />
  )}

  {/* ═══════════════════════════════════════════════════════════════════
      DISCOUNTS TAB — الخصومات والكوبونات
  ═══════════════════════════════════════════════════════════════════ */}
  {activeTab === 'discounts' && (() => {
    const activeDiscounts = discounts.filter(d => d.active && (!d.expiresAt || d.expiresAt >= new Date().toISOString().slice(0,10)));
    const expiredDiscounts = discounts.filter(d => !d.active || (d.expiresAt && d.expiresAt < new Date().toISOString().slice(0,10)));
    const startEdit = (d: DiscountRule) => {
      setEditingDiscountId(d.id);
      setDiscountDraft({ type: d.type, targetId: d.targetId || '', discountPercent: d.discountPercent, label: d.label || '', promoCode: d.promoCode || '', active: d.active, expiresAt: d.expiresAt || '' });
    };
    const cancelEdit = () => { setEditingDiscountId(''); setDiscountDraft({ type: 'course', targetId: '', discountPercent: 10, label: '', promoCode: '', active: true, expiresAt: '' }); };
    const saveDiscount = () => {
      if (!discountDraft.discountPercent || discountDraft.discountPercent <= 0 || discountDraft.discountPercent > 100) { alert('نسبة الخصم يجب أن تكون بين 1 و 100'); return; }
      if (editingDiscountId) {
        updateDiscount({ ...discountDraft, id: editingDiscountId, createdAt: discounts.find(d => d.id === editingDiscountId)?.createdAt || new Date().toISOString() } as DiscountRule);
      } else {
        addDiscount({ ...discountDraft, id: `disc-${Date.now()}`, createdAt: new Date().toISOString() } as DiscountRule);
      }
      cancelEdit();
    };
    const typeLabel: Record<string, string> = { course: 'كورس بعينه', bundle: 'مسار/باقة', all_courses: 'كل الكورسات', therapist_consultation: 'مستشار بعينه', all_consultations: 'كل الاستشارات' };
    return (
      <div className="space-y-5 animate-fade-in" dir="rtl">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 rounded-2xl p-6 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold flex items-center gap-2">🎫 الخصومات والكوبونات</h2>
              <p className="text-emerald-100 text-sm mt-1">إدارة كوبونات الخصم وعروض الأسعار</p>
            </div>
            <div className="flex gap-3 text-center">
              <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black">{discounts.length}</p><p className="text-xs">إجمالي</p></div>
              <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black text-green-200">{activeDiscounts.length}</p><p className="text-xs">نشطة</p></div>
              <div className="bg-white/20 rounded-xl px-4 py-2"><p className="text-2xl font-black text-red-200">{expiredDiscounts.length}</p><p className="text-xs">منتهية</p></div>
            </div>
          </div>
        </div>

        {/* Cash Discount Setting */}
        <div className="bg-white border border-emerald-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">💵 خصم الدفع الفوري (الكاش)</h3>
          <p className="text-sm text-gray-500 mb-3">نسبة خصم تُطبَّق تلقائياً على الكورسات والمسارات عند الدفع بالكاش في صفحة الدفع. اضبطها على 0 لإلغاء التفعيل.</p>
          <div className="flex items-center gap-3 max-w-xs">
            <input
              type="number"
              min="0"
              max="100"
              className="border border-gray-300 rounded-xl px-4 py-2.5 text-sm w-32"
              placeholder="0"
              value={policyDrafts['checkout.cashDiscountPercent'] ?? content['checkout.cashDiscountPercent'] ?? ''}
              onChange={(e) => setPolicyDrafts(prev => ({ ...prev, 'checkout.cashDiscountPercent': e.target.value }))}
            />
            <span className="text-gray-600 font-bold">%</span>
            {policyDrafts['checkout.cashDiscountPercent'] !== undefined && (
              <>
                <button
                  onClick={() => {
                    setContentValue('checkout.cashDiscountPercent', policyDrafts['checkout.cashDiscountPercent'] ?? '');
                    setPolicyDrafts(prev => { const next = { ...prev }; delete next['checkout.cashDiscountPercent']; return next; });
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-sm"
                >
                  حفظ
                </button>
                <button
                  onClick={() => setPolicyDrafts(prev => { const next = { ...prev }; delete next['checkout.cashDiscountPercent']; return next; })}
                  className="px-4 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm"
                >
                  إلغاء
                </button>
              </>
            )}
          </div>
        </div>

        {/* Form */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4">{editingDiscountId ? '✏️ تعديل كوبون' : '➕ إضافة كوبون جديد'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">نوع الخصم</label>
              <select value={discountDraft.type} onChange={e => setDiscountDraft(p => ({ ...p, type: e.target.value as DiscountRule['type'], targetId: '' }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                <option value="course">كورس بعينه</option>
                <option value="bundle">مسار/باقة بعينها</option>
                <option value="all_courses">كل الكورسات</option>
                <option value="therapist_consultation">مستشار بعينه</option>
                <option value="all_consultations">كل الاستشارات</option>
              </select>
            </div>
            {(discountDraft.type === 'course') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اختر الكورس</label>
                <select value={discountDraft.targetId || ''} onChange={e => setDiscountDraft(p => ({ ...p, targetId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">— اختر كورساً —</option>
                  {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </div>
            )}
            {(discountDraft.type === 'bundle') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اختر المسار/الباقة</label>
                <select value={discountDraft.targetId || ''} onChange={e => setDiscountDraft(p => ({ ...p, targetId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">— اختر مساراً —</option>
                  {bundles.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                </select>
              </div>
            )}
            {(discountDraft.type === 'therapist_consultation') && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">اختر المستشار</label>
                <select value={discountDraft.targetId || ''} onChange={e => setDiscountDraft(p => ({ ...p, targetId: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400">
                  <option value="">— اختر مستشاراً —</option>
                  {therapists.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">نسبة الخصم %</label>
              <input type="number" min={1} max={100} value={discountDraft.discountPercent}
                onChange={e => setDiscountDraft(p => ({ ...p, discountPercent: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">كود الكوبون (اختياري)</label>
              <input type="text" placeholder="مثال: PSYCH20" value={discountDraft.promoCode || ''}
                onChange={e => setDiscountDraft(p => ({ ...p, promoCode: e.target.value.toUpperCase() }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">اسم/وصف الخصم</label>
              <input type="text" placeholder="مثال: خصم العيد" value={discountDraft.label || ''}
                onChange={e => setDiscountDraft(p => ({ ...p, label: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">تاريخ الانتهاء (اختياري)</label>
              <input type="date" value={discountDraft.expiresAt || ''}
                onChange={e => setDiscountDraft(p => ({ ...p, expiresAt: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={discountDraft.active} onChange={e => setDiscountDraft(p => ({ ...p, active: e.target.checked }))} className="w-4 h-4 rounded" />
                <span className="text-sm font-medium text-gray-700">نشط الآن</span>
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={saveDiscount} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition">
              {editingDiscountId ? 'حفظ التعديل' : 'إضافة الكوبون'}
            </button>
            {editingDiscountId && (
              <button onClick={cancelEdit} className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-bold transition">إلغاء</button>
            )}
          </div>
        </div>

        {/* Discounts List */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-800 mb-4">قائمة الكوبونات ({discounts.length})</h3>
          {discounts.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <div className="text-5xl mb-3">🎫</div>
              <p className="font-medium">لا يوجد كوبونات بعد</p>
              <p className="text-sm mt-1">استخدم الفورم أعلاه لإضافة أول كوبون خصم</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-100 text-gray-500 text-right">
                    <th className="pb-3 font-semibold">الوصف</th>
                    <th className="pb-3 font-semibold">الكود</th>
                    <th className="pb-3 font-semibold">النوع</th>
                    <th className="pb-3 font-semibold">الخصم</th>
                    <th className="pb-3 font-semibold">الانتهاء</th>
                    <th className="pb-3 font-semibold">الحالة</th>
                    <th className="pb-3 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {discounts.map(d => {
                    const isExpired = d.expiresAt && d.expiresAt < new Date().toISOString().slice(0,10);
                    const targetName = d.type === 'course' ? (courses.find(c => c.id === d.targetId)?.title || d.targetId) :
                      d.type === 'bundle' ? (bundles.find(b => b.id === d.targetId)?.title || d.targetId) :
                      d.type === 'therapist_consultation' ? (therapists.find(t => t.id === d.targetId)?.name || d.targetId) : '';
                    return (
                      <tr key={d.id} className={`border-b border-gray-50 hover:bg-gray-50 transition ${editingDiscountId === d.id ? 'bg-emerald-50' : ''}`}>
                        <td className="py-3 font-medium text-gray-800">{d.label || '—'}{targetName && <span className="block text-xs text-gray-400">{targetName}</span>}</td>
                        <td className="py-3"><span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs font-bold">{d.promoCode || '—'}</span></td>
                        <td className="py-3 text-gray-600 text-xs">{typeLabel[d.type] || d.type}</td>
                        <td className="py-3"><span className="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-lg text-sm">{d.discountPercent}%</span></td>
                        <td className="py-3 text-xs text-gray-500">{d.expiresAt || 'بلا تاريخ'}</td>
                        <td className="py-3">
                          {isExpired ? (
                            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-lg font-medium">منتهي</span>
                          ) : d.active ? (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-lg font-medium">نشط</span>
                          ) : (
                            <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-lg font-medium">موقف</span>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <button onClick={() => startEdit(d)} className="px-3 py-1 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition">تعديل</button>
                            <button onClick={() => updateDiscount({ ...d, active: !d.active })}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${d.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}>
                              {d.active ? 'وقف' : 'تفعيل'}
                            </button>
                            <button onClick={() => { if (window.confirm('حذف هذا الكوبون؟')) deleteDiscount(d.id); }}
                              className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition">حذف</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── New Promo Codes Section (Backend DB) ── */}
        <div className="bg-white border border-purple-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-800 flex items-center gap-2">🎟️ كوبونات الدفع (مع تتبع الاستخدام)</h3>
            <button
              onClick={() => setPromoFormOpen(o => !o)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold transition"
            >
              <Plus size={15} /> إضافة كوبون
            </button>
          </div>

          {promoFormOpen && (
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4">
              <h4 className="font-bold text-gray-700 mb-3 text-sm">➕ كوبون جديد</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">كود الكوبون *</label>
                  <input type="text" value={promoForm.code} onChange={e => setPromoForm(p => ({ ...p, code: e.target.value.toUpperCase().replace(/\s/g,'') }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="PSYCH20" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">نوع الخصم</label>
                  <select value={promoForm.discount_type} onChange={e => setPromoForm(p => ({ ...p, discount_type: e.target.value as 'percent' | 'fixed' }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white">
                    <option value="percent">نسبة مئوية %</option>
                    <option value="fixed">مبلغ ثابت</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">قيمة الخصم *</label>
                  <input type="number" min={1} value={promoForm.discount_value} onChange={e => setPromoForm(p => ({ ...p, discount_value: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">الحد الأدنى للطلب (EGP)</label>
                  <input type="number" min={0} value={promoForm.min_order_amount} onChange={e => setPromoForm(p => ({ ...p, min_order_amount: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">أقصى استخدام (فارغ = بلا حد)</label>
                  <input type="number" min={1} value={promoForm.max_uses} onChange={e => setPromoForm(p => ({ ...p, max_uses: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" placeholder="بلا حد" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">تاريخ الانتهاء (اختياري)</label>
                  <input type="date" value={promoForm.expires_at} onChange={e => setPromoForm(p => ({ ...p, expires_at: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={async () => {
                    if (!promoForm.code.trim()) { notify('error', 'كود الكوبون مطلوب'); return; }
                    try {
                      await mysqlAdmin.createPromoCode({ code: promoForm.code, discount_type: promoForm.discount_type, discount_value: promoForm.discount_value, min_order_amount: promoForm.min_order_amount, max_uses: promoForm.max_uses ? Number(promoForm.max_uses) : null, expires_at: promoForm.expires_at || null } as Record<string, unknown>);
                      notify('success', 'تم إنشاء الكوبون');
                      setPromoForm({ code: '', discount_type: 'percent', discount_value: 10, min_order_amount: 0, max_uses: '', expires_at: '' });
                      setPromoFormOpen(false);
                      loadPromoCodes();
                    } catch (err) { notify('error', err instanceof Error ? err.message : 'خطأ في الإنشاء'); }
                  }}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-bold transition"
                >
                  حفظ الكوبون
                </button>
                <button onClick={() => setPromoFormOpen(false)} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm">إلغاء</button>
              </div>
            </div>
          )}

          {promoLoading ? (
            <div className="text-center py-8 text-gray-400">جارٍ التحميل...</div>
          ) : promoCodes.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <div className="text-4xl mb-2">🎟️</div>
              <p>لا توجد كوبونات دفع بعد</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-100 text-gray-500 text-right">
                    <th className="pb-3 font-semibold">الكود</th>
                    <th className="pb-3 font-semibold">الخصم</th>
                    <th className="pb-3 font-semibold">الحد الأدنى</th>
                    <th className="pb-3 font-semibold">الاستخدام</th>
                    <th className="pb-3 font-semibold">الانتهاء</th>
                    <th className="pb-3 font-semibold">الحالة</th>
                    <th className="pb-3 font-semibold">إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {promoCodes.map(pc => {
                    const isExpired = pc.expires_at && pc.expires_at < new Date().toISOString().slice(0, 10);
                    const isFull = pc.max_uses != null && pc.used_count >= pc.max_uses;
                    return (
                      <tr key={pc.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                        <td className="py-3">
                          <span className="font-mono bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold text-xs">{pc.code}</span>
                        </td>
                        <td className="py-3 font-bold text-purple-700">
                          {pc.discount_value}{pc.discount_type === 'percent' ? '%' : ' EGP'}
                        </td>
                        <td className="py-3 text-xs text-gray-500">{pc.min_order_amount > 0 ? `${pc.min_order_amount} EGP` : '—'}</td>
                        <td className="py-3 text-xs">
                          <span className={isFull ? 'text-red-600 font-bold' : 'text-gray-600'}>
                            {pc.used_count} / {pc.max_uses ?? '∞'}
                          </span>
                        </td>
                        <td className="py-3 text-xs text-gray-500">{pc.expires_at ?? '—'}</td>
                        <td className="py-3">
                          {isExpired || isFull ? (
                            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-lg font-medium">{isFull ? 'مكتمل' : 'منتهي'}</span>
                          ) : pc.active ? (
                            <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-lg font-medium">نشط</span>
                          ) : (
                            <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-lg font-medium">موقف</span>
                          )}
                        </td>
                        <td className="py-3">
                          <div className="flex gap-2">
                            <button
                              onClick={async () => {
                                try {
                                  await mysqlAdmin.updatePromoCode(pc.id, { active: pc.active ? 0 : 1 } as Record<string, unknown>);
                                  loadPromoCodes();
                                } catch (err) { notify('error', err instanceof Error ? err.message : 'خطأ'); }
                              }}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${pc.active ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                            >
                              {pc.active ? 'وقف' : 'تفعيل'}
                            </button>
                            <button
                              onClick={async () => {
                                if (!window.confirm(`حذف الكوبون ${pc.code}؟`)) return;
                                try {
                                  await mysqlAdmin.deletePromoCode(pc.id);
                                  notify('success', 'تم حذف الكوبون');
                                  loadPromoCodes();
                                } catch (err) { notify('error', err instanceof Error ? err.message : 'خطأ'); }
                              }}
                              className="px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition"
                            >
                              حذف
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  })()}

    {/* ── Lesson Analytics Modal ─────────────────────────────────────────── */}
    {analyticsCourseId && analyticsRows.length >= 0 && (() => {
      const course = courses.find(c => c.id === analyticsCourseId);
      const maxViews = Math.max(...analyticsRows.map(r => r.view_count), 1);
      return (
        <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" onClick={() => setAnalyticsCourseId('')}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900">مشاهدات المحاضرات</h3>
                {course && <p className="text-xs text-gray-400">{course.title}</p>}
              </div>
              <button onClick={() => setAnalyticsCourseId('')} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 grid place-items-center"><X size={14} /></button>
            </div>
            <div className="overflow-y-auto p-5">
              {analyticsLoading ? (
                <div className="text-center py-10 text-gray-400">جارٍ التحميل...</div>
              ) : analyticsRows.length === 0 ? (
                <div className="text-center py-10 text-gray-400">لا توجد بيانات مشاهدات بعد</div>
              ) : (
                <div className="space-y-2">
                  {analyticsRows.map(row => (
                    <div key={row.id} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-5 text-left flex-shrink-0">{row.sort_order}</span>
                      <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{row.title}</span>
                      <div className="w-32 bg-gray-100 rounded-full h-2 flex-shrink-0">
                        <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${(row.view_count / maxViews) * 100}%` }} />
                      </div>
                      <span className="text-xs font-bold text-purple-700 w-12 text-left flex-shrink-0">{row.view_count.toLocaleString('ar-EG')}</span>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-gray-100 text-xs text-gray-400 text-center">
                    إجمالي المشاهدات: {analyticsRows.reduce((s, r) => s + r.view_count, 0).toLocaleString('ar-EG')}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    })()}

    </>
  );
}
