import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Settings2, TrendingUp } from 'lucide-react';
import type { StaffMember, SubscriberItem } from '../../types';
import { adminAuthHeaders } from '../../lib/adminAuthHeaders';
import { mysqlAdmin } from '../../lib/mysqlapi';
import { buildStaffSettingsMetrics } from './dashboardHelpers';

type StaffSettingsDraft = {
  name: string;
  phone: string;
  image: string;
  waNumber: string;
  monthlyTarget: string;
};

type StaffWaTemplate = { id: string; title: string; body: string };

type MyHrData = {
  staff: { hire_date: string | null; department_name: string | null; employment_type: string | null; joined_at: string | null };
  salary: { base_salary: number; housing_allowance: number; transport_allowance: number } | null;
  commission: { thisMonth: { total: number; count: number } | null };
  attendance: { present_days: number; absent_days: number; late_days: number; total_late_minutes: number };
  leaveBalance: { annualEntitlement: number; usedDays: number; remaining: number };
  leaveHistory: { id: string; type: string; status: string; start_date: string; end_date: string; total_days: number; reason: string; approved_by_name: string | null }[];
  kpi: { leads_assigned: number; leads_converted: number; revenue_generated: number };
};

type AdvanceRecord = { id: string; amount: number; currency: string; reason: string | null; status: string; created_at: string };
type DisciplinaryRecord = {
  id: string; type: string; severity: string; title: string; description: string | null;
  incident_date: string | null; action_taken: string | null; appeal_note: string | null;
  acknowledged_at: string | null; status: string; created_at: string;
};
type LeaveDraft = { type: string; start_date: string; end_date: string; reason: string };
type AdvanceDraft = { amount: string; reason: string };
type Notify = (kind: 'success' | 'error' | 'warning' | 'info', message: string) => void;

type DashboardStaffSettingsPanelProps = {
  currentStaff: StaffMember;
  salesOwnSubscribers: SubscriberItem[];
  staffSettingsDraft: StaffSettingsDraft | null;
  setStaffSettingsDraft: Dispatch<SetStateAction<StaffSettingsDraft | null>>;
  staffSettingsSaving: boolean;
  setStaffSettingsSaving: Dispatch<SetStateAction<boolean>>;
  notify: Notify;
  loadingMyHr: boolean;
  myHrData: MyHrData | null;
  setMyHrData: Dispatch<SetStateAction<MyHrData | null>>;
  showMyLeaveFormProfile: boolean;
  setShowMyLeaveFormProfile: Dispatch<SetStateAction<boolean>>;
  myLeaveFormProfile: LeaveDraft;
  setMyLeaveFormProfile: Dispatch<SetStateAction<LeaveDraft>>;
  submittingMyLeaveProfile: boolean;
  setSubmittingMyLeaveProfile: Dispatch<SetStateAction<boolean>>;
  showAdvanceForm: boolean;
  setShowAdvanceForm: Dispatch<SetStateAction<boolean>>;
  advanceDraft: AdvanceDraft;
  setAdvanceDraft: Dispatch<SetStateAction<AdvanceDraft>>;
  submittingAdvance: boolean;
  setSubmittingAdvance: Dispatch<SetStateAction<boolean>>;
  myAdvances: AdvanceRecord[];
  setMyAdvances: Dispatch<SetStateAction<AdvanceRecord[]>>;
  myDisciplinary: DisciplinaryRecord[];
  setMyDisciplinary: Dispatch<SetStateAction<DisciplinaryRecord[]>>;
  staffWaTemplateEdit: StaffWaTemplate | null;
  setStaffWaTemplateEdit: Dispatch<SetStateAction<StaffWaTemplate | null>>;
  staffWaTemplates: StaffWaTemplate[];
  setStaffWaTemplates: Dispatch<SetStateAction<StaffWaTemplate[]>>;
  staffContactTags: string[];
  setStaffContactTags: Dispatch<SetStateAction<string[]>>;
  staffNewTagInput: string;
  setStaffNewTagInput: Dispatch<SetStateAction<string>>;
};

