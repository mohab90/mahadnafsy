// Roles, permissions and their Arabic labels for the staff profile screen.
//
// Pure data lifted out of StaffProfile.tsx. Labels and the colour/preset maps
// stay together on purpose: a role that gains a label almost always needs a
// default permission set in the same change.

import type { StaffMember, StaffPermission } from '../../types';
import {
  ROLE_DEFAULT_PERMISSIONS as MASTER_ROLE_PERMS,
  getDefaultPermsArray,
} from '../../constants/permissions';

export const ROLE_LABELS: Record<string, string> = {
  instructor: 'محاضر', trainer: 'مدرب', expert: 'خبير', sales: 'مسئول مبيعات',
  manager: 'مدير', admin: 'أدمن', support: 'مسئول خدمة عملاء',
  reception_daqqi: 'ريسبشن الدقي', collection: 'مسئول تحصيل',
  accountant: 'محاسب', consultant: 'استشاري', daqqi_manager: 'مدير الدقي', online_manager: 'مدير أونلاين',
  sales_collection_manager: 'مدير المبيعات والتحصيل', hr: 'موارد بشرية',
  other: 'أخرى',
};

export const PERMISSION_LABELS: Record<StaffPermission, string> = {
  view_dashboard: 'عرض اللوحة الرئيسية',
  view_leads: 'عرض العملاء المحتملين (قراءة فقط)',
  manage_leads: 'إدارة العملاء المحتملين (تعديل)',
  delete_leads: 'حذف العملاء المحتملين',
  export_leads: 'تصدير بيانات العملاء المحتملين',
  view_subscribers: 'عرض عملاء الأونلاين (قراءة فقط)',
  manage_subscribers: 'إدارة عملاء الأونلاين (تعديل)',
  delete_subscribers: 'حذف عملاء الأونلاين',
  export_subscribers: 'تصدير بيانات عملاء الأونلاين',
  view_courses: 'عرض الكورسات (قراءة فقط)',
  manage_courses: 'إدارة الكورسات والمحتوى',
  manage_lectures: 'إدارة المحاضرات',
  manage_instructors: 'إدارة المحاضرين والخبراء',
  manage_bundles: 'إدارة الباقات / المسارات',
  manage_testimonials: 'إدارة آراء العملاء',
  manage_discounts: 'إدارة الخصومات والكوبونات',
  view_consultations: 'عرض الاستشارات (قراءة فقط)',
  manage_consultations: 'إدارة الاستشارات',
  view_community: 'عرض المجتمع (قراءة فقط)',
  manage_community: 'إدارة المجتمع',
  manage_content: 'تعديل محتوى الموقع',
  view_staff: 'عرض الموظفين (قراءة فقط)',
  manage_staff: 'إدارة الموظفين والصلاحيات',
  view_hr: 'عرض الموارد البشرية',
  manage_hr: 'إدارة الموارد البشرية',
  view_perf_sales: 'أداء فريق المبيعات فقط (بدون تفاصيل القسم)',
  view_perf_online: 'أداء فريق الأونلاين فقط (بدون تفاصيل القسم)',
  view_perf_daqqi: 'أداء فريق الدقي فقط (بدون تفاصيل القسم)',
  view_orders: 'عرض الطلبات والمدفوعات',
  manage_orders: 'إدارة الطلبات والمدفوعات',
  manage_payments: 'تسجيل وتعديل المدفوعات',
  approve_refunds: 'اعتماد أو رفض الاستردادات',
  view_financial: 'عرض النظام المحاسبي',
  manage_financial: 'إدارة النظام المحاسبي (تعديل)',
  view_reports: 'عرض التقارير والإحصائيات',
  manage_certificates: 'الشهادات (الأسعار والطلبات)',
  manage_sales_team: 'إدارة فريق المبيعات (التارجت والعروض)',
  manage_inbox: 'إدارة صندوق الوارد والمحادثات',
  manage_notifications: 'إدارة الإشعارات',
  manage_channel_settings: 'إعدادات قنوات التواصل',
  bulk_whatsapp: 'إرسال واتساب جماعي',
  view_join_us: 'عرض طلبات الانضمام',
  manage_join_us: 'إدارة طلبات الانضمام',
  view_contacts: 'عرض رسائل التواصل',
  manage_contacts: 'إدارة رسائل التواصل',
  view_activity: 'عرض سجل النشاط',
  manage_daqqi: 'إدارة جدول كورسات الدقي',
  manage_automation: 'إدارة الأتوميشن والوركفلو',
  view_security: 'عرض الأمن والمراقبة',
  manage_security: 'إدارة الأمن والمراقبة',
  view_settings: 'عرض إعدادات النظام',
  manage_settings: 'إدارة إعدادات النظام',
  ask_ai: 'استخدام المساعد الذكي (AI)',
  ai_dev: 'تبويب AI البرمجي',
  manage_ai_settings: 'إعدادات الذكاء الاصطناعي',
  view_client_db: 'عرض قاعدة العملاء الموحدة',
};

