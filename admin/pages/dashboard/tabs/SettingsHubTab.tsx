import React from 'react';
import { Link } from 'react-router-dom';
import {
  Bot, Building2, CreditCard, Database, Globe, Mail, MessageSquareText,
  Shield, SlidersHorizontal, UserPlus, Webhook, Zap,
} from 'lucide-react';

type SettingsCard = {
  title: string;
  desc: string;
  href: string;
  icon: React.ReactNode;
  tone: string;
  area: string;
};

const SETTINGS_CARDS: SettingsCard[] = [
  {
    title: 'الهوية والموقع',
    desc: 'اسم المعهد، الشعار، الألوان، الفروع العامة، العملات، وطرق الدفع الأساسية.',
    href: '/dashboard/system_settings',
    icon: <Globe size={18} />,
    tone: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    area: 'مصدر الحقيقة العام',
  },
  {
    title: 'مساحات الفروع',
    desc: 'ربط كل فرع بالصفحات والوظائف المناسبة له بدون إظهار شريط منفصل في الداشبورد.',
    href: '/dashboard/branch_workspaces',
    icon: <Building2 size={18} />,
    tone: 'bg-amber-50 text-amber-700 border-amber-100',
    area: 'الفروع والتشغيل',
  },
  {
    title: 'بوابات الدفع',
    desc: 'إعدادات التحصيل، PayMob، التعليمات اليدوية، وربط الدفع بالفواتير والمراجعة.',
    href: '/dashboard/payment_settings',
    icon: <CreditCard size={18} />,
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    area: 'الماليات',
  },
  {
    title: 'مصادر الليد والداتا',
    desc: 'Facebook Leads، Google Sheets، مصادر API، وقواعد توزيع الليدز على السيلز.',
    href: '/dashboard/lead_sources_settings',
    icon: <UserPlus size={18} />,
    tone: 'bg-blue-50 text-blue-700 border-blue-100',
    area: 'التسويق والمبيعات',
  },
  {
    title: 'OTP والقنوات',
    desc: 'إعداد البريد، واتساب، SMS، مدة صلاحية الكود، وترتيب fallback.',
    href: '/dashboard/otp_settings',
    icon: <Shield size={18} />,
    tone: 'bg-violet-50 text-violet-700 border-violet-100',
    area: 'الأمان والدخول',
  },
  {
    title: 'حملات البريد',
    desc: 'إدارة حملات البريد وربطها بالشرائح والنتائج بدل استخدامها كأداة منعزلة.',
    href: '/dashboard/email_campaigns',
    icon: <Mail size={18} />,
    tone: 'bg-rose-50 text-rose-700 border-rose-100',
    area: 'التسويق',
  },
  {
    title: 'حملات SMS',
    desc: 'رسائل جماعية، شرائح العملاء، ومتابعة حالة الإرسال.',
    href: '/dashboard/sms_campaigns',
    icon: <MessageSquareText size={18} />,
    tone: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    area: 'التسويق',
  },
  {
    title: 'Drip Campaigns',
    desc: 'مسارات تلقائية تربط الليد بالمتابعة والحجز والدفع.',
    href: '/dashboard/drip_campaigns',
    icon: <Zap size={18} />,
    tone: 'bg-orange-50 text-orange-700 border-orange-100',
    area: 'الأتمتة',
  },
  {
    title: 'الأمان والمراقبة',
    desc: 'لوحة الأمان، IP whitelist، مراقبة السيرفر، والـ webhooks.',
    href: '/dashboard/security_dashboard',
    icon: <Webhook size={18} />,
    tone: 'bg-slate-50 text-slate-700 border-slate-100',
    area: 'التشغيل',
  },
  {
    title: 'إعدادات AI',
    desc: 'مزودات الذكاء الاصطناعي، مفاتيح التشغيل، وربط المساعد بسياق النظام.',
    href: '/dashboard/admin_ai_settings',
    icon: <Bot size={18} />,
    tone: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
    area: 'AI',
  },
  {
    title: 'ترحيل قاعدة البيانات',
    desc: 'أدوات فحص وترحيل schema عند الحاجة، ويجب استخدامها بحذر.',
    href: '/dashboard/pg_migrate',
    icon: <Database size={18} />,
    tone: 'bg-gray-50 text-gray-700 border-gray-100',
    area: 'قاعدة البيانات',
  },
  // The six below were reachable only from the sidebar, never from here — so this
  // page called itself "نقطة الدخول الموحدة للإعدادات" while silently omitting a
  // third of the settings. With them listed the hub is actually complete, and the
  // sidebar no longer has to carry a second copy of every settings entry.
  {
    title: 'إعدادات SMS',
    desc: 'مزوّد الرسائل القصيرة، اسم المُرسِل، وأرصدة الإرسال.',
    href: '/dashboard/sms_settings',
    icon: <MessageSquareText size={18} />,
    tone: 'bg-sky-50 text-sky-700 border-sky-100',
    area: 'القنوات',
  },
  {
    title: 'الأتمتة والقواعد',
    desc: 'القواعد اللي بتشتغل لوحدها: توزيع الليدز، التذكيرات، وتغيير الحالات.',
    href: '/dashboard/automation',
    icon: <Zap size={18} />,
    tone: 'bg-yellow-50 text-yellow-700 border-yellow-100',
    area: 'التشغيل',
  },
  {
    title: 'عميل المراسلة AI',
    desc: 'الردود الآلية على الواتساب والماسنجر وحدود تدخّل الموظف.',
    href: '/dashboard/messaging_agent',
    icon: <Bot size={18} />,
    tone: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
    area: 'AI',
  },
  {
    title: 'قائمة IP المسموحة',
    desc: 'تقييد دخول لوحة الإدارة على عناوين محددة.',
    href: '/dashboard/ip_whitelist',
    icon: <Shield size={18} />,
    tone: 'bg-violet-50 text-violet-700 border-violet-100',
    area: 'الأمان والدخول',
  },
  {
    title: 'Webhooks',
    desc: 'ربط الأنظمة الخارجية بأحداث النظام ومتابعة آخر تشغيل لكل ربط.',
    href: '/dashboard/webhooks',
    icon: <Webhook size={18} />,
    tone: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    area: 'التكاملات',
  },
  {
    title: 'مراقبة السيرفر',
    desc: 'حالة التشغيل، الذاكرة، وسجل إعادة التشغيل.',
    href: '/dashboard/server_monitor',
    icon: <SlidersHorizontal size={18} />,
    tone: 'bg-gray-50 text-gray-700 border-gray-100',
    area: 'التشغيل',
  },
];

export default function SettingsHubTab() {
  return (
    <div className="space-y-5" dir="rtl">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gray-900 text-white">
            <SlidersHorizontal size={21} />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-gray-900">مركز إعدادات النظام</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-500">
              هذه الصفحة هي نقطة الدخول الموحدة للإعدادات. الهدف أن يكون لكل إعداد مكان واضح ومصدر حقيقة واحد بدل التنقل بين صفحات متفرقة.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {SETTINGS_CARDS.map(card => (
          <Link
            key={card.href}
            to={card.href}
            className="group rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className={`grid h-10 w-10 place-items-center rounded-xl border ${card.tone}`}>
                {card.icon}
              </div>
              <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-bold text-gray-500">
                {card.area}
              </span>
            </div>
            <h3 className="text-sm font-extrabold text-gray-900 group-hover:text-primary-700">{card.title}</h3>
            <p className="mt-2 text-xs leading-5 text-gray-500">{card.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
