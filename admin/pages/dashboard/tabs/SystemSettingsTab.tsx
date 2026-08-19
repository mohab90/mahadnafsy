import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Save, RotateCcw, Loader2, CheckCircle,
  Shield, Database,
  Download, RefreshCw, HardDrive, Globe, Copy, Trash2,
} from 'lucide-react';
import { mysqlAuth } from '../../../lib/mysqlapi';
import {
  buildContentPatch,
  CERT_TYPES,
  COLOR,
  parseContentSections,
  SECTIONS,
  type CertItem,
  type ExchangeRates,
  type Financial,
  type General,
  type ListItem,
  type SectionData,
  type SectionKey,
} from './systemSettingsSchema';
import { Card, Field, TextInput } from './systemSettingsUi';
import { CountriesSection, CurrenciesSection, ListSection } from './systemSettingsListSections';
import { FinancialSection, GeneralSection } from './systemSettingsCoreSections';
import SaasSetupWizard from './SaasSetupWizard';
import { GrowthOpsSection } from './GrowthOpsSection';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }
type EditableSectionData = Record<string, unknown>;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error || '');

function adminHeaders(json = false): HeadersInit {
  const token = localStorage.getItem('mahad-token');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// ─── Main Component ───────────────────────────────────────────────────────
const SystemSettingsTab: React.FC<Props> = ({ notify }) => {
  const [active, setActive]       = useState<SectionKey>('general');
  const [data, setData]           = useState<Partial<Record<SectionKey, SectionData>>>({});
  const [dirty, setDirty]         = useState<Set<SectionKey>>(new Set());
  const [saving, setSaving]       = useState<Set<SectionKey>>(new Set());
  const [globalLoading, setGlobalLoading] = useState(true);

  // Load both sys-config and content on mount
  useEffect(() => {
    (async () => {
      try {
        const [cfgRes, contentRes] = await Promise.all([
          fetch('/api/admin/sys-config', { credentials: 'include', headers: adminHeaders() }),
          fetch('/api/admin/content',    { credentials: 'include', headers: adminHeaders() }),
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
  }, [notify]);

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
          headers: adminHeaders(true),
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(await res.text());
      } else {
        const res = await fetch(`/api/admin/sys-config/${key}`, {
          method: 'PUT', credentials: 'include',
          headers: adminHeaders(true),
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setDirty(d => { const n = new Set(d); n.delete(key); return n; });
      notify('success', `✅ تم حفظ "${section.label}"`);
    } catch (e: unknown) {
      notify('error', 'خطأ في الحفظ: ' + errorMessage(e));
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
        const res = await fetch('/api/admin/content', { credentials: 'include', headers: adminHeaders() });
        const raw = await res.json();
        const contentSections = parseContentSections(raw);
        setData(d => ({ ...d, [key]: contentSections[key as keyof typeof contentSections] }));
      } else {
        const res = await fetch(`/api/admin/sys-config/${key}/reset`, { method: 'POST', credentials: 'include', headers: adminHeaders() });
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
  const mutateField = useCallback((key: SectionKey, field: string, value: unknown) => {
    setData(d => ({ ...d, [key]: { ...(d[key] as unknown as EditableSectionData), [field]: value } as unknown as SectionData }));
    setDirty(d => new Set([...d, key]));
  }, []);

  const activeSec = SECTIONS.find(s => s.key === active)!;
  const c = COLOR[activeSec.color];

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
          <div className="px-4 py-3 bg-gradient-to-l from-indigo-600 to-violet-600 text-white">
            <h2 className="font-bold text-sm flex items-center gap-2"><Settings size={14}/> إعدادات الإدارة</h2>
          </div>
          <nav className="p-2 space-y-0.5">
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const isActive = active === sec.key;
              const isDirty  = dirty.has(sec.key as SectionKey);
              return (
                <button key={sec.key} onClick={() => setActive(sec.key as SectionKey)}
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
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <SaasSetupWizard data={data} setActive={setActive} />

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
            {active !== 'security' && active !== 'backups' && active !== 'growth' && (<>
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
        {active === 'general'            && <>
          <GeneralSection data={data.general as General} mutateField={(f,v) => mutateField('general', f, v)}/>
          <TenantDomainSection notify={notify} />
        </>}
        {active === 'financial'          && <FinancialSection   data={data.financial as Financial}       mutateField={(f,v) => mutateField('financial', f, v)}/>}
        {active === 'exchange_rates'     && <ExchangeRatesSection data={data.exchange_rates as ExchangeRates} mutateField={(f,v) => mutateField('exchange_rates', f, v)}/>}
        {active === 'cert_pricing'       && <CertPricingSection  data={data.cert_pricing as CertItem[]}  mutate={v => mutate('cert_pricing', v)} c={c}/>}
        {active === 'currencies'         && <CurrenciesSection   data={data.currencies as ListItem[]}    mutate={v => mutate('currencies', v)} c={c}/>}
        {active === 'countries'          && <CountriesSection    data={data.countries as ListItem[]}     mutate={v => mutate('countries', v)} c={c}/>}
        {active === 'security'           && <Security2FASection  notify={notify} />}
        {active === 'growth'             && <GrowthOpsSection    notify={notify} />}
        {active === 'backups'             && <BackupSection       notify={notify} />}
        {!['general','financial','exchange_rates','cert_pricing','currencies','countries','security','growth','backups'].includes(active) && (
          <ListSection data={data[active] as ListItem[]} mutate={v => mutate(active, v)} c={c} sectionKey={active}/>
        )}
      </main>
    </div>
  );
};

type TenantDomain = {
  domain: string;
  status: 'pending' | 'verified';
  record_name: string;
  record_value?: string;
  verified_at?: string | null;
};

const TenantDomainSection: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const [domain, setDomain] = useState('');
  const [current, setCurrent] = useState<TenantDomain | null>(null);
  const [busy, setBusy] = useState<'save' | 'verify' | 'delete' | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/tenant-domain', {
      credentials: 'include',
      headers: adminHeaders(),
    });
    if (!response.ok) return;
    const value = await response.json();
    setCurrent(value);
    if (value?.domain) setDomain(value.domain);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const requestVerification = async () => {
    if (!domain.trim()) return;
    setBusy('save');
    try {
      const response = await fetch('/api/admin/tenant-domain', {
        method: 'PUT', credentials: 'include', headers: adminHeaders(true),
        body: JSON.stringify({ domain: domain.trim() }),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || 'فشل حفظ الدومين');
      setCurrent(value);
      notify('success', 'تم إنشاء سجل التحقق. أضفه في DNS ثم اضغط تحقق');
    } catch (error) {
      notify('error', errorMessage(error));
    } finally { setBusy(null); }
  };

  const verify = async () => {
    setBusy('verify');
    try {
      const response = await fetch('/api/admin/tenant-domain/verify', {
        method: 'POST', credentials: 'include', headers: adminHeaders(true),
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(value.error || 'لم يتم العثور على سجل DNS');
      await load();
      notify('success', 'تم إثبات ملكية الدومين وربطه بالمؤسسة');
    } catch (error) {
      notify('error', errorMessage(error));
    } finally { setBusy(null); }
  };

  const remove = async () => {
    if (!confirm('هل تريد إلغاء ربط الدومين المخصص؟')) return;
    setBusy('delete');
    try {
      const response = await fetch('/api/admin/tenant-domain', {
        method: 'DELETE', credentials: 'include', headers: adminHeaders(),
      });
      if (!response.ok) throw new Error('فشل إلغاء الربط');
      setCurrent(null);
      setDomain('');
      notify('success', 'تم إلغاء ربط الدومين');
    } catch (error) {
      notify('error', errorMessage(error));
    } finally { setBusy(null); }
  };

  const copy = (value: string) => navigator.clipboard.writeText(value)
    .then(() => notify('info', 'تم النسخ'))
    .catch(() => notify('error', 'تعذر النسخ'));

  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Globe size={18} className="text-indigo-600" />
        <div>
          <h3 className="font-bold text-gray-800">الدومين المخصص</h3>
          <p className="text-xs text-gray-500">لا يُستخدم في توجيه العملاء أو هوية البريد إلا بعد إثبات الملكية من DNS.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={domain} onChange={event => setDomain(event.target.value)}
          placeholder="academy.example.com" dir="ltr"
          className="flex-1 min-w-[220px] border border-gray-200 rounded-xl px-3 py-2 text-sm" />
        <button onClick={requestVerification} disabled={busy !== null}
          className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
          {busy === 'save' ? 'جاري الحفظ...' : 'إنشاء سجل التحقق'}
        </button>
      </div>
      {current && (
        <div className={`rounded-xl border p-4 space-y-3 ${current.status === 'verified' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-sm">{current.domain}</span>
            <span className={`text-xs font-bold ${current.status === 'verified' ? 'text-emerald-700' : 'text-amber-700'}`}>
              {current.status === 'verified' ? '✅ تم التحقق' : '⏳ في انتظار DNS'}
            </span>
          </div>
          {current.status === 'pending' && (
            <>
              <p className="text-xs text-gray-600">أضف TXT record بالقيم التالية عند مزود الدومين:</p>
              {[['Name', current.record_name], ['Value', current.record_value]].map(([label, value]) => value && (
                <div key={label} className="flex items-center gap-2 bg-white rounded-lg border px-3 py-2" dir="ltr">
                  <span className="text-[10px] text-gray-400 w-10">{label}</span>
                  <code className="text-xs flex-1 break-all">{value}</code>
                  <button onClick={() => copy(value)} className="text-indigo-600"><Copy size={13}/></button>
                </div>
              ))}
              {!current.record_value && <p className="text-xs text-amber-700">أعد إنشاء سجل التحقق لإظهار قيمة TXT جديدة.</p>}
              <button onClick={verify} disabled={busy !== null}
                className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                {busy === 'verify' ? 'جاري فحص DNS...' : 'تحقق الآن'}
              </button>
            </>
          )}
          <button onClick={remove} disabled={busy !== null}
            className="flex items-center gap-1 text-xs text-red-600">
            <Trash2 size={12}/> إلغاء الربط
          </button>
        </div>
      )}
    </div>
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
const CertPricingSection: React.FC<{ data: CertItem[]; mutate: (v: CertItem[]) => void; c: typeof COLOR[string] }> = ({ data, mutate }) => {
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
      const result = await mysqlAuth.enable2fa(token);
      localStorage.setItem('mahad-token', result.token);
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
      const result = await mysqlAuth.disable2fa(token || undefined);
      localStorage.setItem('mahad-token', result.token);
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
      const r = await fetch('/api/admin/backups', { credentials: 'include', headers: adminHeaders() });
      const d = await r.json();
      setBackups(d.backups || []);
    } catch { notify('error', 'خطأ في تحميل النسخ'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  async function triggerBackup() {
    setTriggering(true);
    try {
      const r = await fetch('/api/admin/backup-now', { method: 'POST', credentials: 'include', headers: adminHeaders() });
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
                  <td className="px-4 py-3 text-gray-400 text-xs">{b.created_at ? new Date(b.created_at).toLocaleString('ar-EG-u-nu-latn') : '—'}</td>
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


