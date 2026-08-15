import React from 'react';
import { X } from 'lucide-react';
import type { LeadItem, LeadStatus, StaffMember, StaffPermission, PaymentItemType } from '../../types';
import {
  ROLE_DEFAULT_PERMISSIONS as MASTER_ROLE_PERMS,
  getDefaultPermsArray,
} from '../../constants/permissions';
import type { TabKey } from './navigation';
import { toDialable } from '../../lib/whatsappLink';

const PERMISSION_LABELS: Record<StaffPermission, string> = {
  // Dashboard overview
  view_dashboard: 'عرض اللوحة الرئيسية',
  // Leads
  view_leads: 'عرض العملاء المحتملين (قراءة فقط)',
  manage_leads: 'إدارة العملاء المحتملين (تعديل)',
  delete_leads: 'حذف العملاء المحتملين',
  export_leads: 'تصدير بيانات العملاء المحتملين',
  // Subscribers
  view_subscribers: 'عرض عملاء الأونلاين (قراءة فقط)',
  manage_subscribers: 'إدارة عملاء الأونلاين (تعديل)',
  delete_subscribers: 'حذف عملاء الأونلاين',
  export_subscribers: 'تصدير بيانات عملاء الأونلاين',
  // Courses & catalog
  view_courses: 'عرض الكورسات (قراءة فقط)',
  manage_courses: 'إدارة الكورسات والمحتوى',
  manage_lectures: 'إدارة المحاضرات',
  manage_instructors: 'إدارة المحاضرين والخبراء',
  manage_bundles: 'إدارة الباقات / المسارات',
  manage_testimonials: 'إدارة آراء العملاء',
  manage_discounts: 'إدارة الخصومات والكوبونات',
  // Consultations
  view_consultations: 'عرض الاستشارات (قراءة فقط)',
  manage_consultations: 'إدارة الاستشارات',
  // Community
  view_community: 'عرض المجتمع (قراءة فقط)',
  manage_community: 'إدارة المجتمع',
  // Content & website
  manage_content: 'تعديل محتوى الموقع',
  // Staff
  view_staff: 'عرض الموظفين (قراءة فقط)',
  manage_staff: 'إدارة الموظفين والصلاحيات',
  view_hr: 'عرض الموارد البشرية',
  manage_hr: 'إدارة الموارد البشرية',
  // Orders & payments
  view_orders: 'عرض الطلبات والمدفوعات',
  manage_orders: 'إدارة الطلبات والمدفوعات',
  manage_payments: 'تسجيل وتعديل المدفوعات',
  approve_refunds: 'اعتماد أو رفض الاستردادات',
  view_financial: 'عرض النظام المحاسبي',
  manage_financial: 'إدارة النظام المحاسبي (تعديل)',
  // Reports
  view_reports: 'عرض التقارير والإحصائيات',
  manage_certificates: 'الشهادات (الأسعار والطلبات)',
  manage_sales_team: 'إدارة فريق المبيعات (التارجت والعروض)',
  // Messaging & inbox
  manage_inbox: 'إدارة صندوق الوارد والمحادثات',
  manage_notifications: 'إدارة الإشعارات',
  manage_channel_settings: 'إعدادات قنوات التواصل',
  bulk_whatsapp: 'إرسال واتساب جماعي',
  // Communication records
  view_join_us: 'عرض طلبات الانضمام',
  manage_join_us: 'إدارة طلبات الانضمام',
  view_contacts: 'عرض رسائل التواصل',
  manage_contacts: 'إدارة رسائل التواصل',
  // Operations
  view_activity: 'عرض سجل النشاط',
  manage_daqqi: 'إدارة جدول كورسات الدقي',
  manage_automation: 'إدارة الأتوميشن والوركفلو',
  view_security: 'عرض الأمن والمراقبة',
  manage_security: 'إدارة الأمن والمراقبة',
  view_settings: 'عرض إعدادات النظام',
  manage_settings: 'إدارة إعدادات النظام',
  // Client database
  view_client_db: 'عرض قاعدة العملاء الموحدة',
  // AI
  ask_ai: 'استخدام المساعد الذكي (AI)',
  ai_dev: 'تبويب AI البرمجي',
  manage_ai_settings: 'إعدادات الذكاء الاصطناعي',
};

