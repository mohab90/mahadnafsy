import React, { useState, useEffect, useCallback, Suspense } from 'react';
import {
  Settings, Save, RotateCcw, Plus, Trash2, Building2, CreditCard,
  Globe, Award, Hash, Users, MapPin, Tag, Loader2, CheckCircle,
  Eye, EyeOff, Clock, ArrowLeftRight, DollarSign, Shield, Database,
  Download, RefreshCw, HardDrive, Sliders, Lock, Gauge, MessageSquareText,
  Bot, Zap, Activity, Mail,
} from 'lucide-react';
import { mysqlAuth } from '../../../lib/mysqlapi';
import FeatureFlagsPanel from '../FeatureFlagsPanel';
import SiteIdentityPanel from '../SiteIdentityPanel';
import SettingsOverviewPanel from '../SettingsOverviewPanel';
import MessageTemplatesPanel from '../MessageTemplatesPanel';
import RbacSettingsTab from './RbacSettingsTab';
import EmailSettingsTab from './EmailSettingsTab';
import {
  MessagingAgentTab, AdminAiSettingsTab, WebhooksTab,
  SecurityDashboardTab, ServerMonitorTab, PgMigrateTab,
} from '../lazyTabs';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; isAdmin?: boolean; }

// Sidebar categories — groups the (now ~26) sections into navigable sections.
const GROUPS: { key: string; label: string }[] = [
  { key: 'main',     label: 'عام' },
  { key: 'finance',  label: 'المالية' },
  { key: 'lists',    label: 'القوائم والثوابت' },
  { key: 'platform', label: 'المنصّة' },
  { key: 'ai',       label: 'الذكاء الاصطناعي' },
  { key: 'security', label: 'الأمان والصلاحيات' },
  { key: 'system',   label: 'النظام' },
];

