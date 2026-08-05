import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowRight, Phone, Mail, Shield, Eye, EyeOff, Save, BarChart3, Activity, CreditCard, Settings, ChevronRight, Clock, Camera, Trash2 } from 'lucide-react';
import { useSiteData } from '../context/SiteDataContext';
import { toDialable } from '../lib/whatsappLink';
import { mysqlAdmin, mysqlAuth } from '../lib/mysqlapi';
import { compressImageFile } from '../lib/imageBudget';
import type { StaffMember, StaffPermission } from '../types';
import {
  ROLE_DEFAULT_PERMISSIONS as MASTER_ROLE_PERMS,
  getDefaultPermsArray,
  type RoleKey,
} from '../constants/permissions';

// ── Helpers ──────────────────────────────────────────────────────────────────
const toEGP = (amt: number, cur: string) =>
  cur === 'EGP' ? amt : cur === 'SAR' ? amt * 13 : amt * 50;

const fmt = (n: number) => n.toLocaleString('ar-EG-u-nu-latn');

// Delegates to the shared rule — this used to build country code "2".
const formatWaPhone = (p: string) => toDialable(p);

const ROLE_LABELS: Record<string, string> = {
  instructor: 'محاضر', trainer: 'مدرب', expert: 'خبير', sales: 'مسئول مبيعات',
  manager: 'مدير', admin: 'أدمن', support: 'مسئول خدمة عملاء',
  reception_daqqi: 'ريسبشن الدقي', collection: 'مسئول تحصيل',
  accountant: 'محاسب', consultant: 'استشاري', daqqi_manager: 'مدير الدقي', online_manager: 'مدير أونلاين',
  sales_collection_manager: 'مدير المبيعات والتحصيل', hr: 'موارد بشرية',
  other: 'أخرى',
};

