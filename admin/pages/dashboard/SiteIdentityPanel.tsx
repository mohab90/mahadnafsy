/**
 * SiteIdentityPanel — public-site identity, contact, payment methods, currency
 * rates and video-access rules. These all live in the site_config content blob
 * (keys consumed by the public site + payment forms), edited safely via
 * setContentValue (a partial PUT would wipe the whole blob). Rendered as the
 * "identity" section of the unified Settings page.
 */
import { useState } from 'react';
import { Building2, CreditCard, Save, Check, Plus, X, Palette } from 'lucide-react';
import { useSiteData } from '../../context/SiteDataContext';
import { BRAND_PRESETS, applyBrandTheme } from '../../lib/brandTheme';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const GENERAL_FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'institute.name', label: 'اسم المعهد/الشركة', placeholder: 'معهد مهاد للدراسات النفسية' },
  { key: 'institute.logo', label: 'رابط الشعار (Logo URL)', placeholder: 'https://...', type: 'url' },
  { key: 'footer.phone', label: 'هاتف التواصل', placeholder: '+20...', type: 'tel' },
  { key: 'footer.whatsapp', label: 'رقم الواتساب', placeholder: '+20...', type: 'tel' },
  { key: 'footer.address', label: 'العنوان', placeholder: 'القاهرة، مصر' },
  { key: 'vat_pct', label: 'نسبة الضريبة %', placeholder: '0', type: 'number' },
];

const PAYMENT_FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'exchange.usd_to_egp', label: 'سعر صرف الدولار → ج.م', placeholder: '50', type: 'number' },
  { key: 'exchange.sar_to_egp', label: 'سعر صرف الريال → ج.م', placeholder: '13', type: 'number' },
  { key: 'access.videos_per_payment', label: 'عدد الفيديوهات لكل دفعة', placeholder: '0', type: 'number' },
  { key: 'access.videos_on_deposit', label: 'فيديوهات عند الحجز (Deposit)', placeholder: '0', type: 'number' },
];