export const ROLE_OPTIONS: { value: StaffMember['role']; label: string }[] = [
  { value: 'manager', label: 'مدير' },
  { value: 'online_manager', label: 'مدير الأونلاين' },
  { value: 'daqqi_manager', label: 'مدير الدقي' },
  { value: 'sales_collection_manager', label: 'مدير المبيعات والتحصيل' },
  { value: 'sales', label: 'مسئول مبيعات' },
  { value: 'collection', label: 'مسئول تحصيل' },
  { value: 'support', label: 'مسئول خدمة عملاء' },
  { value: 'hr', label: 'موارد بشرية' },
  { value: 'accountant', label: 'محاسب' },
  { value: 'trainer', label: 'مدرب' },
  { value: 'consultant', label: 'استشاري' },
  { value: 'instructor', label: 'محاضر' },
  { value: 'expert', label: 'خبير' },
  { value: 'reception_daqqi', label: 'ريسبشن الدقي' },
  { value: 'admin', label: 'أدمن' },
  { value: 'other', label: 'أخرى' },
];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, StaffPermission[]> = {
  ...Object.fromEntries(
    Object.keys(MASTER_ROLE_PERMS).map(r => [r, getDefaultPermsArray(r) as StaffPermission[]])
  ),
  // Legacy roles kept for backwards-compat
  expert: ['view_dashboard', 'view_courses'] as StaffPermission[],
  other:  ['view_dashboard'] as StaffPermission[],
};

export const ROLE_PRESETS = [
  { role:'sales',                    icon:'🏷️', label:'مسئول مبيعات',            desc:'ليدات + عملاء أونلاين + طلبات' },
  { role:'collection',               icon:'💰', label:'مسئول تحصيل',             desc:'عملاء أونلاين + مدفوعات + مالية' },
  { role:'support',                  icon:'🎧', label:'مسئول خدمة عملاء',        desc:'ليدات + عملاء أونلاين + رسائل' },
  { role:'sales_collection_manager', icon:'🏆', label:'مدير المبيعات والتحصيل', desc:'إشراف على فرق المبيعات والتحصيل + تقارير' },
  { role:'online_manager',            icon:'🌐', label:'مدير الأونلاين',          desc:'إدارة عملاء الأونلاين + المحتوى + التحصيل' },
  { role:'daqqi_manager',             icon:'🏢', label:'مدير الدقي',              desc:'إدارة فرع الدقي + الجداول + الحضور' },
  { role:'hr',                       icon:'🧑‍💼', label:'موارد بشرية',              desc:'إدارة الفريق + الطلبات الوظيفية + التقارير' },
  { role:'reception_daqqi',          icon:'🏢', label:'ريسبشن الدقي',            desc:'ليدات + عملاء الدقي + الجدول' },
  { role:'manager',                  icon:'👔', label:'مدير',                     desc:'وصول كامل لكل الأقسام' },
  { role:'accountant',               icon:'📊', label:'محاسب',                    desc:'طلبات + تقارير مالية' },
  { role:'trainer',                  icon:'🎓', label:'مدرب',                     desc:'كورسات + محاضرات + عملاء أونلاين' },
  { role:'consultant',               icon:'💼', label:'استشاري',                  desc:'استشارات + ليدات + عملاء أونلاين' },
  { role:'instructor',               icon:'📚', label:'محاضر',                    desc:'كورسات ومحاضرات فقط' },
  { role:'other',                    icon:'⚙️', label:'أخرى',                     desc:'صلاحيات أساسية' },
];

