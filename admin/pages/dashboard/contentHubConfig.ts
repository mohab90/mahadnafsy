import type { TabKey } from './navigation';

export type ContentHubTab = {
  key: TabKey;
  label: string;
  icon: string;
};

export type ContentHubAction = {
  key: TabKey;
  label: string;
  description: string;
};

export const CONTENT_HUB_TABS: ContentHubTab[] = [
  { key: 'home_offer', label: 'الصفحة الرئيسية', icon: '⌂' },
  { key: 'about_page', label: 'عن المعهد', icon: 'i' },
  { key: 'policies', label: 'الشروط والسياسات', icon: '§' },
  { key: 'footer_settings', label: 'الفوتر والتواصل', icon: '#' },
  { key: 'page_courses', label: 'صفحة الكورسات', icon: 'C' },
  { key: 'page_bundles', label: 'صفحة المسارات', icon: 'B' },
  { key: 'page_consultations', label: 'صفحة الاستشارات', icon: 'Q' },
  { key: 'page_community', label: 'صفحة المجتمع', icon: 'M' },
  { key: 'page_instructors', label: 'صفحة الخبراء', icon: 'E' },
  { key: 'page_contact', label: 'صفحة التواصل', icon: '@' },
  { key: 'page_joinus', label: 'صفحة انضم إلينا', icon: '+' },
  // The two busiest sales pages on the site had no editor at all — 118 strings
  // between them (FAQ answers, guarantee text, lead-form labels, the whole
  // learning-path map) lived only as code defaults.
  { key: 'page_course_details', label: 'تفاصيل الكورس', icon: 'D' },
  { key: 'page_bundle_details', label: 'تفاصيل المسار', icon: 'P' },
  { key: 'page_misc', label: 'إعدادات متفرقة', icon: '~' },
  { key: 'hub_advanced', label: 'متقدم', icon: '*' },
];

// Only pages that have no sidebar entry of their own. Courses, bundles, lectures,
// quizzes, live streams and community were listed here *and* under المحتوى in the
// sidebar — the same page from two places, which is what "مينفعش يكون في أكثر من
// مكان" was about. They stay in the sidebar; the duplicate cards are gone.
export const CONTENT_HUB_ACTIONS: ContentHubAction[] = [
  { key: 'testimonials', label: 'آراء العملاء', description: 'إدارة الشهادات الاجتماعية المعروضة بالموقع' },
  { key: 'institute_gallery', label: 'معرض الصور', description: 'إدارة صور المعهد والفعاليات' },
];