// ─── Section definitions ──────────────────────────────────────────────────
const SECTIONS = [
  // ── عام ──
  { key: 'overview',           label: 'نظرة عامة',           icon: Gauge,           color: 'indigo',  source: 'overview', group: 'main' },
  { key: 'identity',           label: 'الهوية والمدفوعات',   icon: Building2,       color: 'slate',   source: 'identity', group: 'main' },
  { key: 'general',            label: 'الإعدادات العامة',    icon: Settings,        color: 'indigo',  source: 'syscfg',   group: 'main' },
  { key: 'branches',           label: 'الفروع',              icon: Building2,       color: 'blue',    source: 'content',  group: 'main' },
  // ── المالية ──
  { key: 'payment_methods',    label: 'وسائل الدفع',         icon: CreditCard,      color: 'green',   source: 'content',  group: 'finance' },
  { key: 'exchange_rates',     label: 'أسعار الصرف',         icon: ArrowLeftRight,  color: 'amber',   source: 'content',  group: 'finance' },
  { key: 'cert_pricing',       label: 'تسعير الشهادات',      icon: Award,           color: 'purple',  source: 'content',  group: 'finance' },
  { key: 'financial',          label: 'الإعدادات المالية',   icon: Hash,            color: 'emerald', source: 'syscfg',   group: 'finance' },
  // ── القوائم والثوابت ──
  { key: 'session_types',      label: 'أنواع الجلسات',       icon: Clock,           color: 'sky',     source: 'syscfg',   group: 'lists' },
  { key: 'lead_sources',       label: 'مصادر الليدات',       icon: Tag,             color: 'pink',    source: 'syscfg',   group: 'lists' },
  { key: 'expense_categories', label: 'فئات المصاريف',       icon: DollarSign,      color: 'orange',  source: 'syscfg',   group: 'lists' },
  { key: 'nationalities',      label: 'الجنسيات',            icon: Globe,           color: 'teal',    source: 'syscfg',   group: 'lists' },
  { key: 'staff_roles',        label: 'أدوار الموظفين',      icon: Users,           color: 'violet',  source: 'syscfg',   group: 'lists' },
  { key: 'countries',          label: 'الدول',               icon: MapPin,          color: 'rose',    source: 'syscfg',   group: 'lists' },
  { key: 'currencies',         label: 'العملات',             icon: DollarSign,      color: 'yellow',  source: 'syscfg',   group: 'lists' },
  // ── المنصّة ──
  { key: 'features',           label: 'الميزات والوحدات',    icon: Sliders,         color: 'cyan',    source: 'features', group: 'platform' },
  { key: 'templates',          label: 'قوالب الرسائل',       icon: MessageSquareText, color: 'green', source: 'templates', group: 'platform' },
  { key: 'email_settings',     label: 'البريد الإلكتروني',   icon: Mail,            color: 'blue',    source: 'embed',    group: 'platform' },
  { key: 'webhooks',           label: 'Webhooks',            icon: Zap,             color: 'amber',   source: 'embed',    group: 'platform' },
  // ── الذكاء الاصطناعي ──
  { key: 'messaging_agent',    label: 'عميل المراسلة AI',    icon: Bot,             color: 'sky',     source: 'embed',    group: 'ai' },
  { key: 'admin_ai_settings',  label: 'إعدادات الذكاء',      icon: Settings,        color: 'violet',  source: 'embed',    group: 'ai' },
  // ── الأمان والصلاحيات ──
  { key: 'permissions',        label: 'الصلاحيات والأدوار',  icon: Lock,            color: 'rose',    source: 'rbac',     group: 'security' },
  { key: 'security',           label: 'الأمان (2FA)',        icon: Shield,          color: 'rose',    source: 'security', group: 'security' },
  { key: 'security_dashboard', label: 'لوحة الأمان',         icon: Shield,          color: 'rose',    source: 'embed',    group: 'security' },
  { key: 'backups',            label: 'النسخ الاحتياطية',  icon: Database,        color: 'slate',   source: 'backups',  group: 'security' },
  // ── النظام (مشرف) ──
  { key: 'server_monitor',     label: 'مراقبة السيرفر',      icon: Activity,        color: 'teal',    source: 'embed',    group: 'system', adminOnly: true },
  { key: 'pg_migrate',         label: 'ترحيل قاعدة البيانات', icon: Database,       color: 'slate',   source: 'embed',    group: 'system', adminOnly: true },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

// ─── Types ────────────────────────────────────────────────────────────────
interface ListItem { key: string; label: string; is_active: boolean; icon?: string; symbol?: string; code?: string; flag?: string; is_default?: boolean; }
interface CertItem { type: string; label: string; egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number; }
interface ExchangeRates { sar_to_egp: number; usd_to_egp: number; }
interface General { institute_name: string; institute_name_en: string; website_url: string; support_email: string; support_phone: string; default_currency: string; default_timezone: string; working_days: string[]; }
interface Financial { consultation_price: number; installment_down_pct: number; max_installment_months: number; default_lead_sla_hours: number; lead_auto_archive_days: number; vat_percent: number; invoice_prefix: string; session_duration_default: number; }
type SectionData = ListItem[] | CertItem[] | General | Financial | ExchangeRates;

// ─── Cert type definitions (fixed list matching old system) ───────────────
const CERT_TYPES = [
  { type: 'social_solidarity',  label: 'شهادة التضامن الاجتماعي' },
  { type: 'ain_shams',          label: 'شهادة جامعة عين شمس'      },
  { type: 'experience_external',label: 'شهادة الخبرة الخارجي'     },
  { type: 'practice_external',  label: 'شهادة مزاولة خارجي'       },
  { type: 'national_council',   label: 'شهادة المجلس القومي'      },
  { type: 'american_board',     label: 'شهادة البورد الأمريكي'    },
  { type: 'institute',          label: 'شهادة المعهد'              },
  { type: 'other',              label: 'شهادة أخرى'                },
];

const DEFAULT_PAYMENT_METHODS = ['خزنة الدقي', 'خزنة الفرع', 'فودافون كاش', 'انستا باي', 'تحويل بنكي', 'احمد السعودية'];

// ─── Color map ────────────────────────────────────────────────────────────
const COLOR: Record<string, { bg: string; text: string; border: string }> = {
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200'  },
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200'    },
  green:   { bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200'   },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
  purple:  { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200'  },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200'     },
  pink:    { bg: 'bg-pink-50',    text: 'text-pink-700',    border: 'border-pink-200'    },
  orange:  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200'  },
  teal:    { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200'    },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200'  },
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200'    },
  yellow:  { bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200'  },
  cyan:    { bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200'    },
  slate:   { bg: 'bg-slate-50',   text: 'text-slate-700',   border: 'border-slate-200'   },
};

// ─── Content conversion helpers ───────────────────────────────────────────
function parseContentSections(raw: Record<string, string>): Partial<Record<SectionKey, SectionData>> {
  // Branches: [{id, label}] → [{key, label, is_active}]
  let branches: ListItem[] = [];
  try {
    branches = JSON.parse(raw['institute.branches'] || '[]')
      .map((b: { id: string; label: string }) => ({ key: b.id, label: b.label, is_active: true }));
  } catch {}

  // Payment methods: "A||B||C" → [{key, label, is_active}]
  const pmStr = raw['finance.payment_methods'] || DEFAULT_PAYMENT_METHODS.join('||');
  const payment_methods: ListItem[] = pmStr.split('||').map((m: string, i: number) => ({
    key: `pm_${i}_${m.trim().slice(0,8)}`,
    label: m.trim(),
    is_active: true,
  })).filter(m => m.label);

  // Cert pricing: {key: {egyptianEGP,...}} → CertItem[]
  let cpMap: Record<string, { egyptianEGP?: number; residentEGP?: number; residentSAR?: number; foreignUSD?: number }> = {};
  try { cpMap = JSON.parse(raw['extra_cert_pricing'] || '{}'); } catch {}
  const cert_pricing: CertItem[] = CERT_TYPES.map(ct => ({
    type: ct.type, label: ct.label,
    egyptianEGP:  cpMap[ct.type]?.egyptianEGP  || 0,
    residentEGP:  cpMap[ct.type]?.residentEGP  || 0,
    residentSAR:  cpMap[ct.type]?.residentSAR  || 0,
    foreignUSD:   cpMap[ct.type]?.foreignUSD   || 0,
  }));

  // Exchange rates
  const exchange_rates: ExchangeRates = {
    sar_to_egp: parseFloat(raw['exchange.sar_to_egp'] || '13') || 13,
    usd_to_egp: parseFloat(raw['exchange.usd_to_egp'] || '50') || 50,
  };

  return { branches, payment_methods, cert_pricing, exchange_rates };
}

function buildContentPatch(key: SectionKey, value: SectionData): Record<string, string> {
  switch (key) {
    case 'branches': {
      const list = (value as ListItem[]).map(b => ({ id: b.key, label: b.label }));
      return { 'institute.branches': JSON.stringify(list) };
    }
    case 'payment_methods': {
      const str = (value as ListItem[]).map(m => m.label).join('||');
      return { 'finance.payment_methods': str };
    }
    case 'cert_pricing': {
      const map: Record<string, object> = {};
      (value as CertItem[]).forEach(c => {
        map[c.type] = { egyptianEGP: c.egyptianEGP, residentEGP: c.residentEGP, residentSAR: c.residentSAR, foreignUSD: c.foreignUSD };
      });
      return { 'extra_cert_pricing': JSON.stringify(map) };
    }
    case 'exchange_rates': {
      const er = value as ExchangeRates;
      return { 'exchange.sar_to_egp': String(er.sar_to_egp), 'exchange.usd_to_egp': String(er.usd_to_egp) };
    }
    default: return {};
  }
}

// ─── Shared UI ────────────────────────────────────────────────────────────
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-xs font-semibold text-gray-500 mb-1 block">{label}</label>
    {children}
  </div>
);
const TextInput = ({ value, onChange, placeholder = '', type = 'text', suffix = '' }: { value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; suffix?: string }) => (
  <div className="flex items-center gap-1">
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white" />
    {suffix && <span className="text-xs text-gray-400 whitespace-nowrap">{suffix}</span>}
  </div>
);
const Card = ({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) => (
  <div className="bg-white border border-gray-200 rounded-2xl p-5">
    <div className="mb-4 pb-3 border-b border-gray-100">
      <h4 className="font-bold text-gray-700 text-sm">{title}</h4>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
    {children}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────
const SystemSettingsTab: React.FC<Props> = ({ notify, isAdmin = true }) => {
  const [active, setActive]       = useState<SectionKey>('overview');
  const [data, setData]           = useState<Partial<Record<SectionKey, SectionData>>>({});
  const [dirty, setDirty]         = useState<Set<SectionKey>>(new Set());
  const [saving, setSaving]       = useState<Set<SectionKey>>(new Set());
  const [globalLoading, setGlobalLoading] = useState(true);

  // Load both sys-config and content on mount
  useEffect(() => {
    (async () => {
      try {
        const [cfgRes, contentRes] = await Promise.all([
          fetch('/api/admin/sys-config', { credentials: 'include' }),
          fetch('/api/admin/content',    { credentials: 'include' }),
        ]);
        const cfg     = cfgRes.ok     ? await cfgRes.json()     : {};
        const rawContent = contentRes.ok ? await contentRes.json() : {};
        const contentSections = parseContentSections(rawContent);
        setData({ ...cfg, ...contentSections });
      } catch {
        notify('error', 'فشل تحميل الإعدادات');
      } finally {
        setGlobalLoading(false);
      }
    })();
  }, []);

  const save = useCallback(async (key: SectionKey) => {
    const payload = data[key];
    if (payload === undefined) return;
    const section = SECTIONS.find(s => s.key === key)!;
    setSaving(s => new Set([...s, key]));
    try {
      if (section.source === 'content') {
        const patch = buildContentPatch(key, payload);
        const res = await fetch('/api/admin/content', {
          method: 'PATCH', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch(`/api/admin/sys-config/${key}`, {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setDirty(d => { const n = new Set(d); n.delete(key); return n; });
      notify('success', `✅ تم حفظ "${section.label}"`);
    } catch (e: any) {
      notify('error', 'خطأ في الحفظ: ' + e.message);
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [data, notify]);

  const reset = useCallback(async (key: SectionKey) => {
    if (!confirm('هل تريد إعادة هذا القسم للقيم الافتراضية؟')) return;
    const section = SECTIONS.find(s => s.key === key)!;
    try {
      if (section.source === 'content') {
        // Reload from content API
        const res = await fetch('/api/admin/content', { credentials: 'include' });
        const raw = await res.json();
        const contentSections = parseContentSections(raw);
        setData(d => ({ ...d, [key]: contentSections[key as keyof typeof contentSections] }));
      } else {
        const res = await fetch(`/api/admin/sys-config/${key}/reset`, { method: 'POST', credentials: 'include' });
        const json = await res.json();
        setData(d => ({ ...d, [key]: json.data }));
      }
      setDirty(d => { const n = new Set(d); n.delete(key); return n; });
      notify('info', 'تمت إعادة الإعدادات');
    } catch {
      notify('error', 'فشل إعادة التعيين');
    }
  }, [notify]);

  const mutate = useCallback((key: SectionKey, value: SectionData) => {
    setData(d => ({ ...d, [key]: value }));
    setDirty(d => new Set([...d, key]));
  }, []);
  const mutateField = useCallback((key: SectionKey, field: string, value: any) => {
    setData(d => ({ ...d, [key]: { ...(d[key] as any), [field]: value } }));
    setDirty(d => new Set([...d, key]));
  }, []);

  const activeSec = SECTIONS.find(s => s.key === active)!;
  const c = COLOR[activeSec.color] ?? COLOR.indigo;

  // Full tabs folded into Settings from the old standalone menu entries (lazy-rendered).
  const EMBED_TABS: Partial<Record<string, React.ReactNode>> = {
    webhooks:           <WebhooksTab notify={notify} />,
    messaging_agent:    <MessagingAgentTab notify={notify} />,
    admin_ai_settings:  <AdminAiSettingsTab notify={notify} />,
    email_settings:     <EmailSettingsTab notify={notify} />,
    security_dashboard: <SecurityDashboardTab notify={notify} />,
    server_monitor:     <ServerMonitorTab notify={notify} />,
    pg_migrate:         <PgMigrateTab />,
  };

  if (globalLoading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-indigo-500 ml-3" size={28}/>
      <span className="text-gray-500 text-sm">جاري تحميل الإعدادات...</span>
    </div>
  );

  return (
    <div className="flex gap-4" dir="rtl">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-4">
          <div className="px-4 py-3 bg-gradient-to-l from-brand-600 to-brand-700 text-brand-fg">
            <h2 className="font-bold text-sm flex items-center gap-2"><Settings size={14}/> إعدادات النظام</h2>
          </div>
          <nav className="p-2 space-y-2 max-h-[calc(100vh-7rem)] overflow-y-auto">
            {GROUPS.map(grp => {
              const items = SECTIONS.filter(s => s.group === grp.key && (!('adminOnly' in s && s.adminOnly) || isAdmin));
              if (!items.length) return null;
              return (
                <div key={grp.key} className="space-y-0.5">
                  <p className="px-2 pt-1 text-[10px] font-extrabold text-gray-400 uppercase tracking-wider">{grp.label}</p>
                  {items.map(sec => {
                    const Icon = sec.icon;
                    const isActive = active === sec.key;
                    const isDirty  = dirty.has(sec.key as SectionKey);
                    return (
                      <button key={sec.key} onClick={() => setActive(sec.key as SectionKey)}
                        aria-current={isActive ? 'page' : undefined}
                        aria-label={`قسم ${sec.label}`}
                        className={`w-full text-right px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2 transition-all ${
                          isActive ? `${COLOR[sec.color].bg} ${COLOR[sec.color].text} font-bold` : 'text-gray-600 hover:bg-gray-50'
                        }`}>
                        <Icon size={13} className="flex-shrink-0"/>
                        <span className="flex-1 truncate">{sec.label}</span>
                        {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"/>}
                        {sec.source === 'content' && !isActive && <span className="text-[9px] text-blue-400 font-normal hidden sm:block">live</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        {/* Section header */}
        <div className={`${c.bg} border ${c.border} rounded-2xl p-4 mb-4 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${c.bg} border ${c.border} flex items-center justify-center`}>
              <activeSec.icon size={18} className={c.text}/>
            </div>
            <div>
              <h3 className={`font-bold text-base ${c.text}`}>{activeSec.label}</h3>
              {activeSec.source === 'content' && (
                <p className="text-xs text-blue-500">⚡ يحفظ مباشرة ويؤثر على كل أجزاء النظام</p>
              )}
              {dirty.has(active) && <p className="text-xs text-amber-600">⚠ يوجد تغييرات غير محفوظة</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Save/reset only for editable data sections (syscfg / content); self-contained panels manage their own saving */}
            {(activeSec.source === 'syscfg' || activeSec.source === 'content') && (<>
            <button onClick={() => reset(active)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition">
              <RotateCcw size={12}/> إعادة
            </button>
            <button onClick={() => save(active)} disabled={!dirty.has(active) || saving.has(active)}
              className={`flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-lg transition ${
                dirty.has(active) && !saving.has(active)
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}>
              {saving.has(active) ? <Loader2 size={12} className="animate-spin"/> : <Save size={12}/>}
              حفظ
            </button>
            </>)}
          </div>
        </div>

        {/* Body */}
        {active === 'general'            && <GeneralSection    data={data.general as General}           mutateField={(f,v) => mutateField('general', f, v)}/>}
        {active === 'financial'          && <FinancialSection   data={data.financial as Financial}       mutateField={(f,v) => mutateField('financial', f, v)}/>}
        {active === 'exchange_rates'     && <ExchangeRatesSection data={data.exchange_rates as ExchangeRates} mutateField={(f,v) => mutateField('exchange_rates', f, v)}/>}
        {active === 'cert_pricing'       && <CertPricingSection  data={data.cert_pricing as CertItem[]}  mutate={v => mutate('cert_pricing', v)} c={c}/>}
        {active === 'currencies'         && <CurrenciesSection   data={data.currencies as ListItem[]}    mutate={v => mutate('currencies', v)} c={c}/>}
        {active === 'countries'          && <CountriesSection    data={data.countries as ListItem[]}     mutate={v => mutate('countries', v)} c={c}/>}
        {active === 'overview'           && <SettingsOverviewPanel goTo={s => setActive(s as SectionKey)} />}
        {active === 'identity'           && <SiteIdentityPanel   notify={notify} />}
        {active === 'features'           && <FeatureFlagsPanel   notify={notify} />}
        {active === 'templates'          && <MessageTemplatesPanel notify={notify} />}
        {active === 'permissions'        && <RbacSettingsTab     notify={notify} />}
        {active === 'security'           && <Security2FASection  notify={notify} />}
        {active === 'backups'             && <BackupSection       notify={notify} />}
        {/* Embedded full tabs (lazy) — consolidated here from the old standalone settings menu */}
        {EMBED_TABS[active] && (
          <Suspense fallback={<div className="flex items-center justify-center py-20"><Loader2 size={26} className="animate-spin text-brand-600"/></div>}>
            {EMBED_TABS[active]}
          </Suspense>
        )}
        {(activeSec.source === 'syscfg' || activeSec.source === 'content') &&
          !['general','financial','exchange_rates','cert_pricing','currencies','countries'].includes(active) && (
          <ListSection data={data[active] as ListItem[]} mutate={v => mutate(active, v)} c={c} sectionKey={active}/>
        )}
      </main>
    </div>
  );
};

// ─── General Settings ─────────────────────────────────────────────────────
const WORKING_DAYS = [
  { key: 'Sunday', label: 'الأحد' }, { key: 'Monday', label: 'الاثنين' },
  { key: 'Tuesday', label: 'الثلاثاء' }, { key: 'Wednesday', label: 'الأربعاء' },
  { key: 'Thursday', label: 'الخميس' }, { key: 'Friday', label: 'الجمعة' },
  { key: 'Saturday', label: 'السبت' },
];

const GeneralSection: React.FC<{ data: General; mutateField: (f: string, v: any) => void }> = ({ data, mutateField }) => {
  const g = data || {} as General;
  return (
    <div className="space-y-4">
      <Card title="معلومات المؤسسة">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="الاسم (عربي)"><TextInput value={g.institute_name||''} onChange={v=>mutateField('institute_name',v)} placeholder="معهد الدراسات النفسية"/></Field>
          <Field label="الاسم (إنجليزي)"><TextInput value={g.institute_name_en||''} onChange={v=>mutateField('institute_name_en',v)} placeholder="Institute of Psychological Studies"/></Field>
          <Field label="الموقع الإلكتروني"><TextInput value={g.website_url||''} onChange={v=>mutateField('website_url',v)} type="url" placeholder="https://mahadnafsy.com"/></Field>
          <Field label="إيميل الدعم"><TextInput value={g.support_email||''} onChange={v=>mutateField('support_email',v)} type="email" placeholder="info@mahadnafsy.com"/></Field>
          <Field label="هاتف الدعم"><TextInput value={g.support_phone||''} onChange={v=>mutateField('support_phone',v)} type="tel" placeholder="+20 10 xxxx xxxx"/></Field>
        </div>
      </Card>
      <Card title="الإعدادات الإقليمية">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="العملة الافتراضية">
            <select value={g.default_currency||'EGP'} onChange={e=>mutateField('default_currency',e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {['EGP','SAR','USD','EUR','AED','KWD'].map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="المنطقة الزمنية">
            <select value={g.default_timezone||'Africa/Cairo'} onChange={e=>mutateField('default_timezone',e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {['Africa/Cairo','Asia/Riyadh','Asia/Dubai','Asia/Kuwait','Europe/London','America/New_York'].map(tz=><option key={tz} value={tz}>{tz}</option>)}
            </select>
          </Field>
        </div>
      </Card>
      <Card title="أيام العمل">
        <div className="flex flex-wrap gap-2 mt-1">
          {WORKING_DAYS.map(day => {
            const wd: string[] = g.working_days || [];
            const checked = wd.includes(day.key);
            return (
              <button key={day.key}
                onClick={() => mutateField('working_days', checked ? wd.filter(d=>d!==day.key) : [...wd, day.key])}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition ${checked ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}>
                {day.label}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
};

// ─── Financial Settings ───────────────────────────────────────────────────
const FinancialSection: React.FC<{ data: Financial; mutateField: (f: string, v: any) => void }> = ({ data, mutateField }) => {
  const f = data || {} as Financial;
  const fields = [
    { key: 'consultation_price',       label: 'سعر جلسة الاستشارة',          suffix: 'ج.م',   type: 'number' },
    { key: 'installment_down_pct',     label: 'نسبة الدفعة الأولى للتقسيط',  suffix: '%',     type: 'number' },
    { key: 'max_installment_months',   label: 'أقصى مدة تقسيط',              suffix: 'شهر',   type: 'number' },
    { key: 'default_lead_sla_hours',   label: 'مهلة التواصل مع الليد',       suffix: 'ساعة',  type: 'number' },
    { key: 'lead_auto_archive_days',   label: 'أرشفة الليدات الخاملة بعد',   suffix: 'يوم',   type: 'number' },
    { key: 'vat_percent',              label: 'نسبة ضريبة القيمة المضافة',    suffix: '%',     type: 'number' },
    { key: 'invoice_prefix',           label: 'بادئة رقم الفاتورة',           suffix: '',      type: 'text'   },
    { key: 'session_duration_default', label: 'مدة الجلسة الافتراضية',        suffix: 'دقيقة', type: 'number' },
  ];
  return (
    <Card title="الإعدادات المالية والتشغيلية">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map(fld => (
          <Field key={fld.key} label={fld.label}>
            <TextInput value={(f as any)[fld.key]??''} onChange={v=>mutateField(fld.key, fld.type==='number' ? Number(v) : v)} type={fld.type} suffix={fld.suffix}/>
          </Field>
        ))}
      </div>
    </Card>
  );
};

// ─── Exchange Rates ───────────────────────────────────────────────────────
const ExchangeRatesSection: React.FC<{ data: ExchangeRates; mutateField: (f: string, v: any) => void }> = ({ data, mutateField }) => {
  const er = data || { sar_to_egp: 13, usd_to_egp: 50 };
  return (
    <div className="space-y-4">
      <Card title="أسعار تحويل العملات إلى الجنيه المصري" hint="تُستخدم في احتساب الإيرادات وتقارير الحسابات عبر العملات المختلفة">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🇸🇦</span>
              <div>
                <p className="font-bold text-amber-800 text-sm">الريال السعودي → ج.م</p>
                <p className="text-xs text-amber-600">1 ر.س = ? ج.م</p>
              </div>
            </div>
            <Field label="سعر الصرف">
              <TextInput value={er.sar_to_egp} onChange={v=>mutateField('sar_to_egp', parseFloat(v)||0)} type="number" suffix="ج.م"/>
            </Field>
            <p className="text-xs text-amber-600">مثال: 1000 ر.س × {er.sar_to_egp} = {(er.sar_to_egp * 1000).toLocaleString()} ج.م</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🇺🇸</span>
              <div>
                <p className="font-bold text-blue-800 text-sm">الدولار الأمريكي → ج.م</p>
                <p className="text-xs text-blue-600">1 $ = ? ج.م</p>
              </div>
            </div>
            <Field label="سعر الصرف">
              <TextInput value={er.usd_to_egp} onChange={v=>mutateField('usd_to_egp', parseFloat(v)||0)} type="number" suffix="ج.م"/>
            </Field>
            <p className="text-xs text-blue-600">مثال: 100 $ × {er.usd_to_egp} = {(er.usd_to_egp * 100).toLocaleString()} ج.م</p>
          </div>
        </div>
      </Card>
    </div>
  );
};

// ─── Certificate Pricing (uses old content format) ────────────────────────
const CertPricingSection: React.FC<{ data: CertItem[]; mutate: (v: CertItem[]) => void; c: typeof COLOR[string] }> = ({ data, mutate, c }) => {
  const items = data || CERT_TYPES.map(ct => ({ type: ct.type, label: ct.label, egyptianEGP: 0, residentEGP: 0, residentSAR: 0, foreignUSD: 0 }));
  const update = (idx: number, field: keyof CertItem, value: any) =>
    mutate(items.map((it,i) => i===idx ? { ...it, [field]: typeof it[field]==='number' ? Number(value) : value } : it));
  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-right text-xs font-bold text-gray-500 border-b border-gray-200">
                <th className="px-4 py-3">نوع الشهادة</th>
                <th className="px-3 py-3 text-center text-blue-700">🇪🇬 مصري (ج.م)</th>
                <th className="px-3 py-3 text-center text-green-700">👤 غير مصري مقيم (ج.م)</th>
                <th className="px-3 py-3 text-center text-amber-700">🇸🇦 سعودي (ر.س)</th>
                <th className="px-3 py-3 text-center text-purple-700">✈️ دولي ($)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((cert, idx) => (
                <tr key={cert.type} className="hover:bg-gray-50/50">
                  <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">{cert.label}</td>
                  {(['egyptianEGP','residentEGP','residentSAR','foreignUSD'] as const).map(f=>(
                    <td key={f} className="px-3 py-2">
                      <input type="number" min="0" value={cert[f]||''} onChange={e=>update(idx,f,e.target.value)}
                        placeholder="0"
                        className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
          الأسعار صفر تعني مجانية أو تُسعَّر يدوياً · التغييرات تؤثر فوراً على طلبات شهادات المشتركين
        </div>
      </div>
    </div>
  );
};

// ─── Currencies Section ───────────────────────────────────────────────────
const CurrenciesSection: React.FC<{ data: ListItem[]; mutate: (v: ListItem[]) => void; c: typeof COLOR[string] }> = ({ data, mutate, c }) => {
  const items = data || [];
  const toggleActive = (idx: number) => mutate(items.map((it,i) => i===idx ? {...it, is_active:!it.is_active} : it));
  const setDefault   = (idx: number) => mutate(items.map((it,i) => ({...it, is_default: i===idx})));
  const updateF = (idx: number, field: string, value: string) => mutate(items.map((it,i) => i===idx ? {...it,[field]:value} : it));
  const add    = () => mutate([...items, { key:'', label:'', symbol:'', is_active:true, is_default:false }]);
  const remove = (idx: number) => mutate(items.filter((_,i) => i!==idx));
  return (
    <div className="space-y-2">
      <div className="bg-gray-50 rounded-xl px-4 py-2 grid grid-cols-4 text-xs font-bold text-gray-400 gap-2">
        <span>الكود</span><span>الرمز</span><span>الاسم</span><span className="text-center">الإجراءات</span>
      </div>
      {items.map((item,idx) => (
        <div key={idx} className={`bg-white border rounded-xl flex items-center gap-2 px-4 py-3 transition ${item.is_active?'border-gray-200':'border-gray-100 opacity-60'}`}>
          <input value={item.key||''} onChange={e=>updateF(idx,'key',e.target.value.toUpperCase())}
            className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-indigo-400" placeholder="EGP"/>
          <input value={item.symbol||''} onChange={e=>updateF(idx,'symbol',e.target.value)}
            className="w-14 text-center border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" placeholder="ج.م"/>
          <input value={item.label||''} onChange={e=>updateF(idx,'label',e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400" placeholder="جنيه مصري"/>
          <button onClick={()=>setDefault(idx)} title="اختر كافتراضي"
            className={`px-2 py-1 rounded-lg text-xs font-bold border transition ${item.is_default?'bg-amber-100 text-amber-700 border-amber-300':'bg-gray-50 text-gray-400 border-gray-200 hover:border-amber-300'}`}>
            افتراضي
          </button>
          <button onClick={()=>toggleActive(idx)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
            {item.is_active ? <Eye size={14} className="text-green-500"/> : <EyeOff size={14} className="text-gray-400"/>}
          </button>
          <button onClick={()=>remove(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition">
            <Trash2 size={14}/>
          </button>
        </div>
      ))}
      <button onClick={add} className={`flex items-center gap-1.5 px-3 py-2 ${c.bg} ${c.text} border ${c.border} rounded-xl text-xs font-bold hover:opacity-80 transition w-full justify-center`}>
        <Plus size={13}/> إضافة عملة
      </button>
    </div>
  );
};

// ─── Countries Section ────────────────────────────────────────────────────
const CountriesSection: React.FC<{ data: ListItem[]; mutate: (v: ListItem[]) => void; c: typeof COLOR[string] }> = ({ data, mutate, c }) => {
  const items = data || [];
  const toggle = (idx: number) => mutate(items.map((it,i) => i===idx ? {...it, is_active:!it.is_active} : it));
  const updateF = (idx: number, field: string, value: string) => mutate(items.map((it,i) => i===idx ? {...it,[field]:value} : it));
  const add    = () => mutate([...items, { key:'', code:'', label:'', flag:'🌍', is_active:true }]);
  const remove = (idx: number) => mutate(items.filter((_,i) => i!==idx));
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((item,idx) => (
          <div key={idx} className={`bg-white border rounded-xl flex items-center gap-2 px-3 py-2.5 transition ${item.is_active?'border-gray-200':'border-gray-100 opacity-55'}`}>
            <input value={item.flag||'🌍'} onChange={e=>updateF(idx,'flag',e.target.value)}
              className="w-9 text-center border border-gray-200 rounded-lg px-1 py-1 text-sm focus:outline-none bg-gray-50" placeholder="🌍"/>
            <input value={item.code||item.key||''} onChange={e=>updateF(idx,'code',e.target.value.toUpperCase())}
              className="w-12 border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-mono uppercase focus:outline-none" placeholder="EG"/>
            <input value={item.label||''} onChange={e=>updateF(idx,'label',e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none" placeholder="مصر"/>
            <button onClick={()=>toggle(idx)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
              {item.is_active ? <Eye size={14} className="text-green-500"/> : <EyeOff size={14} className="text-gray-400"/>}
            </button>
            <button onClick={()=>remove(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 transition">
              <Trash2 size={13}/>
            </button>
          </div>
        ))}
      </div>
      <button onClick={add} className={`flex items-center gap-1.5 px-3 py-2 ${c.bg} ${c.text} border ${c.border} rounded-xl text-xs font-bold hover:opacity-80 transition w-full justify-center`}>
        <Plus size={13}/> إضافة دولة
      </button>
    </div>
  );
};

// ─── Generic List Section ─────────────────────────────────────────────────
const SHOW_ICON_FOR = ['payment_methods', 'lead_sources', 'branches'];

const ListSection: React.FC<{ data: ListItem[]; mutate: (v: ListItem[]) => void; c: typeof COLOR[string]; sectionKey: string }> = ({ data, mutate, c, sectionKey }) => {
  const items = data || [];
  const [newLabel, setNewLabel] = useState('');
  const [newIcon,  setNewIcon]  = useState('');
  const showIcon = SHOW_ICON_FOR.includes(sectionKey);

  const toggle      = (idx: number) => mutate(items.map((it,i) => i===idx ? {...it, is_active:!it.is_active} : it));
  const updateLabel = (idx: number, label: string) => mutate(items.map((it,i) => i===idx ? {...it, label} : it));
  const updateIcon  = (idx: number, icon: string)  => mutate(items.map((it,i) => i===idx ? {...it, icon}  : it));
  const remove      = (idx: number) => mutate(items.filter((_,i) => i!==idx));
  const add = () => {
    if (!newLabel.trim()) return;
    const key = `${Date.now()}`;
    mutate([...items, { key, label: newLabel.trim(), icon: newIcon.trim() || '', is_active: true }]);
    setNewLabel(''); setNewIcon('');
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, idx) => (
        <div key={idx} className={`bg-white border rounded-xl flex items-center gap-3 px-4 py-3 transition ${item.is_active?'border-gray-200':'border-gray-100 opacity-60'}`}>
          {showIcon && (
            <input value={item.icon||''} onChange={e=>updateIcon(idx,e.target.value)}
              className="w-10 text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none bg-gray-50" placeholder="🏢"/>
          )}
          <input value={item.label} onChange={e=>updateLabel(idx,e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"/>
          <button onClick={()=>toggle(idx)} className="p-1.5 rounded-lg hover:bg-gray-100 transition" title={item.is_active?'إيقاف':'تفعيل'}>
            {item.is_active ? <CheckCircle size={15} className="text-green-500"/> : <EyeOff size={15} className="text-gray-300"/>}
          </button>
          <button onClick={()=>remove(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition">
            <Trash2 size={14}/>
          </button>
        </div>
      ))}

      {/* Add row */}
      <div className={`${c.bg} border ${c.border} rounded-xl flex items-center gap-2 px-4 py-3`}>
        {showIcon && (
          <input value={newIcon} onChange={e=>setNewIcon(e.target.value)}
            className="w-10 text-center border border-gray-200 rounded-lg px-1 py-1.5 text-sm focus:outline-none bg-white" placeholder="🆕"/>
        )}
        <input value={newLabel} onChange={e=>setNewLabel(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()}
          placeholder="أضف عنصر جديد..." className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"/>
        <button onClick={add} disabled={!newLabel.trim()}
          className={`flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg transition border ${newLabel.trim() ? `${c.text} bg-white ${c.border} hover:opacity-80` : 'text-gray-300 bg-white border-gray-100 cursor-not-allowed'}`}>
          <Plus size={13}/> إضافة
        </button>
      </div>
      <p className="text-xs text-gray-400 px-1">{items.filter(i=>i.is_active).length} نشط / {items.length} إجمالي</p>
    </div>
  );
};

// ─── 2FA Security Section ──────────────────────────────────────────────────
const Security2FASection: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const [status, setStatus]         = useState<'loading' | 'enabled' | 'disabled'>('loading');
  const [step, setStep]             = useState<'idle' | 'setup' | 'enable' | 'disable'>('idle');
  const [qrDataUrl, setQrDataUrl]   = useState('');
  const [secret, setSecret]         = useState('');
  const [token, setToken]           = useState('');
  const [working, setWorking]       = useState(false);

  useEffect(() => {
    mysqlAuth.get2faStatus().then(r => setStatus(r.enabled ? 'enabled' : 'disabled')).catch(() => setStatus('disabled'));
  }, []);

  const startSetup = async () => {
    setWorking(true);
    try {
      const res = await mysqlAuth.setup2fa();
      setQrDataUrl(res.qrDataUrl);
      setSecret(res.secret);
      setStep('setup');
    } catch { notify('error', 'حدث خطأ في توليد رمز الإعداد'); }
    finally { setWorking(false); }
  };

  const doEnable = async () => {
    if (token.length !== 6) return;
    setWorking(true);
    try {
      await mysqlAuth.enable2fa(token);
      setStatus('enabled');
      setStep('idle');
      setToken('');
      notify('success', 'تم تفعيل المصادقة الثنائية بنجاح ✅');
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'الرمز غير صحيح');
    } finally { setWorking(false); }
  };

  const doDisable = async () => {
    setWorking(true);
    try {
      await mysqlAuth.disable2fa(token || undefined);
      setStatus('disabled');
      setStep('idle');
      setToken('');
      notify('success', 'تم تعطيل المصادقة الثنائية');
    } catch (e: unknown) {
      notify('error', e instanceof Error ? e.message : 'الرمز غير صحيح');
    } finally { setWorking(false); }
  };

  if (status === 'loading') return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400" size={28}/></div>;

  return (
    <div className="space-y-5 max-w-lg" dir="rtl">
      <div className={`rounded-2xl p-5 border flex items-start gap-4 ${status === 'enabled' ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
        <Shield size={28} className={status === 'enabled' ? 'text-emerald-600' : 'text-gray-400'} />
        <div>
          <p className="font-bold text-gray-800">{status === 'enabled' ? '🔒 المصادقة الثنائية مفعّلة' : 'المصادقة الثنائية غير مفعّلة'}</p>
          <p className="text-xs text-gray-500 mt-1">{status === 'enabled' ? 'حسابك محمي برمز TOTP — كل تسجيل دخول يتطلب رمز من تطبيق المصادقة.' : 'فعّل المصادقة الثنائية لحماية حسابك.'}</p>
        </div>
      </div>

      {step === 'idle' && (
        <div className="flex gap-3">
          {status === 'disabled' && (
            <button onClick={startSetup} disabled={working}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50">
              {working ? <Loader2 size={14} className="animate-spin"/> : <Shield size={14}/>} تفعيل المصادقة الثنائية
            </button>
          )}
          {status === 'enabled' && (
            <button onClick={() => setStep('disable')} disabled={working}
              className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-bold hover:bg-red-100 transition">
              تعطيل المصادقة الثنائية
            </button>
          )}
        </div>
      )}

      {step === 'setup' && qrDataUrl && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
          <h4 className="font-bold text-gray-700">خطوات الإعداد</h4>
          <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
            <li>حمّل تطبيق Google Authenticator أو Authy على هاتفك</li>
            <li>امسح رمز QR التالي:</li>
          </ol>
          <div className="flex justify-center">
            <img src={qrDataUrl} alt="QR Code" className="w-44 h-44 rounded-xl border border-gray-200"/>
          </div>
          <p className="text-xs text-gray-400 text-center font-mono bg-gray-50 rounded-lg p-2 break-all">{secret}</p>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">أدخل رمز التحقق من التطبيق (6 أرقام)</label>
            <input type="text" value={token} onChange={e => setToken(e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="000000" maxLength={6}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center font-mono text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-400"/>
          </div>
          <div className="flex gap-2">
            <button onClick={doEnable} disabled={token.length !== 6 || working}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition disabled:opacity-40">
              {working ? <Loader2 size={14} className="animate-spin"/> : <CheckCircle size={14}/>} تفعيل
            </button>
            <button onClick={() => { setStep('idle'); setToken(''); }}
              className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition">
              إلغاء
            </button>
          </div>
        </div>
      )}

      {step === 'disable' && (
        <div className="bg-white border border-red-100 rounded-2xl p-5 space-y-4">
          <p className="text-sm text-gray-600">أدخل رمز التحقق الحالي من تطبيق المصادقة لتعطيل الحماية:</p>
          <input type="text" value={token} onChange={e => setToken(e.target.value.replace(/\D/g,'').slice(0,6))}
            placeholder="000000" maxLength={6}
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-center font-mono text-xl tracking-widest focus:outline-none focus:ring-2 focus:ring-red-400"/>
          <div className="flex gap-2">
            <button onClick={doDisable} disabled={working}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition disabled:opacity-40">
              {working ? <Loader2 size={14} className="animate-spin inline ml-1"/> : null} تعطيل
            </button>
            <button onClick={() => { setStep('idle'); setToken(''); }}
              className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition">
              إلغاء
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemSettingsTab;

// ─── Backup Management Section ────────────────────────────────────────────
const BackupSection: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const [backups, setBackups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/backups', { credentials: 'include' });
      const d = await r.json();
      setBackups(d.backups || []);
    } catch { notify('error', 'خطأ في تحميل النسخ'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  async function triggerBackup() {
    setTriggering(true);
    try {
      const r = await fetch('/api/admin/backup-now', { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (d.ok) { notify('success', 'تم تشغيل النسخ الاحتياطي'); await load(); }
      else notify('error', d.error || 'خطأ');
    } catch { notify('error', 'خطأ في الاتصال'); }
    finally { setTriggering(false); }
  }

  function download(filename: string) {
    const url = `/api/admin/backups/download/${encodeURIComponent(filename)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const fmtSize = (bytes: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-slate-700 to-slate-600 rounded-2xl p-5 text-white">
        <h3 className="font-bold text-lg flex items-center gap-2"><Database size={20} />النسخ الاحتياطية</h3>
        <p className="text-slate-300 text-sm mt-1">نسخ احتياطية تلقائية يومية + تنزيل يدوي للملفات</p>
      </div>

      <div className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl p-4">
        <div>
          <p className="text-sm font-bold text-gray-700">تشغيل نسخة احتياطية الآن</p>
          <p className="text-xs text-gray-400 mt-0.5">يُسجّل snapshot + يُشغّل cron النسخ التلقائي</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 border border-gray-200 px-3 py-2 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
            <RefreshCw size={14} />تحديث
          </button>
          <button onClick={triggerBackup} disabled={triggering}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50">
            {triggering ? <Loader2 size={15} className="animate-spin" /> : <HardDrive size={15} />}
            نسخ الآن
          </button>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <h4 className="font-bold text-gray-700">سجل النسخ الاحتياطية</h4>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400"><Loader2 size={24} className="animate-spin mx-auto" /></div>
        ) : backups.length === 0 ? (
          <div className="p-8 text-center text-gray-400">لا توجد نسخ احتياطية مسجلة بعد</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">اسم الملف</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الحجم</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">الحالة</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-gray-500">التاريخ</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-gray-500">تنزيل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {backups.map((b: any, i: number) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{b.filename || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtSize(b.size_bytes)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-bold ${b.status === 'success' ? 'bg-green-100 text-green-700' : b.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                      {b.status === 'success' ? '✅ نجح' : b.status === 'failed' ? '❌ فشل' : b.status || '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{b.created_at ? new Date(b.created_at).toLocaleString('ar-EG') : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {b.fileExists && b.filename ? (
                      <button onClick={() => download(b.filename)}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 bg-blue-50 px-2 py-1 rounded-lg hover:bg-blue-100">
                        <Download size={12} />تنزيل
                      </button>
                    ) : (
                      <span className="text-xs text-gray-300">غير متاح</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};