const PERMISSION_LABELS: Record<StaffPermission, string> = {
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
  view_orders: 'عرض الطلبات والمدفوعات',
  manage_orders: 'إدارة الطلبات والمدفوعات',
  manage_payments: 'تسجيل وتعديل المدفوعات',
  approve_refunds: 'اعتماد أو رفض الاستردادات',
  view_financial: 'عرض النظام المحاسبي',
  manage_financial: 'إدارة النظام المحاسبي (تعديل)',
  view_reports: 'عرض التقارير والإحصائيات',
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

const ROLE_OPTIONS: { value: StaffMember['role']; label: string }[] = [
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

// ── Permission system constants ───────────────────────────────────────────────
// Derived from master constants — admin/constants/permissions.ts
// getDefaultPermsArray converts '*' (full access) → full permission list for UI checkboxes
const ROLE_DEFAULT_PERMISSIONS: Record<string, StaffPermission[]> = {
  ...Object.fromEntries(
    Object.keys(MASTER_ROLE_PERMS).map(r => [r, getDefaultPermsArray(r) as StaffPermission[]])
  ),
  // Legacy roles kept for backwards-compat
  expert: ['view_dashboard', 'view_courses'] as StaffPermission[],
  other:  ['view_dashboard'] as StaffPermission[],
};
void (MASTER_ROLE_PERMS as unknown); void ('' as unknown as RoleKey);

const ROLE_PRESETS = [
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

const PERM_CATEGORIES = [
  { key:'dashboard',   label:'اللوحة الرئيسية والتقارير',             icon:'📊', bg:'bg-slate-50',   border:'border-slate-200',   text:'text-slate-700',   perms:['view_dashboard','view_reports','view_activity'] as StaffPermission[] },
  { key:'leads',       label:'العملاء المحتملين (CRM / الليدات)',      icon:'👥', bg:'bg-blue-50',    border:'border-blue-200',    text:'text-blue-700',    perms:['view_leads','manage_leads','delete_leads','export_leads'] as StaffPermission[] },
  { key:'subscribers', label:'عملاء الأونلاين المسجلين',            icon:'🎓', bg:'bg-emerald-50', border:'border-emerald-200', text:'text-emerald-700', perms:['view_subscribers','manage_subscribers','delete_subscribers','export_subscribers'] as StaffPermission[] },
  { key:'courses',     label:'الكورسات والمحتوى التعليمي',             icon:'📚', bg:'bg-orange-50',  border:'border-orange-200',  text:'text-orange-700',  perms:['view_courses','manage_courses','manage_lectures','manage_instructors','manage_bundles','manage_discounts','manage_testimonials'] as StaffPermission[] },
  { key:'financial',   label:'الطلبات والنظام المالي',                 icon:'💰', bg:'bg-green-50',   border:'border-green-200',   text:'text-green-700',   perms:['view_orders','manage_orders','manage_payments','approve_refunds','view_financial','manage_financial'] as StaffPermission[] },
  { key:'consult',     label:'الاستشارات والمواعيد',                   icon:'🤝', bg:'bg-teal-50',    border:'border-teal-200',    text:'text-teal-700',    perms:['view_consultations','manage_consultations'] as StaffPermission[] },
  { key:'comm',        label:'التواصل والمجتمع والرسائل',              icon:'💬', bg:'bg-purple-50',  border:'border-purple-200',  text:'text-purple-700',  perms:['view_community','manage_community','manage_inbox','manage_notifications','manage_channel_settings','bulk_whatsapp','view_join_us','manage_join_us','view_contacts','manage_contacts'] as StaffPermission[] },
  { key:'team',        label:'إدارة الفريق والعمليات',                 icon:'👔', bg:'bg-indigo-50',  border:'border-indigo-200',  text:'text-indigo-700',  perms:['view_staff','manage_staff','view_hr','manage_hr','manage_daqqi'] as StaffPermission[] },
  { key:'system',      label:'الإعدادات والتطوير والذكاء الاصطناعي',  icon:'⚙️', bg:'bg-gray-50',    border:'border-gray-200',    text:'text-gray-700',    perms:['manage_content','manage_automation','ask_ai','ai_dev','manage_ai_settings','view_security','manage_security','view_settings','manage_settings'] as StaffPermission[] },
];

const ACCESS_PREVIEW_TABS = [
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

const createStaffAccount = async (staff: StaffMember, password: string): Promise<void> => {
  await mysqlAdmin.createStaffAccount({ ...staff, staffId: staff.id, password } as unknown as Record<string, unknown>);
};

type Tab = 'reports' | 'attendance' | 'activity' | 'bookings' | 'settings';

interface AttendanceLog {
  id: string; date: string; check_in: string | null; check_out: string | null;
  total_hours: number | null; late_minutes: number; status: string; notes: string | null;
}
const ATTENDANCE_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PRESENT:  { label: 'حاضر',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  LATE:     { label: 'متأخر',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  ABSENT:   { label: 'غائب',    cls: 'bg-red-50 text-red-700 border-red-200' },
  HALF_DAY: { label: 'نصف يوم', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  LEAVE:    { label: 'إجازة',   cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  HOLIDAY:  { label: 'عطلة',    cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  REMOTE:   { label: 'عن بُعد', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
};

const StaffProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { staffMembers, leads, subscribers, reloadStaffMembers, deleteStaffMember, authUser, isAdmin } = useSiteData();

  const [activeTab, setActiveTab] = useState<Tab>('reports');
  const [draft, setDraft] = useState<StaffMember | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [deleting, setDeleting] = useState(false);

  const staff = useMemo(() => staffMembers.find(s => s.id === id), [staffMembers, id]);
  const currentStaff = useMemo(
    () => staffMembers.find(row => row.email?.toLowerCase() === (authUser?.email || '').toLowerCase()) || null,
    [staffMembers, authUser?.email],
  );

  // Initialise draft when staff loads
  React.useEffect(() => {
    if (staff && !draft) setDraft({ ...staff });
  }, [staff]);

  // ── Attendance (month picker + fetch from HR attendance log) ─────────────────
  const now = new Date();
  const [attMonth, setAttMonth] = useState(now.getMonth() + 1);
  const [attYear, setAttYear] = useState(now.getFullYear());
  const [attLogs, setAttLogs] = useState<AttendanceLog[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  React.useEffect(() => {
    if (!id || activeTab !== 'attendance') return;
    setAttLoading(true);
    fetch(`/api/admin/hr/attendance/${id}?month=${attMonth}&year=${attYear}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(rows => setAttLogs(Array.isArray(rows) ? rows : []))
      .catch(() => setAttLogs([]))
      .finally(() => setAttLoading(false));
  }, [id, attMonth, attYear, activeTab]);
  const attSummary = useMemo(() => {
    const present = attLogs.filter(l => l.status === 'PRESENT' || l.status === 'REMOTE').length;
    const late = attLogs.filter(l => l.status === 'LATE' || l.late_minutes > 0).length;
    const absent = attLogs.filter(l => l.status === 'ABSENT').length;
    const leave = attLogs.filter(l => l.status === 'LEAVE').length;
    const totalHours = attLogs.reduce((s, l) => s + (l.total_hours || 0), 0);
    return { present, late, absent, leave, totalHours: Math.round(totalHours * 10) / 10 };
  }, [attLogs]);

  // ── Performance computation ─────────────────────────────────────────────────
  const perf = useMemo(() => {
    if (!staff) return null;
    const sl = leads.filter(l => l.assignedSalesName === staff.name || l.assignedSalesId === staff.id);
    const assignedSubs = subscribers.filter(sub => sub.assignedSalesId === staff.id);
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterdayStr = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
    const isT = (d: string) => !!d && new Date(d).toDateString() === now.toDateString();
    const isYest = (d: string) => !!d && d.slice(0, 10) === yesterdayStr;
    const isW = (d: string) => { if (!d) return false; const st = new Date(now); st.setDate(now.getDate() - now.getDay()); st.setHours(0, 0, 0, 0); return new Date(d) >= st; };
    const isTM = (d: string) => { if (!d) return false; const x = new Date(d); return x.getMonth() === now.getMonth() && x.getFullYear() === now.getFullYear(); };

    const allPayments = assignedSubs.flatMap(sub =>
      (sub.paymentHistory || []).map(p => ({ ...p, subName: sub.name, subId: sub.id, subCode: sub.clientCode }))
    );
    const toRevEGP = (list: typeof allPayments) => Math.round(list.reduce((s, p) => s + toEGP(p.amount, p.currency), 0));

    const allComms = sl.flatMap(l =>
      (l.communications || []).map(c => ({ ...c, leadName: l.name, leadId: l.id, leadPhone: l.phone || '' }))
    );
    allComms.sort((a, b) => b.date.localeCompare(a.date));

    const cr = staff.commissionRate || 0;
    const revTotal = toRevEGP(allPayments);

    return {
      total: sl.length,
      today: sl.filter(l => isT(l.createdAt || '')).length,
      yesterday: sl.filter(l => isYest(l.createdAt || '')).length,
      week: sl.filter(l => isW(l.createdAt || '')).length,
      month: sl.filter(l => isTM(l.createdAt || '')).length,
      converted: sl.filter(l => l.status === 'converted').length,
      convertedMonth: sl.filter(l => l.status === 'converted' && isTM(l.createdAt || '')).length,
      lost: sl.filter(l => l.status === 'lost').length,
      pending: sl.filter(l => l.status === 'new').length,
      contacted: sl.filter(l => l.status === 'contacted').length,
      noAnswer: sl.filter(l => l.status === 'no_answer').length,
      notInterested: sl.filter(l => l.status === 'not_interested').length,
      interested: sl.filter(l => l.status === 'interested').length,
      revTotal,
      revToday: toRevEGP(allPayments.filter(p => isT(p.at || ''))),
      revYest: toRevEGP(allPayments.filter(p => isYest(p.at || ''))),
      revWeek: toRevEGP(allPayments.filter(p => isW(p.at || ''))),
      revMonth: toRevEGP(allPayments.filter(p => isTM(p.at || ''))),
      commission: cr ? Math.round(revTotal * cr / 100) : 0,
      callsToday: allComms.filter(c => c.date === todayStr).length,
      callsYest: allComms.filter(c => c.date === yesterdayStr).length,
      callsWeek: allComms.filter(c => isW(c.date)).length,
      callsMonth: allComms.filter(c => isTM(c.date)).length,
      allComms,
      bookings: allPayments,
      leads: sl,
    };
  }, [staff, leads, subscribers]);

  if (!staff) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4" dir="rtl">
        <p className="text-5xl font-black text-gray-200 mb-4">404</p>
        <h1 className="text-xl font-bold text-gray-700 mb-2">الموظف غير موجود</h1>
        <button onClick={() => navigate('/dashboard/staff_management')} className="mt-4 bg-primary-600 text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-primary-700 transition">
          العودة للموظفين
        </button>
      </div>
    );
  }

  const convRate = perf && perf.total > 0 ? Math.round((perf.converted / perf.total) * 100) : 0;

  // ── Save handler ─────────────────────────────────────────────────────────────
  // Salary changes go through /admin/hr/salary (pending approval by another
  // HR staff member) rather than being written directly — ported from the
  // old EmployeeProfileModal (HRTab.tsx) so this page has the exact same
  // guard: ported over, not reinvented, since it's the one that actually
  // matters (self-approving your own raise).
  const handleSave = async () => {
    if (!draft) return;
    if (!draft.name || !draft.email) { setSaveMsg('❌ الاسم والبريد الإلكتروني مطلوبان'); return; }
    const salaryChanged = Number(draft.salary || 0) !== Number(staff.salary || 0);
    if (salaryChanged && currentStaff?.id === draft.id) {
      setSaveMsg('❌ لا يمكنك تعديل راتبك بنفسك؛ يلزم موظف HR آخر');
      return;
    }
    setSaving(true);
    setSaveMsg('');
    const payload: StaffMember = { ...draft };
    try {
      if (!draft.firebaseUid && password.trim()) {
        await createStaffAccount(payload, password.trim());
        await reloadStaffMembers();
      } else {
        await mysqlAdmin.updateHrEmployee(payload.id, {
          name: payload.name.trim(),
          email: payload.email.trim().toLowerCase(),
          phone: payload.phone.trim(),
          image: payload.image || null,
          specialization: payload.specialization || null,
          joined_at: payload.joinedAt?.slice(0, 10) || null,
          notes: payload.notes || null,
          national_id: payload.nationalId || null,
          address: payload.address || null,
          hr_notes: payload.hrNotes || null,
          commission_rate: Number(payload.commissionRate) || 0,
          monthly_target: Number(payload.monthlyTarget) || 0,
          monthly_target_type: payload.monthlyTargetType || 'egp',
          monthly_bonus: Number(payload.monthlyBonus) || 0,
          ...(isAdmin ? { role: payload.role } : {}),
        });
        let salaryPending = false;
        if (salaryChanged) {
          const effectiveDate = new Date();
          effectiveDate.setUTCDate(1);
          effectiveDate.setUTCMonth(effectiveDate.getUTCMonth() + 1);
          await mysqlAdmin.adminPost('/admin/hr/salary', {
            staff_id: payload.id,
            base_salary: Number(payload.salary) || 0,
            currency: 'EGP',
            effective_from: effectiveDate.toISOString().slice(0, 10),
          });
          salaryPending = true;
        }
        await reloadStaffMembers();
        if (salaryPending) {
          setDraft(d => d ? { ...d, salary: staff.salary } : d);
          setSaveMsg('ℹ️ تم حفظ البيانات وإرسال تعديل الراتب للاعتماد');
          setSaving(false);
          setTimeout(() => setSaveMsg(''), 4000);
          return;
        }
      }
    } catch (err: unknown) {
      setSaving(false);
      setSaveMsg(`❌ ${err instanceof Error ? err.message : 'فشل حفظ الموظف أو حساب الدخول'}`);
      return;
    }
    setSaving(false);
    setSaveMsg('✅ تم حفظ البيانات بنجاح');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  // Soft-delete (is_active=0) — same superadmin-only endpoint the old
  // EmployeeProfileModal used (api/routes/staff.js DELETE /api/admin/staff/:id).
  const handleDelete = async () => {
    if (currentStaff?.id === staff.id) { setSaveMsg('❌ لا يمكنك حذف حسابك الخاص'); return; }
    if (!window.confirm(`حذف ${staff.name} نهائيًا من قائمة الموظفين النشطين؟ سجله وتاريخه المالي يبقى محفوظًا، ويمكن إعادة تفعيله لاحقًا.`)) return;
    setDeleting(true);
    try {
      const ok = await deleteStaffMember(staff.id);
      if (!ok) throw new Error('تعذر حذف الموظف — قد تحتاج صلاحية سوبر أدمن');
      navigate('/dashboard/staff_management');
    } catch (err: unknown) {
      setDeleting(false);
      setSaveMsg(`❌ ${err instanceof Error ? err.message : 'تعذر حذف الموظف'}`);
    }
  };

  const handlePasswordReset = async () => {
    if (!staff.email) return;
    try {
      const { temporaryPassword: tmpPw } = await mysqlAuth.forceResetPassword(staff.email);
      setSaveMsg(`✅ تم تعيين كلمة مرور مؤقتة: ${tmpPw} — يرجى تسليمها للموظف`);
    } catch (err: unknown) {
      setSaveMsg(`❌ ${err instanceof Error ? err.message : 'فشل تعيين كلمة المرور'}`);
    }
    setTimeout(() => setSaveMsg(''), 4000);
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'reports', label: 'التقارير', icon: <BarChart3 size={15} /> },
    { key: 'attendance', label: 'الحضور والانصراف', icon: <Clock size={15} /> },
    { key: 'activity', label: 'سجل النشاط', icon: <Activity size={15} /> },
    { key: 'bookings', label: 'الحجوزات', icon: <CreditCard size={15} /> },
    { key: 'settings', label: 'الإعدادات', icon: <Settings size={15} /> },
  ];

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* ── Sticky top bar ── */}
      <div className="sticky top-0 bg-white border-b border-gray-200 px-4 md:px-8 py-4 flex items-center gap-4 shadow-sm z-20">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
          title="رجوع"
        >
          <ArrowRight size={18} />
        </button>
        {staff.image ? (
          <img src={staff.image} alt={staff.name} className="w-11 h-11 rounded-full object-cover border border-gray-200 flex-shrink-0" />
        ) : (
          <div className="w-11 h-11 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-black flex-shrink-0">
            {staff.name.charAt(0)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <nav className="flex items-center gap-1 text-xs text-gray-400 mb-0.5">
            <button onClick={() => navigate('/dashboard/staff_management')} className="hover:text-primary-600 transition">الموظفون</button>
            <ChevronRight size={12} className="text-gray-300" />
            <span className="text-gray-600 font-medium truncate">{staff.name}</span>
          </nav>
          <h1 className="text-lg font-bold text-gray-900 truncate">{staff.name}</h1>
          <p className="text-xs text-gray-500">
            {ROLE_LABELS[staff.role] ?? staff.role}
            {staff.commissionRate ? ` · عمولة ${staff.commissionRate}%` : ''}
            {staff.status === 'inactive' && <span className="mr-2 text-red-500 font-bold">· غير نشط</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {staff.phone && (
            <a href={`https://wa.me/${formatWaPhone(staff.phone)}`} target="_blank" rel="noopener noreferrer"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-green-100 text-green-700 hover:bg-green-200 transition" title="واتساب">
              <Phone size={16} />
            </a>
          )}
          {staff.email && (
            <a href={`mailto:${staff.email}`}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 transition" title="البريد الإلكتروني">
              <Mail size={16} />
            </a>
          )}
          {isAdmin && currentStaff?.id !== staff.id && (
            <button
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="flex items-center gap-1.5 px-3 h-9 rounded-full bg-red-50 text-red-600 hover:bg-red-100 transition text-xs font-bold disabled:opacity-50"
              title="حذف الموظف"
            >
              <Trash2 size={14} /> {deleting ? 'جارٍ الحذف...' : 'حذف'}
            </button>
          )}
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="bg-white border-b border-gray-200 px-4 md:px-8">
        <div className="flex gap-0 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-5 py-3.5 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Page body ── */}
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">

        {/* ══ REPORTS TAB ══ */}
        {activeTab === 'reports' && perf && (
          <div className="space-y-6">
            {/* Period cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: 'اليوم', leadsN: perf.today, calls: perf.callsToday, rev: perf.revToday },
                { label: 'بالأمس', leadsN: perf.yesterday, calls: perf.callsYest, rev: perf.revYest },
                { label: 'الأسبوع', leadsN: perf.week, calls: perf.callsWeek, rev: perf.revWeek },
                { label: 'الشهر', leadsN: perf.month, calls: perf.callsMonth, rev: perf.revMonth },
                { label: 'الإجمالي', leadsN: perf.total, calls: null, rev: perf.revTotal },
              ].map(p => (
                <div key={p.label} className="bg-white border border-gray-200 rounded-2xl p-4 text-center shadow-sm">
                  <div className="text-xs font-bold text-gray-500 mb-1">{p.label}</div>
                  <div className="text-3xl font-bold text-indigo-700">{p.leadsN}</div>
                  <div className="text-[11px] text-gray-400 mb-1">ليد</div>
                  {p.calls !== null && (
                    <div className="text-[11px] text-blue-600 font-bold">📞 {p.calls} مكالمة</div>
                  )}
                  {p.rev > 0 && <div className="text-[11px] text-emerald-700 font-bold mt-0.5">{fmt(p.rev)} ج.م</div>}
                  {p.rev > 0 && (staff.commissionRate || 0) > 0 && (
                    <div className="text-[10px] text-orange-600 font-bold">
                      عمولة: {fmt(Math.round(p.rev * (staff.commissionRate || 0) / 100))} ج
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-green-50 border border-green-200 rounded-2xl p-5 text-center">
                <div className="text-4xl font-bold text-green-700">{perf.converted}</div>
                <div className="text-sm text-green-600 mt-1">إجمالي تحوّل</div>
                <div className="text-2xl font-bold text-green-800 mt-2">{convRate}%</div>
                <div className="text-xs text-green-500">معدل التحويل</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-center">
                <div className="text-4xl font-bold text-blue-700">{perf.allComms.length}</div>
                <div className="text-sm text-blue-600 mt-1">إجمالي التواصل</div>
              </div>
              {perf.revTotal > 0 ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
                  <div className="text-3xl font-bold text-emerald-700">{fmt(perf.revTotal)}</div>
                  <div className="text-sm text-emerald-600 mt-1">إيراد كلي (ج.م)</div>
                  {(staff.commissionRate || 0) > 0 && (
                    <>
                      <div className="text-xl font-bold text-orange-700 mt-2">{fmt(perf.commission)}</div>
                      <div className="text-xs text-orange-500">عمولة إجمالية</div>
                    </>
                  )}
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 text-center">
                  <div className="text-4xl font-bold text-gray-300">—</div>
                  <div className="text-sm text-gray-500 mt-1">لا يوجد إيراد مسجل</div>
                </div>
              )}
            </div>

            {/* Status distribution */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h4 className="text-sm font-bold text-gray-700 mb-3">توزيع حالات الليدز</h4>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  { label: 'جديد', val: perf.pending, color: 'bg-gray-100 text-gray-700' },
                  { label: 'تم التواصل', val: perf.contacted, color: 'bg-amber-50 text-amber-700' },
                  { label: 'مهتم', val: perf.interested, color: 'bg-emerald-50 text-emerald-700' },
                  { label: 'تحوّل', val: perf.converted, color: 'bg-green-50 text-green-700' },
                  { label: 'لا يرد', val: perf.noAnswer, color: 'bg-orange-50 text-orange-700' },
                  { label: 'غير مهتم / خسارة', val: perf.notInterested + perf.lost, color: 'bg-red-50 text-red-700' },
                ].map(st => (
                  <div key={st.label} className={`${st.color} rounded-xl p-3 text-center`}>
                    <div className="text-2xl font-bold">{st.val}</div>
                    <div className="text-xs leading-tight mt-0.5">{st.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Charts: Daily calls + conversions for last 7 days */}
            {(() => {
              const days = Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - (6 - i));
                return d.toISOString().slice(0, 10);
              });
              const callsPerDay = days.map(day => perf.allComms.filter(c => c.date === day).length);
              const convsPerDay = days.map(day => perf.leads.filter(l => l.status === 'converted' && (l.createdAt || '').slice(0, 10) === day).length);
              const maxCalls = Math.max(...callsPerDay, 1);
              const maxConvs = Math.max(...convsPerDay, 1);
              const dayLabels = days.map(d => { const x = new Date(d); return `${x.getDate()}/${x.getMonth() + 1}`; });
              const BAR_W = 28;
              const GAP = 12;
              const H = 100;
              const totalW = days.length * (BAR_W * 2 + GAP + 8);
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Calls chart */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <h4 className="text-sm font-bold text-blue-700 mb-3">📞 المكالمات — آخر 7 أيام</h4>
                    <svg viewBox={`0 0 ${totalW} ${H + 28}`} className="w-full" style={{ direction: 'ltr' }}>
                      {days.map((_, i) => {
                        const barH = callsPerDay[i] === 0 ? 3 : Math.max(6, Math.round((callsPerDay[i] / maxCalls) * H));
                        const x = i * (BAR_W + GAP + 8) + 4;
                        const y = H - barH;
                        return (
                          <g key={i}>
                            <rect x={x} y={y} width={BAR_W} height={barH} rx={5} fill={callsPerDay[i] === 0 ? '#e5e7eb' : '#6366f1'} />
                            {callsPerDay[i] > 0 && (
                              <text x={x + BAR_W / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="#4f46e5" fontWeight="bold">{callsPerDay[i]}</text>
                            )}
                            <text x={x + BAR_W / 2} y={H + 18} textAnchor="middle" fontSize="8.5" fill="#9ca3af">{dayLabels[i]}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  {/* Conversions chart */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
                    <h4 className="text-sm font-bold text-green-700 mb-3">✅ التحويلات لحجوزات — آخر 7 أيام</h4>
                    <svg viewBox={`0 0 ${totalW} ${H + 28}`} className="w-full" style={{ direction: 'ltr' }}>
                      {days.map((_, i) => {
                        const barH = convsPerDay[i] === 0 ? 3 : Math.max(6, Math.round((convsPerDay[i] / maxConvs) * H));
                        const x = i * (BAR_W + GAP + 8) + 4;
                        const y = H - barH;
                        return (
                          <g key={i}>
                            <rect x={x} y={y} width={BAR_W} height={barH} rx={5} fill={convsPerDay[i] === 0 ? '#e5e7eb' : '#22c55e'} />
                            {convsPerDay[i] > 0 && (
                              <text x={x + BAR_W / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="#16a34a" fontWeight="bold">{convsPerDay[i]}</text>
                            )}
                            <text x={x + BAR_W / 2} y={H + 18} textAnchor="middle" fontSize="8.5" fill="#9ca3af">{dayLabels[i]}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ══ ATTENDANCE TAB ══ */}
        {activeTab === 'attendance' && (
          <div className="space-y-6">
            {/* Month picker */}
            <div className="flex items-center gap-3">
              <select value={attMonth} onChange={e => setAttMonth(Number(e.target.value))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleDateString('ar-EG', { month: 'long' })}</option>
                ))}
              </select>
              <select value={attYear} onChange={e => setAttYear(Number(e.target.value))}
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white">
                {Array.from({ length: 3 }, (_, i) => now.getFullYear() - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {attLoading && <span className="text-xs text-gray-400">جارٍ التحميل...</span>}
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
                <div className="text-2xl font-bold text-emerald-700">{attSummary.present}</div>
                <div className="text-xs text-emerald-600 mt-1">أيام حضور</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
                <div className="text-2xl font-bold text-amber-700">{attSummary.late}</div>
                <div className="text-xs text-amber-600 mt-1">أيام تأخير</div>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
                <div className="text-2xl font-bold text-red-700">{attSummary.absent}</div>
                <div className="text-xs text-red-600 mt-1">أيام غياب</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 text-center">
                <div className="text-2xl font-bold text-purple-700">{attSummary.leave}</div>
                <div className="text-xs text-purple-600 mt-1">إجازات</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 text-center">
                <div className="text-2xl font-bold text-blue-700">{attSummary.totalHours}</div>
                <div className="text-xs text-blue-600 mt-1">إجمالي الساعات</div>
              </div>
            </div>

            {/* Daily log */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h4 className="text-sm font-bold text-gray-700">سجل الحضور اليومي</h4>
              </div>
              {!attLoading && attLogs.length === 0 ? (
                <p className="text-center py-10 text-sm text-gray-400">لا يوجد سجل حضور لهذا الشهر</p>
              ) : (
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                  {attLogs.map(log => {
                    const cfg = ATTENDANCE_STATUS_LABEL[log.status] || { label: log.status, cls: 'bg-gray-50 text-gray-600 border-gray-200' };
                    return (
                      <div key={log.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                        <span className="font-bold text-gray-700 w-24 flex-shrink-0">{log.date?.slice(0, 10)}</span>
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
                        <span className="text-gray-500 text-xs flex-1 text-center" dir="ltr">
                          {log.check_in || '—'} → {log.check_out || '—'}
                        </span>
                        {log.late_minutes > 0 && <span className="text-amber-600 text-xs font-bold">تأخير {log.late_minutes} د</span>}
                        {log.total_hours != null && <span className="text-gray-400 text-xs w-16 text-left">{log.total_hours} س</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══ ACTIVITY TAB ══ */}
        {activeTab === 'activity' && perf && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-gray-800 text-lg">سجل النشاط الكامل</h3>
              <span className="bg-blue-100 text-blue-700 text-sm font-bold px-3 py-1 rounded-full">{perf.allComms.length} إجراء</span>
            </div>
            {/* Calls summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'اليوم', count: perf.callsToday, color: 'bg-blue-50 text-blue-700 border-blue-200' },
                { label: 'بالأمس', count: perf.callsYest, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                { label: 'هذا الأسبوع', count: perf.callsWeek, color: 'bg-violet-50 text-violet-700 border-violet-200' },
                { label: 'هذا الشهر', count: perf.callsMonth, color: 'bg-purple-50 text-purple-700 border-purple-200' },
              ].map(c => (
                <div key={c.label} className={`${c.color} border rounded-2xl p-4 text-center`}>
                  <div className="text-3xl font-bold">📞 {c.count}</div>
                  <div className="text-xs mt-1 font-medium">{c.label}</div>
                </div>
              ))}
            </div>
            {/* Communications list */}
            {perf.allComms.length === 0 ? (
              <p className="text-center text-gray-400 py-10 bg-white rounded-2xl border border-gray-200">
                لا يوجد سجل نشاط بعد
              </p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-100">
                {perf.allComms.map((c, idx) => {
                  const typeIcon = c.type === 'call' ? '📞' : c.type === 'whatsapp' ? '💬' : c.type === 'email' ? '✉️' : c.type === 'meeting' ? '🤝' : '📝';
                  const isStatusChange = c.notes?.startsWith('🔄 تغيير الحالة');
                  return (
                    <div key={c.id ?? idx} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50 transition">
                      <span className="text-lg flex-shrink-0 mt-0.5">{typeIcon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-gray-800 text-sm capitalize">{c.type === 'call' ? 'مكالمة' : c.type === 'whatsapp' ? 'واتساب' : c.type === 'email' ? 'بريد' : c.type === 'meeting' ? 'اجتماع' : 'ملاحظة'}</span>
                          {isStatusChange && (
                            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">تغيير حالة</span>
                          )}
                        </div>
                        {c.notes && <p className="text-sm text-gray-600 mt-0.5">{c.notes}</p>}
                        {c.outcome && <p className="text-xs text-gray-400 mt-0.5">النتيجة: {c.outcome}</p>}
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{c.date}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ══ BOOKINGS TAB ══ */}
        {activeTab === 'bookings' && perf && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-gray-800 text-lg">سجل الحجوزات والإيرادات</h3>
              <span className="bg-emerald-100 text-emerald-700 text-sm font-bold px-3 py-1 rounded-full">
                {perf.bookings.length} دفعة · {fmt(perf.revTotal)} ج.م
              </span>
            </div>
            {/* Revenue periods */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'اليوم', rev: perf.revToday, color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                { label: 'بالأمس', rev: perf.revYest, color: 'bg-green-50 text-green-700 border-green-200' },
                { label: 'هذا الأسبوع', rev: perf.revWeek, color: 'bg-teal-50 text-teal-700 border-teal-200' },
                { label: 'الإجمالي', rev: perf.revTotal, color: 'bg-blue-50 text-blue-700 border-blue-200' },
              ].map(c => (
                <div key={c.label} className={`${c.color} border rounded-2xl p-4 text-center`}>
                  <div className="text-2xl font-bold">{fmt(c.rev)}</div>
                  <div className="text-xs mt-1 font-medium">ج.م — {c.label}</div>
                  {c.rev > 0 && (staff.commissionRate || 0) > 0 && (
                    <div className="text-[11px] text-orange-600 font-bold mt-0.5">
                      عمولة: {fmt(Math.round(c.rev * (staff.commissionRate || 0) / 100))} ج
                    </div>
                  )}
                </div>
              ))}
            </div>
            {perf.bookings.length === 0 ? (
              <p className="text-center text-gray-400 py-10 bg-white rounded-2xl border border-gray-200">لا توجد حجوزات مسجلة بعد</p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden divide-y divide-gray-100">
                {perf.bookings.map((b, idx) => (
                  <div key={b.id ?? idx} className="px-5 py-3 flex items-center gap-4 hover:bg-gray-50 transition">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-800 text-sm">{b.subName}</p>
                      {b.note && <p className="text-xs text-gray-500 mt-0.5">{b.note}</p>}
                      {b.paymentType && (
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded mt-0.5 inline-block">{b.paymentType}</span>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-bold text-emerald-700">{fmt(b.amount)} {b.currency}</div>
                      <div className="text-xs text-gray-400">{(b.at || '').slice(0, 10)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ SETTINGS TAB ══ */}
        {activeTab === 'settings' && draft && (
          <div className="space-y-6">
            {saveMsg && (
              <div className={`rounded-xl px-4 py-3 text-sm font-bold ${saveMsg.startsWith('✅') ? 'bg-green-50 text-green-700 border border-green-200' : saveMsg.startsWith('⚠️') ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {saveMsg}
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2"><Shield size={16} /> البيانات الأساسية</h3>

              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  {draft.image ? (
                    <img src={draft.image} alt={draft.name} className="w-20 h-20 rounded-2xl object-cover border border-gray-200" />
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center text-2xl font-black">
                      {draft.name.charAt(0) || '?'}
                    </div>
                  )}
                  <label className="absolute -bottom-1.5 -left-1.5 w-7 h-7 rounded-full bg-primary-600 text-white flex items-center justify-center cursor-pointer hover:bg-primary-700 transition shadow">
                    <Camera size={13} />
                    <input type="file" accept="image/*" className="hidden" onChange={async e => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      try {
                        const dataUrl = await compressImageFile(file, { maxPx: 320, maxBytes: 45_000 });
                        setDraft(d => d ? { ...d, image: dataUrl } : d);
                      } catch {
                        setSaveMsg('❌ الصورة كبيرة جداً أو تعذّر ضغطها — جرّب صورة أصغر');
                      }
                    }} />
                  </label>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-600 mb-1">صورة الموظف</p>
                  <p className="text-xs text-gray-400">اضغط على أيقونة الكاميرا لرفع صورة (تُضغط تلقائيًا لحجم مناسب)</p>
                  {draft.image && (
                    <button type="button" onClick={() => setDraft(d => d ? { ...d, image: undefined } : d)}
                      className="mt-1.5 text-xs font-bold text-red-500 hover:underline">إزالة الصورة</button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">الاسم *</label>
                  <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                    placeholder="الاسم" value={draft.name}
                    onChange={e => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">البريد الإلكتروني *</label>
                  <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                    placeholder="البريد الإلكتروني" value={draft.email}
                    onChange={e => setDraft({ ...draft, email: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">الهاتف</label>
                  <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                    placeholder="الهاتف" value={draft.phone}
                    onChange={e => setDraft({ ...draft, phone: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">الدور الوظيفي</label>
                  <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                    value={draft.role}
                    onChange={e => setDraft({ ...draft, role: e.target.value as StaffMember['role'] })}>
                    {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">التخصص</label>
                  <input className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                    placeholder="التخصص" value={draft.specialization ?? ''}
                    onChange={e => setDraft({ ...draft, specialization: e.target.value })} />
                </div>
                {draft.role === 'sales' && (
                  <div>
                    <label className="block text-xs font-semibold text-orange-600 mb-1">نسبة العمولة %</label>
                    <input type="number" min="0" max="100"
                      className="w-full border border-orange-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                      placeholder="مثال: 10" value={draft.commissionRate ?? ''}
                      onChange={e => setDraft({ ...draft, commissionRate: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">تاريخ الانضمام</label>
                  <input type="date" className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                    value={draft.joinedAt}
                    onChange={e => setDraft({ ...draft, joinedAt: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">الحالة</label>
                  <select className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400"
                    value={draft.status}
                    onChange={e => setDraft({ ...draft, status: e.target.value as 'active' | 'inactive' })}>
                    <option value="active">نشط</option>
                    <option value="inactive">غير نشط</option>
                  </select>
                </div>
                <div className="md:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ملاحظات</label>
                  <textarea className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary-400" rows={2}
                    placeholder="ملاحظات..." value={draft.notes ?? ''}
                    onChange={e => setDraft({ ...draft, notes: e.target.value })} />
                </div>
              </div>

              {/* Password section */}
              {isAdmin && (
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <p className="text-xs font-semibold text-gray-600">حساب الدخول</p>
                  {staff.firebaseUid && (
                    <p className="text-xs text-green-600 font-medium flex items-center gap-1">✓ حساب Firebase مرتبط</p>
                  )}
                  <div className="flex gap-3 flex-wrap">
                    <div className="relative flex-1 min-w-[200px]">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        className="w-full border border-indigo-200 rounded-xl px-4 py-2.5 text-sm pl-10 focus:outline-none focus:border-indigo-400"
                        placeholder={staff.firebaseUid ? 'كلمة مرور جديدة (اتركها فارغة)' : 'كلمة مرور الدخول'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                      />
                      <button type="button" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                        onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {staff.email && (
                      <button type="button" onClick={() => void handlePasswordReset()}
                        className="px-4 py-2.5 rounded-xl border border-indigo-200 text-indigo-700 text-sm font-bold hover:bg-indigo-50 transition whitespace-nowrap">
                        إرسال رابط إعادة تعيين
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── Permissions ── */}
            <div className="bg-white border border-indigo-100 rounded-2xl shadow-sm overflow-hidden">

              {/* Header */}
              <div className="bg-gradient-to-l from-indigo-50 to-white px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-indigo-900 flex items-center gap-2">
                    <Shield size={16} className="text-indigo-600" /> الصلاحيات والوصول
                  </h3>
                  <p className="text-xs text-indigo-400 mt-0.5">
                    {(draft.permissions || []).length} صلاحية مفعّلة من أصل {Object.keys(PERMISSION_LABELS).length}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button"
                    className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-700 transition"
                    onClick={() => setDraft({ ...draft, permissions: Object.keys(PERMISSION_LABELS) as StaffPermission[] })}>
                    تحديد الكل
                  </button>
                  <button type="button"
                    className="text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-200 transition"
                    onClick={() => setDraft({ ...draft, permissions: [] })}>
                    إلغاء الكل
                  </button>
                </div>
              </div>

              {/* Role Presets strip */}
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/60">
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-3">🎯 ضبط سريع حسب الوظيفة — اضغط لتطبيق الإعدادات الافتراضية</p>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {ROLE_PRESETS.map(preset => {
                    const isActive = draft.role === preset.role;
                    return (
                      <button key={preset.role} type="button"
                        onClick={() => setDraft({ ...draft, permissions: ROLE_DEFAULT_PERMISSIONS[preset.role] || [] })}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition text-center group ${
                          isActive
                            ? 'border-primary-400 bg-primary-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50 hover:shadow-sm'
                        }`}>
                        <span className="text-xl leading-none">{preset.icon}</span>
                        <span className={`text-[11px] font-bold leading-tight ${isActive ? 'text-primary-700' : 'text-gray-700 group-hover:text-primary-700'}`}>{preset.label}</span>
                        <span className="text-[9px] text-gray-400 leading-tight text-center">{preset.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Role description box for current role */}
              {draft.role && ROLE_DEFAULT_PERMISSIONS[draft.role] && (
                <div className="px-6 py-3 bg-blue-50 border-b border-blue-100 flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5 flex-shrink-0">ℹ️</span>
                  <div>
                    <p className="text-xs font-bold text-blue-800">
                      الصلاحيات الافتراضية لـ {ROLE_LABELS[draft.role] || draft.role}:
                    </p>
                    <p className="text-[11px] text-blue-600 mt-0.5">
                      {(() => {
                        const map: Record<string,string> = {
                          sales:          'يشوف الليدات بتاعته بس — ليدات + مشتركين مرتبطين + طلباتهم + استشارات',
                          collection:     'يشوف كل المشتركين — مشتركين + مدفوعات + تقارير مالية + إدارة الطلبات',
                          support:        'ليدات + مشتركين + صندوق الوارد + إشعارات + تقارير + استشارات',
                          manager:        'وصول كامل لجميع أقسام لوحة التحكم',
                          admin:          'وصول كامل — مثل المدير تماماً',
                          accountant:     'طلبات + تقارير مالية فقط — لا يرى الليدات أو المشتركين',
                          consultant:     'استشارات + ليدات + مشتركين + تقارير',
                          trainer:        'كورسات + محاضرات + مشتركين + استشارات',
                          instructor:     'كورسات ومحاضرات فقط + عرض المشتركين',
                          expert:         'عرض الكورسات والمشتركين فقط',
                          reception_daqqi:'ليدات + مشتركين + رسائل + جدول كورسات الدقي',
                          other:          'اللوحة الرئيسية فقط',
                        };
                        return map[draft.role] || 'صلاحيات مخصصة';
                      })()}
                    </p>
                  </div>
                </div>
              )}

              {/* Grouped permission categories */}
              <div className="p-5 space-y-3">
                {PERM_CATEGORIES.map(cat => {
                  const cur = draft.permissions || [];
                  const checkedCount = cat.perms.filter(p => cur.includes(p)).length;
                  const allChecked = checkedCount === cat.perms.length;
                  return (
                    <div key={cat.key} className={`rounded-xl border ${cat.border} overflow-hidden`}>
                      {/* Category header */}
                      <div className={`${cat.bg} px-4 py-2.5 flex items-center justify-between`}>
                        <div className="flex items-center gap-2">
                          <span className="text-base leading-none">{cat.icon}</span>
                          <span className={`text-sm font-bold ${cat.text}`}>{cat.label}</span>
                          <span className={`text-[10px] font-normal px-1.5 py-0.5 rounded-full border ${cat.border} ${cat.text} opacity-70`}>
                            {checkedCount}/{cat.perms.length}
                          </span>
                        </div>
                        <button type="button"
                          className={`text-[11px] font-bold ${cat.text} opacity-80 hover:opacity-100 transition border ${cat.border} bg-white rounded-lg px-2.5 py-0.5`}
                          onClick={() => {
                            if (allChecked) {
                              setDraft({ ...draft, permissions: cur.filter(p => !cat.perms.includes(p)) });
                            } else {
                              setDraft({ ...draft, permissions: [...new Set([...cur, ...cat.perms])] });
                            }
                          }}>
                          {allChecked ? '✗ إلغاء الكل' : '✓ تحديد الكل'}
                        </button>
                      </div>
                      {/* Permission checkboxes */}
                      <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-white">
                        {cat.perms.map(perm => {
                          const isChecked = cur.includes(perm);
                          return (
                            <label key={perm}
                              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-xs transition ${
                                isChecked
                                  ? `${cat.bg} ${cat.border} ${cat.text} font-medium`
                                  : 'border-gray-100 text-gray-500 hover:border-gray-200 hover:bg-gray-50'
                              }`}>
                              <input type="checkbox" className="accent-indigo-600 w-3.5 h-3.5 flex-shrink-0" checked={isChecked}
                                onChange={() => {
                                  setDraft({
                                    ...draft,
                                    permissions: isChecked ? cur.filter(p => p !== perm) : [...cur, perm],
                                  });
                                }} />
                              <span className="leading-tight">{PERMISSION_LABELS[perm]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Access preview */}
              <div className="px-5 pb-5">
                <div className="bg-gradient-to-l from-gray-50 to-white border border-gray-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-gray-600 mb-3 flex items-center gap-1.5">
                    <Eye size={12} /> ملخص الوصول — التبويبات المتاحة لهذا الموظف
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ACCESS_PREVIEW_TABS.map(t => {
                      const accessible = (draft.permissions || []).some(p => t.perms.includes(p));
                      return (
                        <span key={t.label}
                          className={`flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full border font-bold transition ${
                            accessible
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-gray-50 text-gray-300 border-gray-200 line-through'
                          }`}>
                          {t.icon} {t.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

            </div>

            {/* Save button */}
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold px-6 py-3 rounded-xl text-sm transition flex items-center justify-center gap-2"
            >
              {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save size={16} />}
              {saving ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StaffProfile;
