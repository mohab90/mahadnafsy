import React, { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { Card, Field, Input, NotifyFn, SaveBar, SectionHeader, Toggle, setNested } from './saasConnectorUi';

type OtpConfig = Record<string, any>;

const DEFAULT_CONFIG: OtpConfig = {
  preferred_channel: 'email',
  fallback_order: ['email', 'whatsapp', 'sms'],
  length: 6,
  expiry_minutes: 10,
  resend_cooldown_seconds: 60,
  max_attempts: 5,
  email: { enabled: true, provider: 'smtp', from_email: '', smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', secure: false },
  whatsapp: { enabled: false, provider: 'greenapi', instance_id: '', api_token: '', template: 'رمز التحقق الخاص بك هو {{code}}' },
  sms: { enabled: false, provider: 'vonage', api_key: '', api_secret: '', sender_id: 'MAHAD' },
};

export default function OtpSettingsTab({ notify }: { notify: NotifyFn }) {
  const [config, setConfig] = useState<OtpConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingChannel, setTestingChannel] = useState<string>('');

  useEffect(() => {
    fetch('/api/admin/sys-config?section=otp_provider', { credentials: 'include', headers: adminAuthHeaders() })
      .then(res => res.ok ? res.json() : DEFAULT_CONFIG)
      .then(data => setConfig({ ...DEFAULT_CONFIG, ...data, email: { ...DEFAULT_CONFIG.email, ...(data.email || {}) }, whatsapp: { ...DEFAULT_CONFIG.whatsapp, ...(data.whatsapp || {}) }, sms: { ...DEFAULT_CONFIG.sms, ...(data.sms || {}) } }))
      .catch(() => notify('error', 'فشل تحميل إعدادات OTP'));
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
      notify('success', 'تم حفظ إعدادات OTP');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل حفظ OTP');
    } finally {
      setSaving(false);
    }
  };

  const testChannel = async (channel: 'email' | 'whatsapp' | 'sms') => {
    const label = channel === 'email' ? 'email' : 'phone';
    const to = window.prompt(`Test ${channel} OTP - enter ${label}, or leave empty for dry-run`) || '';
    setTestingChannel(channel);
    try {
      const res = await fetch('/api/admin/otp-provider/test', {
        method: 'POST',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ channel, to }),
      });
      const body = await res.json();
      notify(body.ok ? 'success' : 'info', body.message || (body.ok ? 'OTP test passed' : 'OTP test incomplete'));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل اختبار OTP');
    } finally {
      setTestingChannel('');
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <SectionHeader title="إعدادات OTP والقنوات" subtitle="توحيد Email وWhatsApp وSMS مع fallback واضح وقواعد انتهاء ومحاولات." icon={<KeyRound size={22} />} tone="rose" />
      <Card title="OTP Rules">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <Field label="القناة الأساسية">
            <select value={config.preferred_channel} onChange={event => update('preferred_channel', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
            </select>
          </Field>
          <Field label="طول الرمز"><Input type="number" value={config.length} onChange={value => update('length', Number(value) || 6)} /></Field>
          <Field label="الانتهاء بالدقائق"><Input type="number" value={config.expiry_minutes} onChange={value => update('expiry_minutes', Number(value) || 10)} /></Field>
          <Field label="إعادة الإرسال بالثواني"><Input type="number" value={config.resend_cooldown_seconds} onChange={value => update('resend_cooldown_seconds', Number(value) || 60)} /></Field>
          <Field label="أقصى محاولات"><Input type="number" value={config.max_attempts} onChange={value => update('max_attempts', Number(value) || 5)} /></Field>
        </div>
      </Card>
      <Card title="Email OTP">
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => testChannel('email')} disabled={testingChannel === 'email'} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">
            {testingChannel === 'email' ? 'Testing...' : 'Test Email OTP'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3"><span className="text-sm font-semibold text-gray-600">Email enabled</span><Toggle checked={!!config.email.enabled} onChange={value => update('email.enabled', value)} /></div>
          <Field label="From Email"><Input value={config.email.from_email} onChange={value => update('email.from_email', value)} /></Field>
          <Field label="SMTP Host"><Input value={config.email.smtp_host} onChange={value => update('email.smtp_host', value)} /></Field>
          <Field label="SMTP Port"><Input type="number" value={config.email.smtp_port} onChange={value => update('email.smtp_port', Number(value) || 587)} /></Field>
          <Field label="SMTP User"><Input value={config.email.smtp_user} onChange={value => update('email.smtp_user', value)} /></Field>
          <Field label="SMTP Password"><Input type="password" value={config.email.smtp_password} onChange={value => update('email.smtp_password', value)} /></Field>
        </div>
      </Card>
      <Card title="WhatsApp OTP">
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => testChannel('whatsapp')} disabled={testingChannel === 'whatsapp'} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">
            {testingChannel === 'whatsapp' ? 'Testing...' : 'Test WhatsApp OTP'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3"><span className="text-sm font-semibold text-gray-600">WhatsApp enabled</span><Toggle checked={!!config.whatsapp.enabled} onChange={value => update('whatsapp.enabled', value)} /></div>
          <Field label="Provider"><Input value={config.whatsapp.provider} onChange={value => update('whatsapp.provider', value)} /></Field>
          <Field label="Instance ID"><Input value={config.whatsapp.instance_id} onChange={value => update('whatsapp.instance_id', value)} /></Field>
          <Field label="API Token"><Input type="password" value={config.whatsapp.api_token} onChange={value => update('whatsapp.api_token', value)} /></Field>
          <Field label="Template"><Input value={config.whatsapp.template} onChange={value => update('whatsapp.template', value)} /></Field>
        </div>
      </Card>
      <Card title="SMS fallback">
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => testChannel('sms')} disabled={testingChannel === 'sms'} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50">
            {testingChannel === 'sms' ? 'Testing...' : 'Test SMS OTP'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3"><span className="text-sm font-semibold text-gray-600">SMS enabled</span><Toggle checked={!!config.sms.enabled} onChange={value => update('sms.enabled', value)} /></div>
          <Field label="Provider"><Input value={config.sms.provider} onChange={value => update('sms.provider', value)} /></Field>
          <Field label="API Key"><Input type="password" value={config.sms.api_key} onChange={value => update('sms.api_key', value)} /></Field>
          <Field label="API Secret"><Input type="password" value={config.sms.api_secret} onChange={value => update('sms.api_secret', value)} /></Field>
          <Field label="Sender ID"><Input value={config.sms.sender_id} onChange={value => update('sms.sender_id', value)} /></Field>
        </div>
      </Card>
      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