// ── Daqqi helpers (module-level so they're usable in both Dashboard and SubscriberDetails) ──
const calcCurrentLecture = (startDate: string, postponedWeeks?: string[]): number => {
  if (!startDate) return 1;
  const start = new Date(startDate);
  const today = new Date();
  const daysDiff = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const weeksElapsed = Math.max(0, Math.floor(daysDiff / 7));
  return Math.max(1, weeksElapsed + 1 - (postponedWeeks?.length || 0));
};

const getCurrentWeekKey = (): string => {
  const d = new Date();
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return monday.toISOString().slice(0, 10);
};





const blankLead = (): LeadItem => ({
  id: `l-${Date.now()}`,
  name: '',
  email: '',
  phone: '',
  source: 'Manual',
  status: 'new',
  createdAt: new Date().toLocaleString('ar-EG', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }),
  leadType: 'course',
  branch: '' as LeadItem['branch'],
  interestedCourseIds: [],
  communications: [],
  notes: '',
  hidden: false,
});

const blankStaffMember = (): StaffMember => ({
  id: `staff-${Date.now()}`,
  name: '',
  email: '',
  phone: '',
  role: 'sales',
  joinedAt: new Date().toISOString().slice(0, 10),
  status: 'active',
  notes: '',
  permissions: [],
});

