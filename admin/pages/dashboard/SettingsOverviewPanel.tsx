/**
 * SettingsOverviewPanel — SaaS-style control-center landing for the unified
 * Settings page. Read-only summary: institute identity, enabled modules, roles,
 * and quick jump buttons into the relevant sections.
 */
import React from 'react';
import { Building2, Sliders, Lock, CreditCard, ArrowLeftRight, CheckCircle2, Circle } from 'lucide-react';
import { useSiteData } from '../../context/SiteDataContext';
import { FEATURE_DEFS, parseFeatures } from './featureFlags';
import { ROLE_LABELS, FULL_ACCESS_ROLES, type RoleKey } from '../../constants/permissions';

type GoTo = (section: string) => void;

export default function SettingsOverviewPanel({ goTo }: { goTo: GoTo }) {
  const { content } = useSiteData();
  const features = parseFeatures(content);
  const enabled = FEATURE_DEFS.filter(f => features[f.key] !== false).length;
  const total = FEATURE_DEFS.length;

  const name = content['institute.name'] || 'مهاد نفسي';
  const logo = content['institute.logo'] || '';
  const brand = content['brand.primary'] || '#dc2626';

  const editableRoles = (Object.keys(ROLE_LABELS) as RoleKey[]).filter(r => !FULL_ACCESS_ROLES.includes(r));
  let overrides: Record<string, unknown> = {};
  try { overrides = content['rbac.roleOverrides'] ? JSON.parse(content['rbac.roleOverrides']) : {}; } catch { /* ignore */ }
  const customRoles = Object.keys(overrides).length;

  const methods = (content['finance.payment_methods'] || 'كاش||فودافون كاش||انستاباي||تحويل بنكي').split('||').filter(Boolean);
  const usd = content['exchange.usd_to_egp'] || '—';

  const stat = (label: string, value: React.ReactNode, sub: string, icon: React.ReactNode, section: string, color: string) => (
    <button onClick={() => goTo(section)} className="text-right bg-white border border-gray-200 rounded-2xl p-4 hover:shadow-md hover:border-gray-300 transition group">
      <div className="flex items-center justify-between mb-2">
        <div className={`w-9 h-9 rounded-xl grid place-items-center ${color}`}>{icon}</div>
        <span className="text-[11px] text-gray-400 group-hover:text-gray-600">تعديل ←</span>
      </div>
      <p className="text-2xl font-extrabold text-gray-900 leading-none">{value}</p>
      <p className="text-xs font-bold text-gray-700 mt-1">{label}</p>
      <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>
    </button>
  );

  return (
    <div className="space-y-4" dir="rtl">
      {/* Identity hero */}
      <div className="rounded-2xl p-5 text-brand-fg flex items-center gap-4" style={{ background: 'linear-gradient(135deg, var(--brand-600), var(--brand-800))' }}>
        <div className="w-16 h-16 rounded-2xl bg-white/15 backdrop-blur grid place-items-center overflow-hidden flex-shrink-0">
          {logo ? <img src={logo} alt="logo" className="w-full h-full object-contain p-1" /> : <Building2 size={28} />}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold truncate">{name}</h2>
          <p className="text-sm opacity-80 flex items-center gap-2 mt-1">
            <span className="inline-block w-3 h-3 rounded-full border border-white/40" style={{ backgroundColor: brand }} />
            مركز التحكم بالنظام · {enabled}/{total} وحدة مُفعّلة
          </p>
        </div>
        <button onClick={() => goTo('identity')} className="mr-auto px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-sm font-bold transition flex-shrink-0">
          تخصيص الهوية
        </button>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stat('الوحدات المُفعّلة', `${enabled}/${total}`, 'تشغيل/إيقاف أقسام النظام', <Sliders size={18} className="text-brand-fg" />, 'features', 'bg-cyan-500')}
        {stat('الأدوار المُخصّصة', customRoles, `${editableRoles.length} دور قابل للتعديل`, <Lock size={18} className="text-white" />, 'permissions', 'bg-rose-500')}
        {stat('طرق الدفع', methods.length, methods.slice(0, 3).join('، '), <CreditCard size={18} className="text-white" />, 'identity', 'bg-emerald-500')}
        {stat('سعر الدولار', usd, 'سعر الصرف → ج.م', <ArrowLeftRight size={18} className="text-white" />, 'identity', 'bg-amber-500')}
      </div>

      {/* Modules checklist */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-extrabold text-gray-800 text-sm">حالة الوحدات</h3>
          <button onClick={() => goTo('features')} className="text-xs font-bold text-brand-600 hover:text-brand-700">إدارة الميزات ←</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {FEATURE_DEFS.map(f => {
            const on = features[f.key] !== false;
            return (
              <div key={f.key} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${on ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-400'}`}>
                {on ? <CheckCircle2 size={15} className="flex-shrink-0" /> : <Circle size={15} className="flex-shrink-0" />}
                <span className="font-bold truncate">{f.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
