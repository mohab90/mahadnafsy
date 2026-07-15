import {
  ArrowLeftRight,
  Award,
  Building2,
  Clock,
  CreditCard,
  Database,
  DollarSign,
  Globe,
  Hash,
  MapPin,
  Rocket,
  Settings,
  Shield,
  Tag,
  Users,
} from 'lucide-react';

export const SECTIONS = [
  { key: 'general',            label: 'الإعدادات العامة',    icon: Settings,        color: 'indigo',  source: 'syscfg'  },
  { key: 'branches',           label: 'الفروع',              icon: Building2,       color: 'blue',    source: 'content' },
  { key: 'payment_methods',    label: 'وسائل الدفع',         icon: CreditCard,      color: 'green',   source: 'content' },
  { key: 'exchange_rates',     label: 'أسعار الصرف',         icon: ArrowLeftRight,  color: 'amber',   source: 'content' },
  { key: 'cert_pricing',       label: 'تسعير الشهادات',      icon: Award,           color: 'purple',  source: 'content' },
  { key: 'financial',          label: 'الإعدادات المالية',   icon: Hash,            color: 'emerald', source: 'syscfg'  },
  { key: 'session_types',      label: 'أنواع الجلسات',       icon: Clock,           color: 'sky',     source: 'syscfg'  },
  { key: 'lead_sources',       label: 'مصادر الليدات',       icon: Tag,             color: 'pink',    source: 'syscfg'  },
  { key: 'expense_categories', label: 'فئات المصاريف',       icon: DollarSign,      color: 'orange',  source: 'syscfg'  },
  { key: 'nationalities',      label: 'الجنسيات',            icon: Globe,           color: 'teal',    source: 'syscfg'  },
  { key: 'staff_roles',        label: 'أدوار الموظفين',      icon: Users,           color: 'violet',  source: 'syscfg'  },
  { key: 'countries',          label: 'الدول',               icon: MapPin,          color: 'rose',    source: 'syscfg'  },
  { key: 'currencies',         label: 'العملات',             icon: DollarSign,      color: 'yellow',  source: 'syscfg'  },
  { key: 'security',           label: 'الأمان (2FA)',        icon: Shield,          color: 'rose',    source: 'security'},
  { key: 'growth',             label: 'النمو والأتمتة',       icon: Rocket,          color: 'indigo',  source: 'growth'  },
  { key: 'backups',            label: 'النسخ الاحتياطية',  icon: Database,        color: 'slate',   source: 'backups' },
] as const;

export type SectionKey = typeof SECTIONS[number]['key'];

export interface ListItem { key: string; label: string; is_active: boolean; icon?: string; symbol?: string; code?: string; flag?: string; is_default?: boolean; }
export interface CertItem { type: string; label: string; egyptianEGP: number; residentEGP: number; residentSAR: number; foreignUSD: number; }
export interface ExchangeRates { sar_to_egp: number; usd_to_egp: number; }
export interface General {
  institute_name: string;
  institute_name_en: string;
  website_url: string;
  support_email: string;
  support_phone: string;
  support_whatsapp?: string;
  support_address?: string;
  brand_logo_url?: string;
  brand_favicon_url?: string;
  brand_primary_color?: string;
  brand_secondary_color?: string;
  brand_accent_color?: string;
  default_currency: string;
  default_timezone: string;
  working_days: string[];
}
export interface Financial { consultation_price: number; installment_down_pct: number; max_installment_months: number; default_lead_sla_hours: number; lead_auto_archive_days: number; vat_percent: number; invoice_prefix: string; session_duration_default: number; }
export type SectionData = ListItem[] | CertItem[] | General | Financial | ExchangeRates;

export const CERT_TYPES = [
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

export const COLOR: Record<string, { bg: string; text: string; border: string }> = {
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
};

export function parseContentSections(raw: Record<string, string>): Partial<Record<SectionKey, SectionData>> {
  let branches: ListItem[] = [];
  try {
    branches = JSON.parse(raw['institute.branches'] || '[]')
      .map((b: { id: string; label: string }) => ({ key: b.id, label: b.label, is_active: true }));
  } catch {}

  const pmStr = raw['finance.payment_methods'] || DEFAULT_PAYMENT_METHODS.join('||');
  const payment_methods: ListItem[] = pmStr.split('||').map((m: string, i: number) => ({
    key: `pm_${i}_${m.trim().slice(0,8)}`,
    label: m.trim(),
    is_active: true,
  })).filter(m => m.label);

  let cpMap: Record<string, { egyptianEGP?: number; residentEGP?: number; residentSAR?: number; foreignUSD?: number }> = {};
  try { cpMap = JSON.parse(raw['extra_cert_pricing'] || '{}'); } catch {}
  const cert_pricing: CertItem[] = CERT_TYPES.map(ct => ({
    type: ct.type, label: ct.label,
    egyptianEGP:  cpMap[ct.type]?.egyptianEGP  || 0,
    residentEGP:  cpMap[ct.type]?.residentEGP  || 0,
    residentSAR:  cpMap[ct.type]?.residentSAR  || 0,
    foreignUSD:   cpMap[ct.type]?.foreignUSD   || 0,
  }));

  const exchange_rates: ExchangeRates = {
    sar_to_egp: parseFloat(raw['exchange.sar_to_egp'] || '13') || 13,
    usd_to_egp: parseFloat(raw['exchange.usd_to_egp'] || '50') || 50,
  };

  return { branches, payment_methods, cert_pricing, exchange_rates };
}

export function buildContentPatch(key: SectionKey, value: SectionData): Record<string, string> {
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
