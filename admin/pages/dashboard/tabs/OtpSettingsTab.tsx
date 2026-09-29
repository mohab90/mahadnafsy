import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Mail, MessageCircle } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { Card, Field, Input, NotifyFn, SaveBar, SectionHeader, Toggle, setNested } from './saasConnectorUi';
import { promptDialog } from '../../../../shared/ui/promptDialog';

type OtpConfig = Record<string, any>;

// Only the SMS card here sends anything: queued SMS (lib/otpProvider.js
// sendSms) reads it. The sign-in and password-reset codes go out through the
// WhatsApp channel in «قنوات المراسلة» (api/lib/whatsappOtp.js, routes/auth.js)
// and email through «البريد الإلكتروني» (lib/email.js). This page used to offer
// a WhatsApp card — provider, instance, API token, template — and an SMTP card
// that nothing read, and a WhatsApp test that always went to Green-API. On 29
// September the owner entered the Wapilot token there, the test refused it,
// and the real channel was never touched.
const DEFAULT_CONFIG: OtpConfig = {
  sms: { enabled: false, provider: 'vonage', api_key: '', api_secret: '', sender_id: 'MAHAD' },
};

export default function OtpSettingsTab({ notify }: { notify: NotifyFn }) {
  const [config, setConfig] = useState<OtpConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch('/api/admin/sys-config?section=otp_provider', { credentials: 'include', headers: adminAuthHeaders() })
      .then(res => res.ok ? res.json() : DEFAULT_CONFIG)
      // A section with nothing saved answers `null`.
      .then((data: OtpConfig | null) => {
        const loaded = data && typeof data === 'object' ? data : {};
        setConfig({ ...loaded, sms: { ...DEFAULT_CONFIG.sms, ...(loaded.sms || {}) } });
      })
      .catch(() => notify('error', 'فشل تحميل إعدادات الرسائل النصية'));
    // notify is a stable useCallback in Dashboard; an unstable one would re-fire the fetch every render.
  }, [notify]);

  const update = (path: string, value: unknown) => {
    setConfig(prev => setNested(prev, path, value));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/sys-config/otp_provider', { method: 'PUT', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify(config) });
      if (!res.ok) throw new Error(await res.text());
      setDirty(false);
      notify('success', 'تم حفظ إعدادات الرسائل النصية');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const testSms = async () => {
    const to = await promptDialog('اختبار الرسائل النصية - أدخل رقم الهاتف، أو اتركه فارغاً للتجربة بدون إرسال فعلي') || '';
    setTesting(true);
    try {
      const res = await fetch('/api/admin/otp-provider/test', {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(true), body: JSON.stringify({ channel: 'sms', to }),
      });
      const body = await res.json();
      notify(body.ok ? 'success' : 'info', body.message || (body.ok ? 'نجح الاختبار' : 'الاختبار غير مكتمل'));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل الاختبار');
    } finally {
      setTesting(false);
    }
  };

  const place = 'flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3';
  const go = 'shrink-0 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white hover:bg-rose-700';
  return (
    <div className="space-y-5" dir="rtl">
      <SectionHeader title="أكواد الدخول والرسائل النصية" subtitle="أكواد الدخول بتتبعت منين، وإعدادات الرسائل النصية." icon={<KeyRound size={22} />} tone="rose" />
      <Card title="أكواد الدخول واسترجاع كلمة السر">
        <div className="space-y-3 text-sm">
          <div className={place}>
            <div className="flex items-start gap-3">
              <MessageCircle size={20} className="mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-bold text-gray-800">واتساب — الأول دايمًا</p>
                <p className="text-xs text-gray-500">بيتبعت من قناة الواتساب (Wapilot): اسم النسخة ومفتاح Wapilot واختبار الاتصال هناك.</p>
              </div>
            </div>
            <Link to="/dashboard/messaging_hub" className={go}>قنوات المراسلة</Link>
          </div>
          <div className={place}>
            <div className="flex items-start gap-3">
              <Mail size={20} className="mt-0.5 shrink-0 text-sky-600" />
              <div>
                <p className="font-bold text-gray-800">البريد — لو الواتساب ماوصلش أو الحساب ملوش رقم</p>
                <p className="text-xs text-gray-500">بيتبعت بإعدادات SMTP في «البريد الإلكتروني».</p>
              </div>
            </div>
            <Link to="/dashboard/email_settings" className={go}>البريد الإلكتروني</Link>
          </div>
        </div>
      </Card>
      <Card title="الرسائل النصية (SMS)">
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => { void testSms(); }} disabled={testing} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">
            {testing ? 'جارٍ الاختبار...' : 'اختبار الرسائل النصية'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3"><span className="text-sm font-semibold text-gray-600">تفعيل الرسائل النصية</span><Toggle checked={!!config.sms.enabled} onChange={value => update('sms.enabled', value)} /></div>
          <Field label="المزوّد"><Input value={config.sms.provider} onChange={value => update('sms.provider', value)} /></Field>
          <Field label="مفتاح API"><Input type="password" value={config.sms.api_key} onChange={value => update('sms.api_key', value)} /></Field>
          <Field label="سر API (API Secret)"><Input type="password" value={config.sms.api_secret} onChange={value => update('sms.api_secret', value)} /></Field>
          <Field label="معرّف المرسل"><Input value={config.sms.sender_id} onChange={value => update('sms.sender_id', value)} /></Field>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
