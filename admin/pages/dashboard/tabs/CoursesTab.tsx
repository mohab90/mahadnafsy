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
import InstructorsManager from './InstructorsManager';
import LecturesManager from './LecturesManager';
import CoursesManager from './CoursesManager';
import DiscountsManager from './DiscountsManager';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const _vk = '\x6d\x68\x64\x2d\x6e\x61\x66\x73\x79\x2d\x32\x30\x32\x36';
const obfV = (u: string): string => { if (!u || u.startsWith('enc:')) return u; try { return 'enc:' + btoa(u.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _vk.charCodeAt(i % _vk.length))).join('')); } catch { return u; } };
const deobfV = (u: string): string => { if (!u || !u.startsWith('enc:')) return u; try { return atob(u.slice(4)).split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ _vk.charCodeAt(i % _vk.length))).join(''); } catch { return u; } };

const slugify = (text: string): string => {
  const arabicToLatin: Record<string, string> = { '\u0623':'a','\u0625':'a','\u0622':'a','\u0627':'a','\u0628':'b','\u062a':'t','\u062b':'th','\u062c':'j','\u062d':'h','\u062e':'kh','\u062f':'d','\u0630':'z','\u0631':'r','\u0632':'z','\u0633':'s','\u0634':'sh','\u0635':'s','\u0636':'d','\u0637':'t','\u0638':'z','\u0639':'a','\u063a':'g','\u0641':'f','\u0642':'q','\u0643':'k','\u0644':'l','\u0645':'m','\u0646':'n','\u0647':'h','\u0648':'w','\u064a':'y','\u0649':'a','\u0629':'a','\u0621':'a' };
  return text.split('').map(c => arabicToLatin[c] ?? c).join('').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
};

const blankCourse = (): Course => ({ id: '', slug: '', title: '', description: '', shortDescription: '', instructor: '', thumbnail: '', category: 'General', type: 'Recorded', price: { EGP: 0, SAR: 0, USD: 0 }, originalPrice: { EGP: 0, SAR: 0, USD: 0 }, rating: 4.8, students: 0, modules: [], courseModules: [], duration: '', level: '\u0645\u0628\u062a\u062f\u0626', detailsContent: {}, promoVideoUrl: '', liveSessionUrl: '', galleryImages: [], certificateTemplateUrl: '', certificateTemplateName: '', isPublished: true });

