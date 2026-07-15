import React, { useEffect, useState } from 'react';
import { CreditCard, ShieldCheck } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { Card, Field, Input, NotifyFn, SaveBar, SectionHeader, Toggle, setNested } from './saasConnectorUi';

type PaymentGatewayConfig = {
  active_provider: 'manual' | 'paymob';
  mode: 'sandbox' | 'live';
  manual: { enabled: boolean; require_proof_review: boolean; supported_methods: string[] };
  paymob: Record<string, string | boolean>;
};

const DEFAULT_CONFIG: PaymentGatewayConfig = {
  active_provider: 'manual',
  mode: 'sandbox',
  manual: { enabled: true, require_proof_review: true, supported_methods: ['cash', 'instapay', 'bank_transfer', 'vodafone_cash'] },
  paymob: { enabled: false, merchant_id: '', api_key: '', secret_key: '', hmac_secret: '', integration_id_card: '', integration_id_wallet: '', iframe_id: '', webhook_url: '/api/webhooks/paymob', callback_url: '/success' },
};

export default function PaymentSettingsTab({ notify }: { notify: NotifyFn }) {
  const [config, setConfig] = useState<PaymentGatewayConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/admin/sys-config?section=payment_gateway', { credentials: 'include', headers: adminAuthHeaders() })
      .then(res => res.ok ? res.json() : DEFAULT_CONFIG)
      .then(data => setConfig({ ...DEFAULT_CONFIG, ...data, manual: { ...DEFAULT_CONFIG.manual, ...(data.manual || {}) }, paymob: { ...DEFAULT_CONFIG.paymob, ...(data.paymob || {}) } }))
      .catch(() => notify('error', 'فشل تحميل إعدادات الدفع'));
  }, [notify]);

  const update = (path: string, value: unknown) => {
    setConfig(prev => setNested(prev, path, value));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/sys-config/payment_gateway', { method: 'PUT', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify(config) });
      if (!res.ok) throw new Error(await res.text());
      setDirty(false);
      notify('success', 'تم حفظ إعدادات بوابة الدفع');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل حفظ إعدادات الدفع');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/admin/payment-gateway/test', { method: 'POST', credentials: 'include', headers: adminAuthHeaders() });
      const body = await res.json();
      notify(body.ok ? 'success' : 'info', body.message || (body.ok ? 'الربط جاهز' : 'الربط غير مكتمل'));
    } catch {
      notify('error', 'فشل اختبار بوابة الدفع');
    } finally {
      setTesting(false);
    }
  };

  const methodOptions = ['cash', 'instapay', 'bank_transfer', 'vodafone_cash'];
  const METHOD_LABEL_AR: Record<string, string> = { cash: 'نقدي', instapay: 'إنستاباي', bank_transfer: 'تحويل بنكي', vodafone_cash: 'فودافون كاش' };

  return (
    <div className="space-y-5" dir="rtl">
      <SectionHeader title="إعدادات بوابة الدفع" subtitle="ربط Manual وPaymob من داخل النظام مع إخفاء المفاتيح الحساسة واختبار الجاهزية." icon={<CreditCard size={22} />} tone="emerald" />
      <Card title="وضع التشغيل">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="المزود النشط">
            <select value={config.active_provider} onChange={event => update('active_provider', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <option value="manual">دفع يدوي</option>
              <option value="paymob">Paymob</option>
            </select>
          </Field>
          <Field label="البيئة">
            <select value={config.mode} onChange={event => update('mode', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <option value="sandbox">تجريبية</option>
              <option value="live">حية (فعلية)</option>
            </select>
          </Field>
          <div className="flex items-end justify-between rounded-xl border border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-600">تفعيل الدفع اليدوي</span>
            <Toggle checked={!!config.manual.enabled} onChange={value => update('manual.enabled', value)} />
          </div>
        </div>
      </Card>

      <Card title="طرق الدفع اليدوي" hint="طرق الدفع اليدوية التي تظهر للعميل أو تستخدم داخل فريق التحصيل.">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {methodOptions.map(method => (
            <label key={method} className="flex items-center gap-2 rounded-xl border border-gray-200 p-3 text-sm">
              <input
                type="checkbox"
                checked={config.manual.supported_methods.includes(method)}
                onChange={event => {
                  const next = event.target.checked
                    ? [...config.manual.supported_methods, method]
                    : config.manual.supported_methods.filter(item => item !== method);
                  update('manual.supported_methods', next);
                }}
              />
              {METHOD_LABEL_AR[method] || method}
            </label>
          ))}
        </div>
      </Card>

      <Card title="بيانات اعتماد Paymob" hint="القيم السرية لا تظهر مرة أخرى بعد الحفظ؛ اترك الحقل كما هو للحفاظ على السر القديم.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-600">تفعيل Paymob</span>
            <Toggle checked={!!config.paymob.enabled} onChange={value => update('paymob.enabled', value)} />
          </div>
          <Field label="معرّف التاجر (Merchant ID)"><Input value={String(config.paymob.merchant_id || '')} onChange={value => update('paymob.merchant_id', value)} /></Field>
          <Field label="مفتاح API"><Input type="password" value={String(config.paymob.api_key || '')} onChange={value => update('paymob.api_key', value)} /></Field>
          <Field label="المفتاح السري"><Input type="password" value={String(config.paymob.secret_key || '')} onChange={value => update('paymob.secret_key', value)} /></Field>
          <Field label="سر HMAC"><Input type="password" value={String(config.paymob.hmac_secret || '')} onChange={value => update('paymob.hmac_secret', value)} /></Field>
          <Field label="معرّف تكامل البطاقات"><Input value={String(config.paymob.integration_id_card || '')} onChange={value => update('paymob.integration_id_card', value)} /></Field>
          <Field label="معرّف تكامل المحفظة"><Input value={String(config.paymob.integration_id_wallet || '')} onChange={value => update('paymob.integration_id_wallet', value)} /></Field>
          <Field label="معرّف الإطار (Iframe ID)"><Input value={String(config.paymob.iframe_id || '')} onChange={value => update('paymob.iframe_id', value)} /></Field>
          <Field label="رابط Webhook"><Input value={String(config.paymob.webhook_url || '')} onChange={value => update('paymob.webhook_url', value)} /></Field>
        </div>
      </Card>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        <ShieldCheck size={16} className="ml-1 inline" /> الاختبار الحالي يتحقق من اكتمال الإعداد المحلي بدون إرسال مفاتيح للخارج.
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={save} onTest={test} testing={testing} />
    </div>
  );
}
