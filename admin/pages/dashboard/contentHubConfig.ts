import {
  BookOpen,
  Building2,
  FileText,
  GraduationCap,
  Home,
  Info,
  Layers,
  LayoutTemplate,
  MessageCircle,
  Phone,
  Route,
  Scale,
  Settings2,
  Terminal,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { TabKey } from './navigation';

export type ContentHubTab = {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  /** One line on the hub's card: what is edited there. */
  description: string;
};

export type ContentHubAction = {
  key: TabKey;
  label: string;
  description: string;
};

export const CONTENT_HUB_TABS: ContentHubTab[] = [
  { key: 'site_design', label: 'تصميم الموقع', icon: LayoutTemplate, description: 'التصميم اللي الموقع بيظهر بيه، والهيدر المتغير بألوانه التلاتة وكلام كل لون.' },
  { key: 'home_offer', label: 'الصفحة الرئيسية', icon: Home, description: 'كل أقسام الرئيسية بالترتيب: الأرقام، عرض الـ24 ساعة، الفيديو، الآراء، الأسئلة الشائعة.' },
  { key: 'about_page', label: 'عن المعهد', icon: Info, description: 'قصة المعهد وأرقامه وفريق العمل.' },
  { key: 'policies', label: 'الشروط والسياسات', icon: Scale, description: 'سياسة الخصوصية والشروط والأحكام.' },
  { key: 'footer_settings', label: 'الفوتر والتواصل', icon: Phone, description: 'اللوجو، أرقام التواصل، السوشيال ميديا، والفروع والقاعات.' },
  { key: 'page_courses', label: 'صفحة الكورسات', icon: BookOpen, description: 'عنوان صفحة الدبلومات، البحث، وأسماء الفلاتر.' },
  { key: 'page_bundles', label: 'صفحة المسارات', icon: Layers, description: 'شرح المسارات والباقات وكروت المسار.' },
  { key: 'page_consultations', label: 'صفحة الاستشارات', icon: MessageCircle, description: 'نصوص صفحة الاستشارات وخطواتها وسعر الجلسة السريعة.' },
  { key: 'page_community', label: 'صفحة المجتمع', icon: Users, description: 'عناوين أقسام المجتمع وعدد الأعضاء.' },
  { key: 'page_instructors', label: 'صفحة الخبراء', icon: GraduationCap, description: 'عنوان صفحة الخبراء ونصوص كارت المحاضر.' },
  { key: 'page_contact', label: 'صفحة التواصل', icon: Building2, description: 'عنوان صفحة تواصل معنا ونموذج الرسائل.' },
  { key: 'page_joinus', label: 'صفحة انضم إلينا', icon: UserPlus, description: 'صفحة التقديم كمحاضر: الأرقام والمزايا والنموذج.' },
  // The two busiest sales pages on the site had no editor at all — 118 strings
  // between them (FAQ answers, guarantee text, lead-form labels, the whole
  // learning-path map) lived only as code defaults.
  { key: 'page_course_details', label: 'تفاصيل الكورس', icon: FileText, description: 'كل نص جوه صفحة الدبلومة: السعر، الضمان، الأسئلة، ونموذج الاهتمام.' },
  { key: 'page_bundle_details', label: 'تفاصيل المسار', icon: Route, description: 'صفحة المسار: خريطة المحطات، الشهادة، المهارات، ونموذج الالتحاق.' },
  { key: 'page_misc', label: 'إعدادات متفرقة', icon: Settings2, description: 'أيقونة المتصفح، تعليمات الدفع، ونصوص الجلسة السريعة.' },
  { key: 'hub_advanced', label: 'متقدم', icon: Terminal, description: 'أي نص في الموقع بالمفتاح بتاعه، لو مش لاقيه في الصفحات اللي فوق.' },
];

// Only pages that have no sidebar entry of their own. Courses, bundles, lectures,
// quizzes, live streams and community were listed here *and* under المحتوى in the
// sidebar — the same page from two places, which is what "مينفعش يكون في أكثر من
// مكان" was about. They stay in the sidebar; the duplicate cards are gone.
export const CONTENT_HUB_ACTIONS: ContentHubAction[] = [
  { key: 'testimonials', label: 'آراء العملاء', description: 'إدارة الشهادات الاجتماعية المعروضة بالموقع' },
  { key: 'institute_gallery', label: 'معرض الصور', description: 'إدارة صور المعهد والفعاليات' },
];