const blankTherapist = (): Therapist => ({ id: '', name: '', specialty: '', image: '', experience: 1, rating: 4.8, price: { EGP: 0, SAR: 0, USD: 0 }, title: '', bio: '', featured: false, sortOrder: 99, showOnHome: false, showOnAbout: false, languages: [], focusAreas: [], qualifications: [], consultationSettings: { enabled: false, sessionDurationMinutes: 50, sessionPrice: { EGP: 0, SAR: 0, USD: 0 }, meetingProvider: 'google_meet', providerBaseUrl: defaultMeetingBaseUrls.google_meet, autoCreateMeetingLink: true, intakeFormUrl: '', bookingNotes: '', availableSlots: [], portal: { username: '', password: '', temporaryPassword: true } } });

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
  const [courseModulesDraft, setCourseModulesDraft] = useState<{ title: string; items: string[] }[]>([]);
  const [courseMaterialsDraft, setCourseMaterialsDraft] = useState<import('../../../types').CourseMaterial[]>([]);
  const [coursePainPoints, setCoursePainPoints] = useState<{ left: string[]; right: string[] }>({ left: ['', '', ''], right: ['', '', ''] });
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
    <>
  {activeTab === 'courses' && (
    <CoursesManager
      isAdmin={isAdmin}
      courses={courses}
      therapists={therapists}
      subscribers={subscribers}
      chapters={chapters}
      lectures={lectures}
      instituteGalleryImages={instituteGalleryImages}
      filteredCourses={filteredCourses}
      courseDraft={courseDraft}
      setCourseDraft={setCourseDraft}
      editingCourseId={editingCourseId}
      setEditingCourseId={setEditingCourseId}
      isCourseFormOpen={isCourseFormOpen}
      setIsCourseFormOpen={setIsCourseFormOpen}
      courseDetailsJson={courseDetailsJson}
      setCourseDetailsJson={setCourseDetailsJson}
      courseListSearch={courseListSearch}
      setCourseListSearch={setCourseListSearch}
      coursePainPoints={coursePainPoints}
      setCoursePainPoints={setCoursePainPoints}
      courseModulesDraft={courseModulesDraft}
      setCourseModulesDraft={setCourseModulesDraft}
      courseMaterialsDraft={courseMaterialsDraft}
      setCourseMaterialsDraft={setCourseMaterialsDraft}
      blankCourse={blankCourse}
      slugify={slugify}
      normalizeAccessEntry={normalizeAccessEntry}
      getCourseAccessStats={getCourseAccessStats}
      getCourseLectures={getCourseLectures}
      handleGalleryUpload={handleGalleryUpload}
      handleCertificateUpload={handleCertificateUpload}
      saveCourse={saveCourse}
      startEditCourse={startEditCourse}
      deleteCourse={deleteCourse}
      updateCourse={updateCourse}
      setLectureCourseId={setLectureCourseId}
      setActiveTab={setActiveTab}
      setSubscriberCourseFilter={setSubscriberCourseFilter}
      setAnalyticsCourseId={setAnalyticsCourseId}
      loadLessonAnalytics={loadLessonAnalytics}
      notify={notify}
    />
  )}

  {activeTab === 'lectures' && (
    <LecturesManager
      isAdmin={isAdmin}
      lectures={lectures}
      chapters={chapters}
      courses={courses}
      lectureCourseId={lectureCourseId}
      setLectureCourseId={setLectureCourseId}
      isLectureFormOpen={isLectureFormOpen}
      setIsLectureFormOpen={setIsLectureFormOpen}
      editingLectureId={editingLectureId}
      setEditingLectureId={setEditingLectureId}
      lectureDraft={lectureDraft}
      setLectureDraft={setLectureDraft}
      isChapterFormOpen={isChapterFormOpen}
      setIsChapterFormOpen={setIsChapterFormOpen}
      setEditingChapterId={setEditingChapterId}
      chapterDraft={chapterDraft}
      setChapterDraft={setChapterDraft}
      selectedCourseLectures={selectedCourseLectures}
      expandedLectureCourses={expandedLectureCourses}
      setExpandedLectureCourses={setExpandedLectureCourses}
      expandedLectureChapters={expandedLectureChapters}
      setExpandedLectureChapters={setExpandedLectureChapters}
      getCourseChapters={getCourseChapters}
      getCourseLectures={getCourseLectures}
      saveLecture={saveLecture}
      startEditLecture={startEditLecture}
      deleteLecture={deleteLecture}
      saveChapter={saveChapter}
      deleteChapter={deleteChapter}
      updateCourse={updateCourse}
      notify={notify}
    />
  )}

  {activeTab === 'instructors' && (
    <InstructorsManager
      isAdmin={isAdmin}
      therapists={therapists}
      consultations={consultations}
      isTherapistFormOpen={isTherapistFormOpen}
      setIsTherapistFormOpen={setIsTherapistFormOpen}
      editingTherapistId={editingTherapistId}
      setEditingTherapistId={setEditingTherapistId}
      therapistDraft={therapistDraft}
      setTherapistDraft={setTherapistDraft}
      onImageUpload={handleTherapistImageUpload}
      saveTherapist={saveTherapist}
      startEditTherapist={startEditTherapist}
      deleteTherapist={deleteTherapist}
      updateTherapist={updateTherapist}
    />
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
  {activeTab === 'discounts' && (
    <DiscountsManager
      discounts={discounts}
      editingDiscountId={editingDiscountId}
      setEditingDiscountId={setEditingDiscountId}
      discountDraft={discountDraft}
      setDiscountDraft={setDiscountDraft}
      addDiscount={addDiscount}
      updateDiscount={updateDiscount}
      deleteDiscount={deleteDiscount}
      courses={courses}
      bundles={bundles}
      therapists={therapists}
      policyDrafts={policyDrafts}
      setPolicyDrafts={setPolicyDrafts}
      content={content}
      setContentValue={setContentValue}
      promoCodes={promoCodes}
      promoLoading={promoLoading}
      promoForm={promoForm}
      setPromoForm={setPromoForm}
      promoFormOpen={promoFormOpen}
      setPromoFormOpen={setPromoFormOpen}
      loadPromoCodes={loadPromoCodes}
      createPromoCode={(payload) => mysqlAdmin.createPromoCode(payload)}
      updatePromoCode={(id, payload) => mysqlAdmin.updatePromoCode(id, payload)}
      deletePromoCode={(id) => mysqlAdmin.deletePromoCode(id)}
      notify={notify}
    />
  )}

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