// ── Subscriber status config ──────────────────────────────────────────────────
type SubStatus = 'active_new' | 'active_paid' | 'active_late' | 'active' | 'paused' | 'blocked' | 'finished' | 'refunded' | 'refund_pending';
const SUB_STATUS_CFG: Record<SubStatus, { label: string; cls: string }> = {
  active_new:  { label: 'نشط جديد',           cls: 'bg-sky-100 text-sky-800' },
  active_paid: { label: 'نشط ودافع',          cls: 'bg-emerald-100 text-emerald-800' },
  active_late: { label: 'نشط متأخر الدفع',    cls: 'bg-amber-100 text-amber-800' },
  active:      { label: 'نشط',                cls: 'bg-green-100 text-green-700' },
  paused:      { label: 'متوقف',              cls: 'bg-gray-100 text-gray-600' },
  blocked:     { label: 'محظور',              cls: 'bg-red-100 text-red-700' },
  finished:    { label: 'منتهي',              cls: 'bg-green-100 text-green-700' },
  refunded:       { label: 'مسترد',              cls: 'bg-red-100 text-red-700' },
  refund_pending:  { label: 'استرداد معلق',      cls: 'bg-orange-100 text-orange-700' },
};
const subStatusBadge = (s?: string) => {
  const cfg = SUB_STATUS_CFG[(s || 'active') as SubStatus] || SUB_STATUS_CFG.active;
  return <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${cfg.cls}`}>{cfg.label}</span>;
};
// Helper — show first 2 words of a name
const shortName = (n: string) => n.split(/\s+/).slice(0, 2).join(' ');
const crmSourceLabels: Record<string, { label: string; color: string }> = {
  'تسجيل اهتمام': { label: 'تسجيل اهتمام', color: 'bg-blue-100 text-blue-700' },
  'عرض 24 ساعة': { label: 'عرض 24 ساعة', color: 'bg-red-100 text-red-700' },
  'تسجيل دخول': { label: 'تسجيل دخول', color: 'bg-purple-100 text-purple-700' },
  'عميل فيسبوك': { label: 'عميل فيسبوك', color: 'bg-indigo-100 text-indigo-700' },
  'Manual': { label: 'يدوي', color: 'bg-gray-100 text-gray-600' },
};
const crmInterestLabels: Record<string, string> = { low: 'منخفض', medium: 'متوسط', high: 'مرتفع' };
const crmStatusLabels: Record<LeadStatus | string, string> = {
  new:                  'جديد',
  contacted:            'تم التواصل',
  interested:           'مهتم',
  interested_booking:   'مهتم بالحجز',
  interested_followup:  'مهتم ومتابعة',
  postpone_month:       'هيأجل أكثر من شهر',
  not_interested:       'مش مهتم',
  no_answer:            'لا يرد',
  no_answer_wa:         'لا يرد وبعتله واتس',
  no_answer_nowa:       'لا يرد ومفيش واتس',
  wrong_number:         'الرقم غلط/مقفول دائماً',
  with_colleague:       'مع زميل آخر',
  not_interested_hidden:'مش مهتم ومخفي',
  closed:               'مغلق / غير متاح',
  converted:            'تحول لمشترك',
  lost:                 'مفقود',
  other:                'أخرى',
};
const crmStatusColors: Record<LeadStatus | string, string> = {
  new: 'text-blue-700',
  contacted: 'text-amber-700',
  interested: 'text-green-700',
  not_interested: 'text-red-600',
  no_answer: 'text-gray-500',
  closed: 'text-gray-700',
  converted: 'text-emerald-700',
};
const crmRoleLabels: Record<string, string> = { instructor: 'محاضر', trainer: 'مدرب', expert: 'خبير', sales: 'مسئول مبيعات', manager: 'مدير', admin: 'أدمن', support: 'مسئول خدمة عملاء', reception_daqqi: 'ريسبشن الدقي', daqqi_manager: 'مدير الدقي', online_manager: 'مدير أونلاين', collection: 'مسئول تحصيل', accountant: 'محاسب', consultant: 'استشاري', sales_collection_manager: 'مدير المبيعات والتحصيل', hr: 'موارد بشرية', other: 'أخرى' };

// Role default permissions — derived from master constants (admin/constants/permissions.ts)
// getDefaultPermsArray converts '*' (full access) → full list, so this is always StaffPermission[]
const ROLE_DEFAULT_PERMISSIONS: Record<string, StaffPermission[]> = {
  // Pull every known role from the master source automatically
  ...Object.fromEntries(
    Object.keys(MASTER_ROLE_PERMS).map(r => [r, getDefaultPermsArray(r) as StaffPermission[]])
  ),
  // Legacy roles kept for UI backwards-compat (not in master 14-role list)
  expert: ['view_dashboard', 'view_courses'] as StaffPermission[],
  other:  ['view_dashboard'] as StaffPermission[],
};
// Dummy reference to suppress "unused import" lint warnings
void (MASTER_ROLE_PERMS as unknown);
const paymentTypeLabels: Record<PaymentItemType, string> = { course: 'كورس', certificate: 'شهادة', consultation: 'استشارة', book: 'كتاب', carneh: 'كارنيه', other: 'أخرى' };
// Format phone for WhatsApp: prepend Egypt country code for local numbers
// Delegates to the shared rule — this used to build country code "2".
const formatWaPhone = (p: string | null | undefined) => toDialable(p);

// Normalize branch id/value for case-insensitive comparison
// DB stores uppercase ENUM (DAQQI, ONLINE_EGYPT) but admin may configure lowercase (daqqi, online-egypt)
const normBranchId = (v: string | null | undefined): string => v ? v.toUpperCase().replace(/[-\s]/g, '_') : '';

const LEAD_STATUS_CFG: Record<LeadStatus, { label: string; color: string; colColor: string }> = {
  new:                  { label: 'جديد',                  color: 'bg-blue-50 border-blue-200 text-blue-800',         colColor: 'border-t-blue-500' },
  contacted:            { label: 'تم التواصل',            color: 'bg-amber-50 border-amber-200 text-amber-800',       colColor: 'border-t-amber-500' },
  interested:           { label: 'مهتم',                  color: 'bg-emerald-50 border-emerald-200 text-emerald-800', colColor: 'border-t-emerald-500' },
  interested_booking:   { label: 'مهتم بالحجز',          color: 'bg-green-100 border-green-300 text-green-800',      colColor: 'border-t-green-600' },
  interested_followup:  { label: 'مهتم ومتابعة',         color: 'bg-teal-50 border-teal-200 text-teal-800',          colColor: 'border-t-teal-500' },
  postpone_month:       { label: 'هيأجل >شهر',           color: 'bg-yellow-50 border-yellow-200 text-yellow-800',    colColor: 'border-t-yellow-500' },
  not_interested:       { label: 'مش مهتم',               color: 'bg-red-50 border-red-200 text-red-700',             colColor: 'border-t-red-400' },
  no_answer:            { label: 'لا يرد',                color: 'bg-gray-50 border-gray-200 text-gray-700',          colColor: 'border-t-gray-400' },
  no_answer_wa:         { label: 'لا يرد+واتس',          color: 'bg-slate-50 border-slate-200 text-slate-600',       colColor: 'border-t-slate-400' },
  no_answer_nowa:       { label: 'لا يرد-واتس',          color: 'bg-gray-100 border-gray-300 text-gray-600',         colColor: 'border-t-gray-500' },
  wrong_number:         { label: 'رقم غلط/مقفول',        color: 'bg-orange-50 border-orange-200 text-orange-700',    colColor: 'border-t-orange-400' },
  with_colleague:       { label: 'مع زميل آخر',          color: 'bg-purple-50 border-purple-200 text-purple-700',    colColor: 'border-t-purple-500' },
  not_interested_hidden:{ label: 'مش مهتم ومخفي',        color: 'bg-red-100 border-red-300 text-red-800',            colColor: 'border-t-red-600' },
  closed:               { label: 'مغلق',                  color: 'bg-violet-50 border-violet-200 text-violet-700',    colColor: 'border-t-violet-500' },
  converted:            { label: 'تحول لمشترك',          color: 'bg-green-50 border-green-200 text-green-800',       colColor: 'border-t-green-500' },
  lost:                 { label: 'مفقود',                 color: 'bg-red-50 border-red-100 text-red-400',             colColor: 'border-t-red-300' },
  other:                { label: 'أخرى',                  color: 'bg-gray-50 border-gray-200 text-gray-500',          colColor: 'border-t-gray-300' },
};

// ── Cert Pricing sub-component (extracted to avoid hooks-in-IIFE rule violation) ──
type CertPricingMap = Record<string, { egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number }>;

function CertPricingTab({ certPricingMap, saveCertPricingMap, notify }: {
  certPricingMap: CertPricingMap;
  saveCertPricingMap: (map: CertPricingMap) => void;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  // Dynamic cert types derived from the saved map + static defaults
  const DEFAULT_CERT_TYPES = [
    { key: 'social_solidarity', label: 'شهادة التضامن الاجتماعي' },
    { key: 'ain_shams', label: 'شهادة جامعة عين شمس' },
    { key: 'experience_external', label: 'شهادة الخبرة' },
    { key: 'practice_external', label: 'شهادة التطبيقين' },
    { key: 'national_council', label: 'شهادة المجلس الوطني' },
    { key: 'american_board', label: 'شهادة البورد الأمريكي' },
    { key: 'institute', label: 'شهادة المعهد' },
    { key: 'other', label: 'شهادة أخرى' },
  ];

  // Build initial type list: defaults + any extra keys from saved map
  const buildTypes = (map: CertPricingMap) => {
    const base = DEFAULT_CERT_TYPES.map(t => t.key);
    const extra = Object.keys(map).filter(k => !base.includes(k)).map(k => ({ key: k, label: k }));
    return [...DEFAULT_CERT_TYPES, ...extra];
  };

  const [certTypes, setCertTypes] = React.useState(() => buildTypes(certPricingMap));
  const [localMap, setLocalMap] = React.useState<CertPricingMap>(() => {
    const m: CertPricingMap = {};
    buildTypes(certPricingMap).forEach(t => {
      m[t.key] = certPricingMap[t.key] || { egyptianEGP: 0, residentEGP: 0, residentSAR: 0, foreignUSD: 0 };
    });
    return m;
  });

  // Add new cert type form
  const [newKey, setNewKey] = React.useState('');
  const [newLabel, setNewLabel] = React.useState('');

  React.useEffect(() => {
    const types = buildTypes(certPricingMap);
    setCertTypes(types);
    const fresh: CertPricingMap = {};
    types.forEach(t => {
      fresh[t.key] = certPricingMap[t.key] || { egyptianEGP: 0, residentEGP: 0, residentSAR: 0, foreignUSD: 0 };
    });
    setLocalMap(fresh);
  }, [certPricingMap]);

  const setPrice = (type: string, field: keyof CertPricingMap[string], val: string) => {
    setLocalMap(prev => ({ ...prev, [type]: { ...prev[type], [field]: Number(val) || 0 } }));
  };

  const addCertType = () => {
    const k = newKey.trim().replace(/\s+/g, '_');
    const l = newLabel.trim();
    if (!k || !l) return;
    if (certTypes.some(t => t.key === k)) { notify('error', 'هذا الكود موجود بالفعل.'); return; }
    const newTypes = [...certTypes, { key: k, label: l }];
    setCertTypes(newTypes);
    setLocalMap(prev => ({ ...prev, [k]: { egyptianEGP: 0, residentEGP: 0, residentSAR: 0, foreignUSD: 0 } }));
    setNewKey('');
    setNewLabel('');
  };

  const deleteCertType = (key: string) => {
    if (!window.confirm('حذف هذا النوع من الشهادات نهائياً؟')) return;
    const newTypes = certTypes.filter(t => t.key !== key);
    setCertTypes(newTypes);
    setLocalMap(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  return (
    <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-gray-900">تسعير الشهادات الإضافية</h3>
          <p className="text-xs text-gray-500 mt-0.5">حدد سعر كل شهادة لكل فئة جنسية. اتركها صفراً إذا كانت مجانية أو تُسعَّر يدوياً.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            // Only save types that are in current certTypes list
            const mapToSave: CertPricingMap = {};
            certTypes.forEach(t => { mapToSave[t.key] = localMap[t.key] || { egyptianEGP: 0, residentEGP: 0, residentSAR: 0, foreignUSD: 0 }; });
            saveCertPricingMap(mapToSave);
            notify('success', 'تم حفظ الأسعار بنجاح.');
          }}
          className="px-4 py-2 bg-primary-600 text-white text-sm font-bold rounded-xl"
        >
          حفظ الأسعار
        </button>
      </div>

      {/* Add new cert type */}
      <div className="border border-dashed border-gray-300 rounded-xl p-3 bg-gray-50">
        <p className="text-xs font-bold text-gray-600 mb-2">➕ إضافة نوع شهادة جديد</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={newKey}
            onChange={e => setNewKey(e.target.value)}
            placeholder="كود الشهادة (بدون مسافات)"
            className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
            dir="ltr"
          />
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="اسم الشهادة بالعربية"
            className="flex-1 min-w-[140px] border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={addCertType}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold"
          >إضافة</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 text-right">
              <th className="py-2 px-3 font-bold text-gray-700 border border-gray-200 text-right">نوع الشهادة</th>
              <th className="py-2 px-3 font-bold text-blue-700 border border-gray-200 text-center">🇪🇬 مصري (ج.م)</th>
              <th className="py-2 px-3 font-bold text-green-700 border border-gray-200 text-center">👤 غير مصري مقيم في مصر (ج.م)</th>
              <th className="py-2 px-3 font-bold text-amber-700 border border-gray-200 text-center">🇸🇦 مقيم في السعودية (ر.س)</th>
              <th className="py-2 px-3 font-bold text-purple-700 border border-gray-200 text-center">✈️ دولي خارج مصر والسعودية ($)</th>
              <th className="py-2 px-3 font-bold text-gray-400 border border-gray-200 text-center">حذف</th>
            </tr>
          </thead>
          <tbody>
            {certTypes.map(t => {
              const row = localMap[t.key] || { egyptianEGP: 0, residentEGP: 0, residentSAR: 0, foreignUSD: 0 };
              const isDefault = DEFAULT_CERT_TYPES.some(d => d.key === t.key);
              return (
                <tr key={t.key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 border border-gray-200 font-medium text-gray-800">
                    {t.label}
                    {!isDefault && <span className="mr-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">مضاف</span>}
                  </td>
                  {(['egyptianEGP', 'residentEGP', 'residentSAR', 'foreignUSD'] as const).map(field => (
                    <td key={field} className="py-1 px-2 border border-gray-200">
                      <input
                        type="number"
                        min="0"
                        value={row[field] || ''}
                        onChange={e => setPrice(t.key, field, e.target.value)}
                        placeholder="0"
                        className="w-full text-center border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-primary-400"
                      />
                    </td>
                  ))}
                  <td className="py-1 px-2 border border-gray-200 text-center">
                    <button
                      type="button"
                      onClick={() => deleteCertType(t.key)}
                      className="p-1.5 rounded hover:bg-red-100 text-red-500"
                      title="حذف"
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}

// ── Branch Add Form sub-component (extracted to avoid hooks-in-IIFE rule violation) ──
type BranchRoom = { name: string; capacity: number };
type BranchEntry = { id: string; label: string; rooms?: BranchRoom[] };

function BranchAddForm({ instituteBranches, setContentValue }: {
  instituteBranches: BranchEntry[];
  setContentValue: (key: string, value: string) => Promise<boolean>;
}) {
  const [newBranchId, setNewBranchId] = React.useState('');
  const [newBranchLabel, setNewBranchLabel] = React.useState('');
  const [expandedBranchId, setExpandedBranchId] = React.useState<string>('');
  const [newRoomName, setNewRoomName] = React.useState('');
  const [newRoomCapacity, setNewRoomCapacity] = React.useState('');
  const saveBranches = (list: BranchEntry[]) => {
    setContentValue('institute.branches', JSON.stringify(list, null, 2));
  };
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={newBranchId}
          onChange={(e) => setNewBranchId(e.target.value)}
          placeholder="كود الفرع (online-egypt)"
          className="flex-1 min-w-[140px] border border-gray-300 rounded-xl px-3 py-2 text-sm"
          dir="ltr"
        />
        <input
          value={newBranchLabel}
          onChange={(e) => setNewBranchLabel(e.target.value)}
          placeholder="اسم الفرع (أونلاين عن بعد)"
          className="flex-1 min-w-[140px] border border-gray-300 rounded-xl px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            if (!newBranchId.trim() || !newBranchLabel.trim()) return;
            if (instituteBranches.some(b => b.id === newBranchId.trim())) return;
            saveBranches([...instituteBranches, { id: newBranchId.trim(), label: newBranchLabel.trim(), rooms: [] }]);
            setNewBranchId('');
            setNewBranchLabel('');
          }}
          className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-bold"
        >
          إضافة
        </button>
      </div>
      <div className="space-y-2">
        {instituteBranches.map((b, i) => {
          const isExpanded = expandedBranchId === b.id;
          const rooms = b.rooms || [];
          return (
            <div key={b.id} className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
                <button type="button" onClick={() => setExpandedBranchId(isExpanded ? '' : b.id)} className="flex items-center gap-2 flex-1 text-right">
                  <span className="font-semibold text-gray-800 text-sm">{b.label}</span>
                  <span className="text-xs text-gray-400" dir="ltr">{b.id}</span>
                  {rooms.length > 0 && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">{rooms.length} قاعة</span>}
                  <span className="mr-auto text-gray-400 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </button>
                <div className="flex gap-1 mr-2">
                  {i > 0 && <button type="button" onClick={() => { const l=[...instituteBranches]; [l[i-1],l[i]]=[l[i],l[i-1]]; saveBranches(l); }} className="p-1.5 rounded hover:bg-gray-200 text-gray-500 text-xs">↑</button>}
                  {i < instituteBranches.length - 1 && <button type="button" onClick={() => { const l=[...instituteBranches]; [l[i],l[i+1]]=[l[i+1],l[i]]; saveBranches(l); }} className="p-1.5 rounded hover:bg-gray-200 text-gray-500 text-xs">↓</button>}
                  <button type="button" onClick={() => saveBranches(instituteBranches.filter((_,j) => j !== i))} className="p-1.5 rounded hover:bg-red-100 text-red-600">
                    <X size={14}/>
                  </button>
                </div>
              </div>
              {isExpanded && (
                <div className="px-3 py-3 bg-white border-t border-gray-100">
                  <p className="text-xs font-bold text-gray-600 mb-2">قاعات التدريب</p>
                  {rooms.length > 0 && (
                    <div className="space-y-1 mb-3">
                      {rooms.map((room, ri) => (
                        <div key={ri} className="flex items-center gap-2 bg-gray-50 rounded-lg px-2 py-1.5">
                          <span className="text-sm font-semibold text-gray-800 flex-1">{room.name}</span>
                          {room.capacity > 0 && <span className="text-xs text-gray-500">{room.capacity} فرد</span>}
                          <button type="button" onClick={() => {
                            const updated = [...instituteBranches];
                            updated[i] = { ...b, rooms: rooms.filter((_, rj) => rj !== ri) };
                            saveBranches(updated);
                          }} className="p-1 rounded hover:bg-red-100 text-red-500"><X size={12}/></button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={newRoomName}
                      onChange={e => setNewRoomName(e.target.value)}
                      placeholder="اسم القاعة"
                      className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <input
                      value={newRoomCapacity}
                      onChange={e => setNewRoomCapacity(e.target.value)}
                      placeholder="السعة"
                      type="number"
                      min="0"
                      className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <button type="button" onClick={() => {
                      if (!newRoomName.trim()) return;
                      const updated = [...instituteBranches];
                      updated[i] = { ...b, rooms: [...rooms, { name: newRoomName.trim(), capacity: Number(newRoomCapacity) || 0 }] };
                      saveBranches(updated);
                      setNewRoomName('');
                      setNewRoomCapacity('');
                    }} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-bold">إضافة</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {instituteBranches.length === 0 && <p className="text-sm text-gray-400">لا توجد فروع بعد. أضف فرعاً ليظهر في نماذج التسجيل.</p>}
      </div>
    </>
  );
}

// ── Module-level constants (no component state dependency) ─────────────────
const _normalizeAr = (s: string) =>
  s.replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();

const _normClientPhone = (p: string | null | undefined) => (p || '').replace(/\D/g, '');
const _normClientEmail = (e: string) => (e || '').toLowerCase().trim();
const _normalizeClientDate = (d: unknown): string => {
  if (!d) return '';
  if ((d as { toDate?: () => Date }).toDate) return (d as { toDate: () => Date }).toDate().toISOString();
  if ((d as { seconds?: number }).seconds) return new Date((d as { seconds: number }).seconds * 1000).toISOString();
  const p = new Date(d as string);
  return isNaN(p.getTime()) ? '' : p.toISOString();
};

const TAB_PERMISSION_MAP: Partial<Record<TabKey, StaffPermission>> = {
  // The company-wide overview, not a personal home page — every employee has
  // view_dashboard, so mapping it there put the whole الإدارة group in every
  // staff member's sidebar. Personal landing pages are staff_home / my_hr.
  overview:           'view_reports',
  kpi_dashboard:      'view_reports',
  analytics:          'view_reports',
  ask_ai:             'ask_ai',
  ai_dev:             'ai_dev',
  tasks_board:        'view_reports',
  // Running the online-clients desk, not merely reading a subscriber record:
  // sales reps hold view_subscribers so they can see who a lead converted into,
  // and gating this on it put the whole الأونلاين group in their sidebar.
  online_clients:     'manage_subscribers',
  client:             'view_client_db',

  archived_clients: 'delete_subscribers',

  branches_settings: 'manage_settings',
  registrations:      'view_leads',
  leads:              'view_leads',
  followup_reminders: 'view_leads',
  sales_hub:          'view_leads',
  // Both live under التسويق. marketing_hub on view_leads and messaging_hub on
  // view_dashboard meant every sales rep — and every employee at all — saw a
  // marketing section they have no business in. Campaign tooling and channel
  // configuration are the same job, so they share the same permission.
  marketing_hub:      'manage_channel_settings',
  messaging_hub:      'manage_channel_settings',
  online_hub:         'manage_subscribers',
  installment_plans:  'view_financial',
  consultations:      'view_consultations',
  community:          'view_community',
  daqqi_schedule:     'manage_daqqi',
  daqqi_clients:      'manage_daqqi',
  daqqi_team:         'manage_daqqi',
  daqqi_accounting:   'manage_daqqi',
  daqqi_stats:        'manage_daqqi',
  daqqi_attendance:   'manage_daqqi',
  waitlist:           'manage_daqqi',
  courses:            'view_courses',
  lectures:           'manage_lectures',
  instructors:        'manage_instructors',
  bundles:            'manage_bundles',
  testimonials:       'manage_testimonials',
  discounts:          'manage_discounts',
  quizzes:            'manage_courses',
  course_waitlist:    'manage_courses',
  live_streams:       'manage_courses',
  orders:             'view_orders',
  financial:          'view_financial',
  financial_reports:  'view_financial',
  balance_sheet:      'view_financial',
  cash_flow:          'view_financial',
  recurring_expenses: 'view_financial',
  budget_tracker:     'view_financial',
  revenue_forecast:   'view_financial',
  retention:          'view_reports',
  cohort_analysis:    'view_reports',
  revenue_sources:    'view_reports',
  expense_analytics:  'view_reports',
  hr:                 'view_hr',
  hr_analytics:       'view_hr',
  staff_applications: 'view_join_us',
  lecturer_applications: 'view_join_us',
  customer_inbox:     'manage_inbox',
  service_hub:        'manage_inbox',
  join_us:            'view_join_us',
  interviews:         'view_hr',
  contacts:           'view_contacts',
  tickets:            'manage_inbox',
  faq_manager:        'manage_inbox',
  refund_requests:    'manage_orders',
  nps_dashboard:      'view_reports',
  notifications:      'manage_notifications',
  staff_management:   'view_staff',
  enps_dashboard:      'view_hr',
  offboarding:         'manage_hr',
  activity:           'view_activity',
  staff_performance:  'view_reports',
  forecast:           'view_reports',
  sales_team:         'view_staff',
  sales_reports:      'view_reports',
  // Writing targets is a manager action (see POST /api/admin/sales-targets):
  // matched to the API gate so a sales rep doesn't see a tab that 403s.
  sales_goals:        'manage_sales_team',
  online_team:        'view_staff',
  subscriptions:     'view_financial',
  lead_scoring:       'manage_leads',
  consultation_calendar: 'view_consultations',
  automation:         'manage_automation',
  admin_ai_settings:  'manage_ai_settings',
  messaging_agent:    'manage_channel_settings',
  system_settings:    'manage_settings',
  settings_hub:       'view_settings',
  payment_settings:   'manage_settings',
  lead_sources_settings: 'manage_settings',
  otp_settings:       'manage_security',
  branch_workspaces:  'manage_settings',
  server_monitor:     'view_security',
  webhooks:           'manage_settings',
  security_dashboard: 'view_security',
  ip_whitelist:       'manage_security',
  sms_settings:       'manage_channel_settings',
  // Managing the notification inbox is a marketing/ops tool, not something every
  // employee who can receive notifications should see — manage_notifications is
  // held by sales reps and support, which would have put the whole التسويق group
  // in their sidebar the moment this became a menu item.
  notif_inbox:        'manage_channel_settings',
  email_campaigns:    'manage_channel_settings',
  sms_campaigns:      'manage_channel_settings',
  drip_campaigns:     'manage_channel_settings',
  hub_advanced:       'manage_settings',
  pg_migrate:         'manage_settings',
  // Staff personal portal — accessible by any authenticated staff
  staff_home:         'view_dashboard',
  staff_settings:     'view_dashboard',
  my_hr:              'view_dashboard',
  home_offer:         'manage_content',
  about_page:         'manage_content',
  page_courses:       'manage_content',
  page_bundles:       'manage_content',
  page_consultations: 'manage_content',
  page_community:     'manage_content',
  page_instructors:   'manage_content',
  page_contact:       'manage_content',
  page_joinus:        'manage_content',
  page_course_details: 'manage_content',
  page_bundle_details: 'manage_content',
  page_misc:          'manage_content',
  policies:           'manage_content',
  footer_settings:    'manage_content',
  institute_gallery:  'manage_content',
  cert_pricing:       'manage_certificates',
  cert_requests:      'manage_certificates',
  content:            'manage_content',
  content_hub:        'manage_content',
};
// ──────────────────────────────────────────────────────────────────────────

export {
  PERMISSION_LABELS,
  calcCurrentLecture,
  getCurrentWeekKey,
  blankLead,
  blankStaffMember,
  SUB_STATUS_CFG,
  subStatusBadge,
  shortName,
  crmSourceLabels,
  crmInterestLabels,
  crmStatusLabels,
  crmStatusColors,
  crmRoleLabels,
  ROLE_DEFAULT_PERMISSIONS,
  paymentTypeLabels,
  formatWaPhone,
  normBranchId,
  LEAD_STATUS_CFG,
  CertPricingTab,
  BranchAddForm,
  _normalizeAr,
  _normClientPhone,
  _normClientEmail,
  _normalizeClientDate,
  TAB_PERMISSION_MAP,
};

export type InstituteBranch = BranchEntry;
export type { SubStatus, CertPricingMap, BranchRoom, BranchEntry };