export default function SiteIdentityPanel({ notify }: { notify: NotifyFn }) {
  const { content, setContentValue } = useSiteData();
  const [tab, setTab] = useState<'general' | 'payments'>('general');
  const [general, setGeneral] = useState<Record<string, string>>(() =>
    Object.fromEntries(GENERAL_FIELDS.map(f => [f.key, content[f.key] || ''])));
  const [payments, setPayments] = useState<Record<string, string>>(() =>
    Object.fromEntries(PAYMENT_FIELDS.map(f => [f.key, content[f.key] || ''])));
  const [payMethods, setPayMethods] = useState<string[]>(() =>
    (content['finance.payment_methods'] || 'كاش||فودافون كاش||انستاباي||تحويل بنكي').split('||').map(s => s.trim()).filter(Boolean));
  const [brand, setBrand] = useState<string>(() => content['brand.primary'] || '#dc2626');
  const [newMethod, setNewMethod] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState('');

  const flash = (k: string) => { setSavedKey(k); setTimeout(() => setSavedKey(''), 1500); };

  const saveGeneral = () => {
    setSaving(true);
    try {
      Object.entries(general).forEach(([k, v]) => setContentValue(k, v));
      notify('success', 'تم حفظ الهوية والتواصل');
      flash('general');
    } catch (e) {
      notify('error', 'فشل الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setSaving(false); }
  };

  const savePayments = () => {
    setSaving(true);
    try {
      Object.entries(payments).forEach(([k, v]) => setContentValue(k, v));
      setContentValue('finance.payment_methods', payMethods.join('||'));
      notify('success', 'تم حفظ المدفوعات والعملات');
      flash('payments');
    } catch (e) {
      notify('error', 'فشل الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setSaving(false); }
  };

  const addMethod = () => {
    const m = newMethod.trim();
    if (m && !payMethods.includes(m)) { setPayMethods([...payMethods, m]); setNewMethod(''); }
  };

  // Live-preview the brand color without persisting (so dragging the picker repaints instantly).
  const previewBrand = (hex: string) => { setBrand(hex); applyBrandTheme({ ...content, 'brand.primary': hex }); };
  const saveBrand = () => {
    try {
      setContentValue('brand.primary', brand); // persists + applies app-wide
      notify('success', 'تم حفظ اللون الأساسي للنظام');
      flash('brand');
    } catch (e) {
      notify('error', 'فشل الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        <button onClick={() => setTab('general')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${tab === 'general' ? 'bg-slate-800 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Building2 size={15} /> الهوية والتواصل
        </button>
        <button onClick={() => setTab('payments')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition ${tab === 'payments' ? 'bg-slate-800 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <CreditCard size={15} /> المدفوعات والعملات
        </button>
      </div>

      {tab === 'general' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 max-w-2xl space-y-5">
          {/* Brand color — drives the whole admin theme (CSS-var palette) live */}
          <div className="border border-gray-100 rounded-2xl p-4 bg-gray-50/50">
            <div className="flex items-center gap-2 mb-3">
              <Palette size={16} className="text-brand-600" />
              <h3 className="text-sm font-extrabold text-gray-800">الهوية البصرية — اللون الأساسي</h3>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {BRAND_PRESETS.map(p => (
                <button key={p.value} type="button" title={p.label} aria-label={`اللون ${p.label}`}
                  aria-pressed={brand.toLowerCase() === p.value.toLowerCase()} onClick={() => previewBrand(p.value)}
                  className={`w-8 h-8 rounded-full border-2 transition ${brand.toLowerCase() === p.value.toLowerCase() ? 'border-gray-800 scale-110 shadow' : 'border-white shadow-sm hover:scale-105'}`}
                  style={{ backgroundColor: p.value }} />
              ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <input type="color" value={brand} onChange={e => previewBrand(e.target.value)}
                className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer bg-white" />
              <input type="text" value={brand} onChange={e => previewBrand(e.target.value)} dir="ltr"
                className="w-28 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:border-brand-400 focus:outline-none" />
              {/* Live chrome preview */}
              <div className="flex items-center gap-2 mr-auto">
                <span className="px-3 py-1.5 rounded-lg text-xs font-bold text-brand-fg" style={{ backgroundColor: 'var(--brand-600)' }}>زر أساسي</span>
                <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-brand-50 text-brand-700">شارة</span>
              </div>
              <button onClick={saveBrand}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-brand-fg rounded-xl text-sm font-bold transition">
                {savedKey === 'brand' ? <Check size={15} /> : <Save size={15} />} حفظ اللون
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">يُطبَّق فورياً على كامل لوحة الإدارة (الأزرار، التبويبات، الشارات). المفتاح: <code>brand.primary</code></p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {GENERAL_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">{f.label}</label>
                <input
                  type={f.type || 'text'} value={general[f.key]} placeholder={f.placeholder}
                  onChange={e => setGeneral(g => ({ ...g, [f.key]: e.target.value }))}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none"
                  dir={f.type === 'tel' || f.type === 'email' ? 'ltr' : 'rtl'} />
              </div>
            ))}
          </div>
          <button onClick={saveGeneral} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-slate-900 disabled:opacity-50 transition">
            {savedKey === 'general' ? <Check size={16} /> : <Save size={16} />} {saving ? 'جاري الحفظ...' : 'حفظ الهوية والتواصل'}
          </button>
        </div>
      )}

      {tab === 'payments' && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 max-w-2xl space-y-5">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-2">طرق الدفع المتاحة (تظهر في كل نماذج الدفع)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {payMethods.map(m => (
                <span key={m} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-3 py-1 text-sm font-bold">
                  {m}
                  <button onClick={() => setPayMethods(payMethods.filter(x => x !== m))} className="text-emerald-400 hover:text-red-500"><X size={13} /></button>
                </span>
              ))}
              {payMethods.length === 0 && <span className="text-xs text-gray-400">لا توجد طرق دفع — أضف واحدة على الأقل</span>}
            </div>
            <div className="flex gap-2">
              <input value={newMethod} onChange={e => setNewMethod(e.target.value)} placeholder="أضف طريقة دفع (مثل: محفظة إلكترونية)"
                onKeyDown={e => { if (e.key === 'Enter') addMethod(); }}
                className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:border-slate-400 focus:outline-none" />
              <button onClick={addMethod} className="flex items-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700"><Plus size={15} /> إضافة</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-gray-100 pt-4">
            {PAYMENT_FIELDS.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">{f.label}</label>
                <input type={f.type || 'text'} value={payments[f.key]} placeholder={f.placeholder}
                  onChange={e => setPayments(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-slate-400 focus:outline-none" dir="ltr" />
              </div>
            ))}
          </div>
          <button onClick={savePayments} disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-bold hover:bg-slate-900 disabled:opacity-50 transition">
            {savedKey === 'payments' ? <Check size={16} /> : <Save size={16} />} {saving ? 'جاري الحفظ...' : 'حفظ المدفوعات والعملات'}
          </button>
        </div>
      )}
    </div>
  );
}
