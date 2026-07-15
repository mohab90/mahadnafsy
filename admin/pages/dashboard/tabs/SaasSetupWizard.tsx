import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2,
  CheckCircle2,
  CreditCard,
  KeyRound,
  MailCheck,
  Palette,
  PlugZap,
  ShieldCheck,
  Users,
} from 'lucide-react';

import type { General, ListItem, SectionData, SectionKey } from './systemSettingsSchema';

type DataMap = Partial<Record<SectionKey, SectionData>>;

type SetupStep = {
  key: string;
  title: string;
  detail: string;
  status: 'done' | 'partial' | 'missing';
  actionLabel: string;
  action: () => void;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function activeListCount(value: SectionData | undefined) {
  return Array.isArray(value) ? value.filter((item) => (item as ListItem).is_active !== false).length : 0;
}

function StatusPill({ status }: { status: SetupStep['status'] }) {
  const cfg = {
    done: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    partial: 'bg-amber-50 text-amber-700 border-amber-200',
    missing: 'bg-rose-50 text-rose-700 border-rose-200',
  }[status];
  const label = status === 'done' ? 'جاهز' : status === 'partial' ? 'ناقص' : 'مطلوب';
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${cfg}`}>{label}</span>;
}

export default function SaasSetupWizard({
  data,
  setActive,
}: {
  data: DataMap;
  setActive: (key: SectionKey) => void;
}) {
  const navigate = useNavigate();
  const general = (data.general || {}) as Partial<General>;

  const steps = useMemo<SetupStep[]>(() => {
    const brandFields = [
      general.institute_name,
      general.support_email,
      general.support_phone,
      general.brand_logo_url,
      general.brand_primary_color,
    ];
    const branchCount = activeListCount(data.branches);
    const paymentMethodsCount = activeListCount(data.payment_methods);
    const leadSourcesCount = activeListCount(data.lead_sources);
    const staffRolesCount = activeListCount(data.staff_roles);

    return [
      {
        key: 'brand',
        title: 'الهوية والدعم',
        detail: `${brandFields.filter(hasText).length}/5 عناصر مكتملة: الاسم، اللوجو، الألوان، البريد، الهاتف`,
        status: brandFields.every(hasText) ? 'done' : brandFields.some(hasText) ? 'partial' : 'missing',
        actionLabel: 'تعديل الهوية',
        action: () => setActive('general'),
        icon: Palette,
      },
      {
        key: 'branches',
        title: 'الفروع ومساحات العمل',
        detail: `${branchCount} فرع/مساحة عمل مفعلة داخل النظام`,
        status: branchCount >= 2 ? 'done' : branchCount === 1 ? 'partial' : 'missing',
        actionLabel: 'إعداد الفروع',
        action: () => navigate('/dashboard/branch_workspaces'),
        icon: Building2,
      },
      {
        key: 'payments',
        title: 'بوابات الدفع والتحصيل',
        detail: `${paymentMethodsCount} وسيلة دفع داخل القوائم، مع ربط Paymob/manual من تبويب البوابات`,
        status: paymentMethodsCount > 0 ? 'partial' : 'missing',
        actionLabel: 'ربط بوابات الدفع',
        action: () => navigate('/dashboard/payment_settings'),
        icon: CreditCard,
      },
      {
        key: 'lead_sources',
        title: 'مصادر الليد والداتا',
        detail: `${leadSourcesCount} مصدر داخلي، مع Facebook/Google Sheets/API من تبويب المصادر`,
        status: leadSourcesCount > 0 ? 'partial' : 'missing',
        actionLabel: 'ربط المصادر',
        action: () => navigate('/dashboard/lead_sources_settings'),
        icon: PlugZap,
      },
      {
        key: 'otp',
        title: 'OTP والقنوات',
        detail: 'توحيد البريد وواتساب وSMS تحت مزود OTP واحد قابل للاختبار',
        status: 'partial',
        actionLabel: 'إعداد OTP',
        action: () => navigate('/dashboard/otp_settings'),
        icon: KeyRound,
      },
      {
        key: 'permissions',
        title: 'الأدوار والصلاحيات',
        detail: `${staffRolesCount} دور وظيفي في القوائم، ويُدار التنفيذ من ملف الموظف والصلاحيات`,
        status: staffRolesCount > 0 ? 'partial' : 'missing',
        actionLabel: 'مراجعة الأدوار',
        action: () => setActive('staff_roles'),
        icon: Users,
      },
      {
        key: 'security',
        title: 'الأمان والنسخ الاحتياطي',
        detail: '2FA، النسخ الاحتياطي، ومراقبة التشغيل قبل الإنتاج',
        status: 'partial',
        actionLabel: 'فتح الأمان',
        action: () => setActive('security'),
        icon: ShieldCheck,
      },
      {
        key: 'integrations',
        title: 'التكاملات والأتمتة',
        detail: 'Webhooks، الإشعارات، الحملات، وربط النظام مع الأدوات الخارجية',
        status: 'partial',
        actionLabel: 'فتح التكاملات',
        action: () => navigate('/dashboard/webhooks'),
        icon: MailCheck,
      },
    ];
  }, [data, general, navigate, setActive]);

  const done = steps.filter((step) => step.status === 'done').length;
  const partial = steps.filter((step) => step.status === 'partial').length;
  const missing = steps.filter((step) => step.status === 'missing').length;
  const nextRequiredStep = steps.find((step) => step.status !== 'done') || steps[0];
  const progress = Math.round(((done + partial * 0.5) / steps.length) * 100);
  const requiredForPilot = ['brand', 'branches', 'payments', 'lead_sources', 'permissions'];
  const pilotBlockers = steps.filter((step) => requiredForPilot.includes(step.key) && step.status === 'missing');
  const pilotReady = pilotBlockers.length === 0 && done >= 2;
  const productionChecks = [
    { label: 'Brand/theme', ok: steps.find((step) => step.key === 'brand')?.status === 'done' },
    { label: 'Branch workspaces', ok: steps.find((step) => step.key === 'branches')?.status === 'done' },
    { label: 'Payment provider tested', ok: steps.find((step) => step.key === 'payments')?.status === 'done' },
    { label: 'Lead source tested', ok: steps.find((step) => step.key === 'lead_sources')?.status === 'done' },
    { label: 'Roles reviewed', ok: steps.find((step) => step.key === 'permissions')?.status !== 'missing' },
    { label: 'OTP channel ready', ok: steps.find((step) => step.key === 'otp')?.status === 'done' },
  ];
  const productionScore = Math.round((productionChecks.filter((check) => check.ok).length / productionChecks.length) * 100);

  return (
    <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" dir="rtl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-indigo-600">SaaS setup wizard</p>
          <h3 className="text-lg font-extrabold text-slate-900">تصطيب النظام كمنصة SaaS تشغيلية</h3>
          <p className="mt-1 text-xs text-slate-500">كل خطوة هنا تقود لإعداد فعلي يؤثر على الواجهة، الفروع، الدفع، الليد، الأمان، والتكاملات.</p>
        </div>
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-center">
          <p className="text-2xl font-black text-indigo-700">{progress}%</p>
          <p className="text-[11px] font-bold text-indigo-500">جاهزية التصطيب</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-500">Next required action</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="font-extrabold text-slate-900">{nextRequiredStep.title}</p>
            <button
              type="button"
              onClick={nextRequiredStep.action}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-indigo-700"
            >
              {nextRequiredStep.actionLabel}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center">
            <p className="text-lg font-black text-emerald-700">{done}</p>
            <p className="text-[10px] font-bold text-emerald-600">Done</p>
          </div>
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-center">
            <p className="text-lg font-black text-amber-700">{partial}</p>
            <p className="text-[10px] font-bold text-amber-600">Partial</p>
          </div>
          <div className="rounded-xl bg-rose-50 px-3 py-2 text-center">
            <p className="text-lg font-black text-rose-700">{missing}</p>
            <p className="text-[10px] font-bold text-rose-600">Missing</p>
          </div>
        </div>
      </div>

      <div className={`mb-4 rounded-xl border p-3 ${pilotReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className={`text-xs font-bold ${pilotReady ? 'text-emerald-700' : 'text-amber-700'}`}>Production pilot readiness</p>
            <p className="mt-1 font-extrabold text-slate-900">
              {pilotReady ? 'جاهز كبداية pilot بعد اختبارات التشغيل' : 'غير جاهز للـ pilot قبل إكمال العناصر الأساسية'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              الحد الأدنى: الهوية، فرع واحد على الأقل، وسيلة دفع، مصدر ليد، وأدوار تشغيل واضحة.
            </p>
          </div>
          {!pilotReady && (
            <div className="flex flex-wrap gap-1.5">
              {pilotBlockers.map((step) => (
                <span key={step.key} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200">
                  {step.title}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr]">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-bold text-slate-500">Production readiness</p>
          <p className={`mt-1 text-3xl font-black ${productionScore >= 80 ? 'text-emerald-700' : productionScore >= 50 ? 'text-amber-700' : 'text-rose-700'}`}>
            {productionScore}%
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Minimum operational checks before exposing the system to a real institute workspace.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {productionChecks.map((check) => (
            <div key={check.label} className={`rounded-xl border px-3 py-2 ${check.ok ? 'border-emerald-100 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-700">{check.label}</span>
                <span className={`grid h-6 w-6 place-items-center rounded-full ${check.ok ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                  <CheckCircle2 size={13} />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-4 md:grid-cols-2">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <button
              key={step.key}
              type="button"
              onClick={step.action}
              className="group rounded-xl border border-slate-200 bg-slate-50 p-3 text-right transition hover:border-indigo-200 hover:bg-white hover:shadow-sm"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200">
                  <Icon size={16} />
                </span>
                <StatusPill status={step.status} />
              </div>
              <p className="font-bold text-slate-900">{step.title}</p>
              <p className="mt-1 min-h-[36px] text-xs leading-relaxed text-slate-500">{step.detail}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-indigo-600 group-hover:text-indigo-700">
                <CheckCircle2 size={13} /> {step.actionLabel}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