export const PERM_CATEGORIES = [
  { key:'dashboard',   label:'اللوحة الرئيسية والتقارير',             icon:'📊', bg:'bg-slate-50',   border:'border-slate-200',   text:'text-slate-700',   perms:['view_dashboard','view_reports','view_activity'] as StaffPermission[] },
  // Each of these opens one department's team screen and nothing else in that
  // department — the performance of a team without its clients, its money or
  // its day-to-day.
  { key:'team_perf',   label:'أداء الفرق (بدون تفاصيل الأقسام)',       icon:'🏅', bg:'bg-violet-50',  border:'border-violet-200',  text:'text-violet-700',  perms:['view_perf_sales','view_perf_online','view_perf_daqqi'] as StaffPermission[] },
  { key:'leads',       label:'العملاء المحتملين (CRM / الليدات)',      icon:'👥', bg:'bg-blue-50',    border:'border-blue-200',    text:'text-blue-700',    perms:['view_leads','manage_leads','delete_leads','export_leads'] as StaffPermission[] },
  { key:'subscribers', label:'عملاء الأونلاين المسجلين',            icon:'🎓', bg:'bg-emerald-50', border:'border-emerald-200', text:'text-emerald-700', perms:['view_subscribers','manage_subscribers','delete_subscribers','export_subscribers'] as StaffPermission[] },
  { key:'courses',     label:'الكورسات والمحتوى التعليمي',             icon:'📚', bg:'bg-orange-50',  border:'border-orange-200',  text:'text-orange-700',  perms:['view_courses','manage_courses','manage_lectures','manage_instructors','manage_bundles','manage_discounts','manage_testimonials'] as StaffPermission[] },
  { key:'financial',   label:'الطلبات والنظام المالي',                 icon:'💰', bg:'bg-green-50',   border:'border-green-200',   text:'text-green-700',   perms:['view_orders','manage_orders','manage_payments','approve_refunds','view_financial','manage_financial'] as StaffPermission[] },
  { key:'consult',     label:'الاستشارات والمواعيد',                   icon:'🤝', bg:'bg-teal-50',    border:'border-teal-200',    text:'text-teal-700',    perms:['view_consultations','manage_consultations'] as StaffPermission[] },
  { key:'comm',        label:'التواصل والمجتمع والرسائل',              icon:'💬', bg:'bg-purple-50',  border:'border-purple-200',  text:'text-purple-700',  perms:['view_community','manage_community','manage_inbox','manage_notifications','manage_channel_settings','bulk_whatsapp','view_join_us','manage_join_us','view_contacts','manage_contacts'] as StaffPermission[] },
  { key:'team',        label:'إدارة الفريق والعمليات',                 icon:'👔', bg:'bg-indigo-50',  border:'border-indigo-200',  text:'text-indigo-700',  perms:['view_staff','manage_staff','view_hr','manage_hr','manage_daqqi'] as StaffPermission[] },
  { key:'system',      label:'الإعدادات والتطوير والذكاء الاصطناعي',  icon:'⚙️', bg:'bg-gray-50',    border:'border-gray-200',    text:'text-gray-700',    perms:['manage_content','manage_automation','ask_ai','ai_dev','manage_ai_settings','view_security','manage_security','view_settings','manage_settings'] as StaffPermission[] },
];

export const ACCESS_PREVIEW_TABS = [
  { label:'اللوحة الرئيسية',    icon:'📊', perms:['view_dashboard'] as StaffPermission[] },
  { label:'العملاء المحتملين',  icon:'👥', perms:['view_leads','manage_leads'] as StaffPermission[] },
  { label:'عملاء الأونلاين',    icon:'🎓', perms:['view_subscribers','manage_subscribers'] as StaffPermission[] },
  { label:'الكورسات',           icon:'📚', perms:['view_courses','manage_courses','manage_lectures'] as StaffPermission[] },
  { label:'الطلبات',            icon:'🛒', perms:['view_orders','manage_orders'] as StaffPermission[] },
  { label:'التقارير',           icon:'📈', perms:['view_reports'] as StaffPermission[] },
  { label:'المالية',            icon:'💰', perms:['view_financial','manage_financial'] as StaffPermission[] },
  { label:'الاستشارات',         icon:'🤝', perms:['view_consultations','manage_consultations'] as StaffPermission[] },
  { label:'المجتمع والرسائل',   icon:'💬', perms:['view_community','manage_community','manage_inbox'] as StaffPermission[] },
  { label:'الموظفين',           icon:'👔', perms:['view_staff','manage_staff'] as StaffPermission[] },
  { label:'الجدول (دقي)',       icon:'🏢', perms:['manage_daqqi'] as StaffPermission[] },
  { label:'الإعدادات',          icon:'⚙️', perms:['manage_content','manage_automation','manage_ai_settings'] as StaffPermission[] },
  { label:'الذكاء الاصطناعي',   icon:'🤖', perms:['ask_ai'] as StaffPermission[] },
];