export function DashboardStaffSettingsPanel({
  currentStaff,
  salesOwnSubscribers,
  staffSettingsDraft,
  setStaffSettingsDraft,
  staffSettingsSaving,
  setStaffSettingsSaving,
  notify,
  loadingMyHr,
  myHrData,
  setMyHrData,
  showMyLeaveFormProfile,
  setShowMyLeaveFormProfile,
  myLeaveFormProfile,
  setMyLeaveFormProfile,
  submittingMyLeaveProfile,
  setSubmittingMyLeaveProfile,
  showAdvanceForm,
  setShowAdvanceForm,
  advanceDraft,
  setAdvanceDraft,
  submittingAdvance,
  setSubmittingAdvance,
  myAdvances,
  setMyAdvances,
  myDisciplinary,
  setMyDisciplinary,
  staffWaTemplateEdit,
  setStaffWaTemplateEdit,
  staffWaTemplates,
  setStaffWaTemplates,
  staffContactTags,
  setStaffContactTags,
  staffNewTagInput,
  setStaffNewTagInput,
}: DashboardStaffSettingsPanelProps) {
  const [savedWaNumber, setSavedWaNumber] = useState('');
  const [disciplinaryBusy, setDisciplinaryBusy] = useState('');
  const [appealTarget, setAppealTarget] = useState('');
  const [appealNote, setAppealNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.getMyPreferences().then((preferences) => {
      if (cancelled) return;
      setSavedWaNumber(preferences.waNumber || '');
      setStaffWaTemplates(preferences.waTemplates || []);
      setStaffContactTags(preferences.customTags || []);
    }).catch(() => notify('error', 'تعذر تحميل تفضيلات حساب الموظف'));
    return () => { cancelled = true; };
  }, [notify, setStaffContactTags, setStaffWaTemplates]);

  const draft = staffSettingsDraft ?? {
    name: currentStaff.name || '',
    phone: currentStaff.phone || '',
    image: currentStaff.image || '',
    waNumber: savedWaNumber,
    monthlyTarget: String(currentStaff.monthlyLeadsTarget || 10),
  };
  const setDraft = (patch: Partial<typeof draft>) =>
    setStaffSettingsDraft(prev => ({ ...(prev ?? draft), ...patch }));
  const handleSave = async () => {
    setStaffSettingsSaving(true);
    try {
      await Promise.all([
        mysqlAdmin.updateMyProfile({ name: draft.name, phone: draft.phone, image: draft.image || null }),
        mysqlAdmin.saveMyPreferences({
          waNumber: draft.waNumber,
          waTemplates: staffWaTemplates,
          customTags: staffContactTags,
        }),
      ]);
      setSavedWaNumber(draft.waNumber);
      notify('success', 'تم الحفظ بنجاح');
      setStaffSettingsDraft(null);
    } catch { notify('error', 'فشل الحفظ، حاول مجدداً'); }
    finally { setStaffSettingsSaving(false); }
  };

  const savePreferences = async (waTemplates: StaffWaTemplate[], customTags: string[]) => {
    try {
      await mysqlAdmin.saveMyPreferences({ waNumber: draft.waNumber, waTemplates, customTags });
      setStaffWaTemplates(waTemplates);
      setStaffContactTags(customTags);
      return true;
    } catch {
      notify('error', 'تعذر حفظ تفضيلات حساب الموظف');
      return false;
    }
  };

  const updateDisciplinary = async (recordId: string, action: 'acknowledge' | 'appeal') => {
    setDisciplinaryBusy(recordId);
    try {
      const response = await fetch(`/api/staff/me/disciplinary/${recordId}/${action}`, {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify(action === 'appeal' ? { appeal_note: appealNote } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر تنفيذ الإجراء');
      const refreshed = await fetch('/api/staff/me/disciplinary', {
        credentials: 'include',
        headers: adminAuthHeaders(),
      }).then(result => result.json());
      if (Array.isArray(refreshed)) setMyDisciplinary(refreshed);
      setAppealTarget('');
      setAppealNote('');
      notify('success', action === 'acknowledge' ? 'تم تأكيد الاطلاع' : 'تم إرسال التظلم');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تنفيذ الإجراء');
    } finally {
      setDisciplinaryBusy('');
    }
  };

  const {
    monthlyTarget,
    achieved,
    pct,
    monthRevenue,
    totalRevenue,
    daysInMonth,
    daysLeft,
    dailyTargetPace,
    projectedEnd,
    weeksData,
    maxWeekCount,
  } = buildStaffSettingsMetrics(salesOwnSubscribers, draft.monthlyTarget);

  // Motivational message based on progress
  const motivMsg =
    pct >= 100 ? { text: '🏆 أنجزت هدفك هذا الشهر! أنت نجم الفريق!', cls: 'bg-gradient-to-r from-yellow-400 to-amber-500 text-white' } :
    pct >= 75  ? { text: '🔥 رائع! أنت على وشك تحقيق الهدف. استمر!', cls: 'bg-gradient-to-r from-emerald-500 to-green-600 text-white' } :
    pct >= 50  ? { text: '💪 أكثر من النصف تم! ركّز وأكمل المشوار!', cls: 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white' } :
    pct >= 25  ? { text: '⚡ لقد بدأت بقوة! حافظ على الزخم!', cls: 'bg-gradient-to-r from-violet-500 to-purple-600 text-white' } :
                 { text: '🚀 الشهر بدأ! كل حجز جديد خطوة نحو الهدف!', cls: 'bg-gradient-to-r from-primary-500 to-primary-700 text-white' };

  // SVG circle progress
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDash = circumference - (pct / 100) * circumference;

  return (
    <div className="space-y-5 w-full" dir="rtl">

      {/* Hero profile card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-indigo-800 p-6 text-white shadow-xl">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 80%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)', backgroundSize: '30px 30px' }} />
        <div className="relative flex items-center gap-4">
          <div className="w-16 h-16 rounded-full border-4 border-white/30 overflow-hidden bg-white/20 flex items-center justify-center flex-shrink-0">
            {draft.image
              ? <img src={draft.image} alt="avatar" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              : <span className="text-2xl font-extrabold text-white">{draft.name.charAt(0) || '؟'}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-white/70 mb-0.5">مرحباً يا</div>
            <div className="text-xl font-extrabold truncate">{draft.name || currentStaff.name}</div>
            <div className="text-xs text-white/70 mt-0.5">{currentStaff.email}</div>
          </div>
          <div className="text-left">
            <div className="text-xs text-white/70">إجمالي عملائي</div>
            <div className="text-3xl font-black">{salesOwnSubscribers.length}</div>
          </div>
        </div>
        <div className={`mt-4 rounded-xl px-4 py-2.5 text-sm font-bold ${motivMsg.cls} bg-opacity-90 shadow`}>
          {motivMsg.text}
        </div>
      </div>

      {/* Performance metrics row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'تحويلات الشهر', value: achieved, sub: `من ${monthlyTarget}`, cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
          { label: 'إيرادات الشهر', value: `${Math.round(monthRevenue / 1000)}K`, sub: 'ج.م', cls: 'border-blue-200 bg-blue-50 text-blue-800' },
          { label: 'إجمالي إيراداتي', value: `${Math.round(totalRevenue / 1000)}K`, sub: 'ج.م', cls: 'border-violet-200 bg-violet-50 text-violet-800' },
          { label: 'الأيام المتبقية', value: daysLeft, sub: `من ${daysInMonth} يوم`, cls: 'border-amber-200 bg-amber-50 text-amber-800' },
        ].map(m => (
          <div key={m.label} className={`border rounded-2xl p-3.5 text-center ${m.cls}`}>
            <div className="text-2xl font-black leading-tight">{m.value}</div>
            <div className="text-[11px] font-medium opacity-70">{m.sub}</div>
            <div className="text-xs font-bold mt-1">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Target progress */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-emerald-600" />
          <h3 className="font-extrabold text-gray-900">تقدمك نحو الهدف الشهري</h3>
          <span className="mr-auto text-xs text-gray-400">{new Date().toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' })}</span>
        </div>
        <div className="flex items-center gap-6">
          {/* SVG Circle */}
          <div className="relative flex-shrink-0 w-32 h-32">
            <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
              <circle cx="64" cy="64" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="10" />
              <circle cx="64" cy="64" r={radius} fill="none"
                stroke={pct >= 100 ? '#f59e0b' : pct >= 75 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#8b5cf6'}
                strokeWidth="10" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={strokeDash}
                style={{ transition: 'stroke-dashoffset 1s ease' }} />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-black text-gray-900">{pct}%</span>
              <span className="text-[10px] text-gray-400">من الهدف</span>
            </div>
          </div>
          {/* Progress details */}
          <div className="flex-1 space-y-3">
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>المنجز: <strong className="text-gray-800">{achieved} تحويل</strong></span>
                <span>الهدف: <strong className="text-gray-800">{monthlyTarget}</strong></span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className="h-3 rounded-full transition-all duration-1000"
                  style={{
                    width: `${pct}%`,
                    background: pct >= 100 ? 'linear-gradient(90deg,#f59e0b,#d97706)' :
                                pct >= 75  ? 'linear-gradient(90deg,#10b981,#059669)' :
                                pct >= 50  ? 'linear-gradient(90deg,#3b82f6,#2563eb)' :
                                             'linear-gradient(90deg,#8b5cf6,#7c3aed)',
                  }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <div className="text-gray-400">الوتيرة اليومية</div>
                <div className="font-bold text-gray-800">{dailyTargetPace.toFixed(1)} / يوم</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-2 border border-gray-100">
                <div className="text-gray-400">التوقع بنهاية الشهر</div>
                <div className={`font-bold ${projectedEnd >= monthlyTarget ? 'text-emerald-600' : 'text-amber-600'}`}>{projectedEnd} تحويل</div>
              </div>
            </div>
            {pct < 100 && (
              <div className="text-xs text-gray-500 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                💡 تحتاج <strong className="text-blue-700">{monthlyTarget - achieved} تحويل</strong> إضافي لتحقيق هدفك خلال {daysLeft} يوم متبقي
                {daysLeft > 0 && ` — أي ${((monthlyTarget - achieved) / daysLeft).toFixed(1)} تحويل / يوم`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Weekly activity chart */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4">
          <span className="text-lg">📊</span> نشاطك الأسبوعي هذا الشهر
        </h3>
        <div className="flex items-end gap-4 h-28 px-2">
          {weeksData.map((w, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-bold text-gray-700">{w.count}</span>
              <div className="w-full rounded-t-lg transition-all duration-700"
                style={{
                  height: `${Math.max(8, (w.count / maxWeekCount) * 88)}px`,
                  background: i === weeksData.length - 1 ? 'linear-gradient(180deg,#10b981,#059669)' : 'linear-gradient(180deg,#6366f1,#4f46e5)',
                  opacity: w.count === 0 ? 0.3 : 1,
                }} />
              <span className="text-[10px] text-gray-400">{w.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── HR Self-Service Section ──────────────────────────── */}
      {loadingMyHr ? (
        <div className="flex items-center justify-center py-8 gap-3 text-gray-400 text-sm">
          <span className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
          جاري تحميل بياناتك الوظيفية...
        </div>
      ) : myHrData && (
        <>
          {/* Row 1: Employment Info + Salary */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Employment Info Card */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4">
                <span className="text-lg">🏢</span> بياناتي الوظيفية
              </h3>
              <div className="space-y-0 text-sm divide-y divide-gray-50">
                {([
                  { label: 'تاريخ التعيين', value: myHrData.staff.hire_date ? new Date(myHrData.staff.hire_date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }) : '—' },
                  { label: 'القسم', value: myHrData.staff.department_name || '—' },
                  { label: 'نوع التوظيف', value: myHrData.staff.employment_type === 'full_time' ? 'دوام كامل' : myHrData.staff.employment_type === 'part_time' ? 'دوام جزئي' : myHrData.staff.employment_type === 'contractor' ? 'متعاقد' : myHrData.staff.employment_type || '—' },
                  { label: 'الحضور هذا الشهر', value: `${myHrData.attendance.present_days ?? 0} حاضر · ${myHrData.attendance.absent_days ?? 0} غياب · ${myHrData.attendance.late_days ?? 0} متأخر` },
                ] as { label: string; value: string }[]).map(({ label, value }) => (
                  <div key={label} className="flex justify-between items-center py-2.5">
                    <span className="text-gray-500">{label}</span>
                    <span className="font-semibold text-gray-800 text-left">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Salary Card */}
            <div className={`rounded-2xl p-5 shadow-sm border ${myHrData.salary ? 'bg-gradient-to-br from-emerald-50 to-green-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
              <h3 className="font-extrabold text-gray-900 flex items-center gap-2 mb-4">
                <span className="text-lg">💰</span> راتبي
                {!myHrData.salary && <span className="text-xs text-gray-400 font-normal mr-auto">لم يُحدد بعد</span>}
              </h3>
              {myHrData.salary ? (
                <div className="space-y-0 text-sm divide-y divide-emerald-100">
                  {([
                    { label: 'الراتب الأساسي', value: Number(myHrData.salary.base_salary).toLocaleString('ar-EG') + ' ج.م', cls: 'font-bold text-gray-900' },
                    { label: 'بدل السكن', value: Number(myHrData.salary.housing_allowance || 0).toLocaleString('ar-EG') + ' ج.م', cls: 'text-gray-700' },
                    { label: 'بدل المواصلات', value: Number(myHrData.salary.transport_allowance || 0).toLocaleString('ar-EG') + ' ج.م', cls: 'text-gray-700' },
                    { label: 'العمولة (هذا الشهر)', value: Number(myHrData.commission?.thisMonth?.total || 0).toLocaleString('ar-EG') + ' ج.م', cls: 'font-semibold text-emerald-700' },
                  ] as { label: string; value: string; cls: string }[]).map(({ label, value, cls }) => (
                    <div key={label} className="flex justify-between items-center py-2">
                      <span className="text-gray-500">{label}</span>
                      <span className={cls}>{value}</span>
                    </div>
                  ))}
                  <div className="pt-3 mt-1 flex justify-between items-center">
                    <span className="font-extrabold text-gray-900">الإجمالي المتوقع</span>
                    <span className="text-xl font-black text-emerald-700">
                      {(Number(myHrData.salary.base_salary) + Number(myHrData.salary.housing_allowance || 0) + Number(myHrData.salary.transport_allowance || 0) + Number(myHrData.commission?.thisMonth?.total || 0)).toLocaleString('ar-EG')} ج.م
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400 py-4 text-center">تواصل مع الإدارة لتحديد هيكل راتبك</p>
              )}
            </div>
          </div>

          {/* Row 2: Leave Balance + Advances */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

            {/* Leave Balance */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                  <span className="text-lg">🏖️</span> إجازاتي
                </h3>
                <button onClick={() => setShowMyLeaveFormProfile(v => !v)}
                  className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 font-bold">
                  + طلب إجازة
                </button>
              </div>

              {/* Leave balance ring */}
              <div className="flex items-center gap-5 mb-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                    <circle cx="40" cy="40" r="32" fill="none" stroke="#e5e7eb" strokeWidth="8"/>
                    <circle cx="40" cy="40" r="32" fill="none" stroke="#3b82f6"
                      strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={String(2 * Math.PI * 32)}
                      strokeDashoffset={String(2 * Math.PI * 32 * (1 - Math.min(1, (myHrData.leaveBalance.usedDays || 0) / (myHrData.leaveBalance.annualEntitlement || 21))))}
                      style={{ transition: 'stroke-dashoffset 1s ease' }}/>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-sm font-black text-gray-900">{myHrData.leaveBalance.remaining ?? 21}</span>
                    <span className="text-[9px] text-gray-400">متبقي</span>
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  {([
                    { dot: 'bg-blue-400', label: 'المستحق السنوي', val: myHrData.leaveBalance.annualEntitlement ?? 21, cls: 'text-gray-800' },
                    { dot: 'bg-red-400', label: 'المستخدم', val: myHrData.leaveBalance.usedDays ?? 0, cls: 'text-red-600' },
                    { dot: 'bg-emerald-400', label: 'المتبقي', val: myHrData.leaveBalance.remaining ?? 21, cls: 'text-emerald-600' },
                  ] as { dot: string; label: string; val: number; cls: string }[]).map(({ dot, label, val, cls }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${dot} inline-block flex-shrink-0`}/>
                      <span className="text-gray-500">{label}</span>
                      <span className={`font-bold mr-1 ${cls}`}>{val} يوم</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Leave request form */}
              {showMyLeaveFormProfile && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-3 space-y-3">
                  <p className="font-bold text-blue-800 text-sm">طلب إجازة جديد</p>
                  <select value={myLeaveFormProfile.type}
                    onChange={e => setMyLeaveFormProfile(p => ({ ...p, type: e.target.value }))}
                    className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300">
                    {[['ANNUAL','إجازة سنوية'],['SICK','إجازة مرضية'],['UNPAID','إجازة بدون راتب'],['EMERGENCY','طارئ'],['PERMISSION','إذن'],['MATERNITY','إجازة أمومة']].map(([v,l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="date" value={myLeaveFormProfile.start_date}
                      onChange={e => setMyLeaveFormProfile(p => ({ ...p, start_date: e.target.value }))}
                      className="border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                    <input type="date" value={myLeaveFormProfile.end_date}
                      onChange={e => setMyLeaveFormProfile(p => ({ ...p, end_date: e.target.value }))}
                      className="border border-blue-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  </div>
                  <textarea rows={2} placeholder="سبب الإجازة (اختياري)" value={myLeaveFormProfile.reason}
                    onChange={e => setMyLeaveFormProfile(p => ({ ...p, reason: e.target.value }))}
                    className="w-full border border-blue-200 rounded-lg px-3 py-2 text-sm resize-none bg-white focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <div className="flex gap-2">
                    <button
                      disabled={submittingMyLeaveProfile || !myLeaveFormProfile.start_date || !myLeaveFormProfile.end_date}
                      onClick={async () => {
                        if (!currentStaff) return;
                        setSubmittingMyLeaveProfile(true);
                        try {
                          const r = await fetch('/api/staff/me/leaves', { method: 'POST', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify(myLeaveFormProfile) });
                          if (!r.ok) throw new Error();
                          notify('success', 'تم إرسال طلب الإجازة بنجاح');
                          setShowMyLeaveFormProfile(false);
                          setMyLeaveFormProfile({ type: 'ANNUAL', start_date: '', end_date: '', reason: '' });
                          const hrData = await fetch('/api/staff/me/hr', { credentials: 'include', headers: adminAuthHeaders() }).then(r2 => r2.json()).catch(() => null);
                          if (hrData && !hrData.error) setMyHrData(hrData);
                        } catch { notify('error', 'فشل إرسال الطلب، حاول مجدداً'); }
                        finally { setSubmittingMyLeaveProfile(false); }
                      }}
                      className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                      {submittingMyLeaveProfile && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"/>}
                      {submittingMyLeaveProfile ? 'جاري الإرسال...' : 'إرسال الطلب'}
                    </button>
                    <button onClick={() => setShowMyLeaveFormProfile(false)}
                      className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">إلغاء</button>
                  </div>
                </div>
              )}

              {/* Recent leaves */}
              {myHrData.leaveHistory.length > 0 ? (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {myHrData.leaveHistory.slice(0, 6).map(l => (
                    <div key={l.id} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-gray-50 text-xs gap-2">
                      <span className="text-gray-700 font-medium flex-1 truncate">
                        {l.type === 'ANNUAL' ? 'سنوية' : l.type === 'SICK' ? 'مرضية' : l.type === 'EMERGENCY' ? 'طارئ' : l.type === 'UNPAID' ? 'بدون راتب' : l.type === 'PERMISSION' ? 'إذن' : l.type} · {l.total_days} يوم
                      </span>
                      <span className="text-gray-400 flex-shrink-0">{new Date(l.start_date).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })}</span>
                      <span className={`px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${l.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : l.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {l.status === 'APPROVED' ? '✓ موافق' : l.status === 'REJECTED' ? '✗ مرفوض' : '⏳ معلق'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-gray-400 text-xs">لا توجد إجازات مسجلة</div>
              )}
            </div>

            {/* Salary Advances */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                  <span className="text-lg">💵</span> السلف
                </h3>
                <button onClick={() => setShowAdvanceForm(v => !v)}
                  className="text-xs bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 font-bold">
                  + طلب سلفة
                </button>
              </div>

              {showAdvanceForm && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-3 space-y-3">
                  <p className="font-bold text-amber-800 text-sm">طلب سلفة جديدة</p>
                  <input type="number" placeholder="المبلغ (ج.م)" value={advanceDraft.amount}
                    onChange={e => setAdvanceDraft(p => ({ ...p, amount: e.target.value }))}
                    className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-300" dir="ltr" />
                  <textarea rows={2} placeholder="سبب السلفة" value={advanceDraft.reason}
                    onChange={e => setAdvanceDraft(p => ({ ...p, reason: e.target.value }))}
                    className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm resize-none bg-white focus:outline-none focus:ring-2 focus:ring-amber-300" />
                  <div className="flex gap-2">
                    <button
                      disabled={submittingAdvance || !advanceDraft.amount}
                      onClick={async () => {
                        if (!currentStaff) return;
                        setSubmittingAdvance(true);
                        try {
                          const r = await fetch('/api/staff/me/advances', { method: 'POST', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify({ amount: Number(advanceDraft.amount), reason: advanceDraft.reason }) });
                          if (!r.ok) throw new Error();
                          const newAdv = await r.json();
                          setMyAdvances(prev => [newAdv, ...prev]);
                          notify('success', 'تم إرسال طلب السلفة بنجاح');
                          setShowAdvanceForm(false);
                          setAdvanceDraft({ amount: '', reason: '' });
                        } catch { notify('error', 'فشل إرسال الطلب، حاول مجدداً'); }
                        finally { setSubmittingAdvance(false); }
                      }}
                      className="flex-1 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-1">
                      {submittingAdvance && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"/>}
                      {submittingAdvance ? 'جاري الإرسال...' : 'إرسال الطلب'}
                    </button>
                    <button onClick={() => setShowAdvanceForm(false)}
                      className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">إلغاء</button>
                  </div>
                </div>
              )}

              {myAdvances.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  <div className="text-3xl mb-2">💵</div>
                  لا توجد سلف مسجلة
                </div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto">
                  {myAdvances.map(adv => (
                    <div key={adv.id} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 border border-gray-100 text-xs gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-gray-800">{Number(adv.amount).toLocaleString('ar-EG')} {adv.currency}</div>
                        {adv.reason && <div className="text-gray-400 mt-0.5 truncate">{adv.reason}</div>}
                      </div>
                      <div className="text-left flex-shrink-0">
                        <span className={`block px-2 py-0.5 rounded-full font-bold text-center ${adv.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : adv.status === 'REJECTED' ? 'bg-red-100 text-red-700' : adv.status === 'DEDUCTED' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                          {adv.status === 'APPROVED' ? '✓ موافق' : adv.status === 'REJECTED' ? '✗ مرفوض' : adv.status === 'DEDUCTED' ? '✔ تم الخصم' : '⏳ معلق'}
                        </span>
                        <div className="text-gray-400 mt-0.5 text-center">{new Date(adv.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' })}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Disciplinary self-service: only the employee can acknowledge or appeal. */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
              <h3 className="font-extrabold text-gray-900 mb-4">التنبيهات والجزاءات الوظيفية</h3>
              {myDisciplinary.length === 0 ? (
                <div className="text-center py-5 text-gray-400 text-sm">لا توجد سجلات وظيفية مسجلة</div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {myDisciplinary.map(record => (
                    <div key={record.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-bold text-gray-900">{record.title}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            {record.incident_date ? new Date(record.incident_date).toLocaleDateString('ar-EG') : ''}
                            {' · '}{record.severity === 'high' ? 'عالية' : record.severity === 'low' ? 'منخفضة' : 'متوسطة'}
                          </div>
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-gray-600">
                          {record.status === 'open' ? 'جديد' : record.status === 'acknowledged' ? 'تم الاطلاع' : record.status === 'appealed' ? 'قيد التظلم' : 'مغلق'}
                        </span>
                      </div>
                      {record.description && <p className="mt-2 whitespace-pre-wrap text-gray-700">{record.description}</p>}
                      {record.action_taken && <p className="mt-2 text-xs text-gray-600">الإجراء: {record.action_taken}</p>}
                      {record.appeal_note && <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">التظلم: {record.appeal_note}</p>}
                      {['open', 'acknowledged'].includes(record.status) && (
                        <div className="mt-3 space-y-2">
                          {appealTarget === record.id && (
                            <textarea
                              value={appealNote}
                              onChange={event => setAppealNote(event.target.value)}
                              rows={3}
                              maxLength={5000}
                              placeholder="اكتب سبب التظلم بوضوح"
                              className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"
                            />
                          )}
                          <div className="flex flex-wrap gap-2">
                            {record.status === 'open' && (
                              <button
                                disabled={disciplinaryBusy === record.id}
                                onClick={() => updateDisciplinary(record.id, 'acknowledge')}
                                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                                تأكيد الاطلاع
                              </button>
                            )}
                            {appealTarget === record.id ? (
                              <>
                                <button
                                  disabled={disciplinaryBusy === record.id || !appealNote.trim()}
                                  onClick={() => updateDisciplinary(record.id, 'appeal')}
                                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">
                                  إرسال التظلم
                                </button>
                                <button onClick={() => { setAppealTarget(''); setAppealNote(''); }}
                                  className="rounded-lg bg-white px-3 py-1.5 text-xs text-gray-600">إلغاء</button>
                              </>
                            ) : (
                              <button onClick={() => { setAppealTarget(record.id); setAppealNote(''); }}
                                className="rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                                تقديم تظلم
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Settings form */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Settings2 size={16} className="text-primary-500" />بيانات الملف الشخصي
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">الاسم</label>
            <input value={draft.name} onChange={e => setDraft({ name: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">رقم الهاتف</label>
            <input value={draft.phone} onChange={e => setDraft({ phone: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">البريد الإلكتروني</label>
            <input value={currentStaff.email} readOnly
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">رابط الصورة الشخصية</label>
            <input value={draft.image} onChange={e => setDraft({ image: e.target.value })}
              placeholder="https://..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">📱 رقم واتساب للإرسال</label>
            <input value={draft.waNumber} onChange={e => setDraft({ waNumber: e.target.value })}
              placeholder="مثال: 201XXXXXXXXX"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">🎯 الهدف الشهري المحدد من الإدارة</label>
            <input value={draft.monthlyTarget} readOnly
              type="number" min={1} max={500}
              className="w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed" dir="ltr" />
          </div>
        </div>
        <button onClick={handleSave} disabled={staffSettingsSaving}
          className="w-full py-3 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 transition disabled:opacity-60 flex items-center justify-center gap-2 mt-2">
          {staffSettingsSaving ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
          {staffSettingsSaving ? 'جاري الحفظ...' : '💾 حفظ التغييرات'}
        </button>
      </div>

      {/* 2-column bottom layout: WA Templates + Custom Tags */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* WhatsApp Templates */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
              <span className="text-lg">💬</span> قوالب رسائل واتساب
            </h3>
            <button
              onClick={() => setStaffWaTemplateEdit({ id: `tpl-${Date.now()}`, title: '', body: '' })}
              className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-bold">
              + إضافة قالب
            </button>
          </div>

          {staffWaTemplateEdit && (
            <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
              <input
                value={staffWaTemplateEdit.title}
                onChange={e => setStaffWaTemplateEdit(t => t ? { ...t, title: e.target.value } : t)}
                placeholder="اسم القالب..."
                className="w-full border border-green-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 bg-white"
              />
              <textarea
                rows={4}
                value={staffWaTemplateEdit.body}
                onChange={e => setStaffWaTemplateEdit(t => t ? { ...t, body: e.target.value } : t)}
                placeholder="نص الرسالة... يمكنك استخدام {الاسم} و {الكورس} كمتغيرات"
                className="w-full border border-green-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-300 bg-white resize-none"
              />
              <div className="flex gap-2">
                <button
                  disabled={!staffWaTemplateEdit.title.trim() || !staffWaTemplateEdit.body.trim()}
                  onClick={async () => {
                    const exists = staffWaTemplates.find(t => t.id === staffWaTemplateEdit.id);
                    const updated = exists
                      ? staffWaTemplates.map(t => t.id === staffWaTemplateEdit.id ? staffWaTemplateEdit : t)
                      : [...staffWaTemplates, staffWaTemplateEdit];
                    if (await savePreferences(updated, staffContactTags)) setStaffWaTemplateEdit(null);
                  }}
                  className="flex-1 py-1.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                  حفظ القالب
                </button>
                <button onClick={() => setStaffWaTemplateEdit(null)} className="px-4 py-1.5 bg-gray-100 rounded-lg text-sm hover:bg-gray-200">إلغاء</button>
              </div>
            </div>
          )}

          {staffWaTemplates.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">
              <div className="text-3xl mb-2">💬</div>
              لا توجد قوالب بعد. أضف أول قالب!
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {staffWaTemplates.map(tpl => (
                <div key={tpl.id} className="border border-gray-100 rounded-xl p-3 bg-gray-50 hover:bg-green-50 transition group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm text-gray-800">{tpl.title}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => setStaffWaTemplateEdit(tpl)}
                        className="p-1 rounded text-blue-600 hover:bg-blue-100 text-xs">✏️</button>
                      <button onClick={async () => {
                        const updated = staffWaTemplates.filter(t => t.id !== tpl.id);
                        await savePreferences(updated, staffContactTags);
                      }}
                        className="p-1 rounded text-red-500 hover:bg-red-100 text-xs">🗑️</button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 line-clamp-2 whitespace-pre-line">{tpl.body}</p>
                  {draft?.waNumber && (
                    <a
                      href={`https://wa.me/${draft.waNumber}?text=${encodeURIComponent(tpl.body)}`}
                      target="_blank" rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-green-700 hover:text-green-900 font-bold">
                      📤 إرسال تجريبي
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Custom Contact Tags */}
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
              <span className="text-lg">🏷️</span> تاجات التواصل المخصصة
            </h3>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-lg">{staffContactTags.length} تاج</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">هذه التاجات ستظهر في سجل التواصل لتصنيف المحادثات بسرعة.</p>
          <div className="flex gap-2 mb-4">
            <input
              value={staffNewTagInput}
              onChange={e => setStaffNewTagInput(e.target.value)}
              onKeyDown={async e => {
                if (e.key === 'Enter' && staffNewTagInput.trim()) {
                  const tag = staffNewTagInput.trim();
                  if (!staffContactTags.includes(tag)) {
                    const updated = [...staffContactTags, tag];
                    await savePreferences(staffWaTemplates, updated);
                  }
                  setStaffNewTagInput('');
                }
              }}
              placeholder="اسم التاج... ثم Enter"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
            <button
              disabled={!staffNewTagInput.trim()}
              onClick={async () => {
                const tag = staffNewTagInput.trim();
                if (tag && !staffContactTags.includes(tag)) {
                  const updated = [...staffContactTags, tag];
                  await savePreferences(staffWaTemplates, updated);
                }
                setStaffNewTagInput('');
              }}
              className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-bold hover:bg-purple-700 disabled:opacity-50">
              + إضافة
            </button>
          </div>
          {staffContactTags.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">
              <div className="text-3xl mb-2">🏷️</div>
              لا توجد تاجات بعد. أضف تاجاتك!
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {staffContactTags.map(tag => (
                <span key={tag} className="flex items-center gap-1.5 bg-purple-50 text-purple-800 border border-purple-200 rounded-full px-3 py-1 text-xs font-semibold group">
                  {tag}
                  <button
                    onClick={async () => {
                      const updated = staffContactTags.filter(t => t !== tag);
                      await savePreferences(staffWaTemplates, updated);
                    }}
                    className="text-purple-400 hover:text-red-500 transition font-bold leading-none">×</button>
                </span>
              ))}
            </div>
          )}

          {/* Quick templates for common tags */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400 mb-2">تاجات شائعة للإضافة السريعة:</p>
            <div className="flex flex-wrap gap-1.5">
              {['مهتم جداً', 'يحتاج متابعة', 'لم يرد', 'عميل VIP', 'طالب راضي', 'سعر مرتفع', 'تأجيل'].filter(t => !staffContactTags.includes(t)).map(suggestion => (
                <button key={suggestion} onClick={async () => {
                  const updated = [...staffContactTags, suggestion];
                  await savePreferences(staffWaTemplates, updated);
                }}
                  className="text-[11px] bg-gray-100 text-gray-600 hover:bg-purple-100 hover:text-purple-700 rounded-full px-2.5 py-1 border border-gray-200 transition">
                  + {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
