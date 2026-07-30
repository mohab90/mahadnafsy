import { useEffect, useState } from 'react';
import { Link2, Plus, Trash2, UserPlus } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { Card, Field, Input, NotifyFn, SaveBar, SectionHeader, Toggle, setNested } from './saasConnectorUi';

type ApiSource = { id: string; name: string; enabled: boolean; secret: string; default_branch: string };
type LeadSourceConfig = {
  facebook: Record<string, string | boolean>;
  google_sheets: { enabled: boolean; auto_sync_enabled: boolean; sheets: Array<Record<string, string | boolean>> };
  website: Record<string, string | boolean>;
  api_sources: ApiSource[];
};

const DEFAULT_CONFIG: LeadSourceConfig = {
  facebook: { enabled: false, page_id: '', app_id: '', page_access_token: '', app_secret: '', webhook_verify_token: '', default_branch: '', default_sales_id: '', default_status: 'new' },
  google_sheets: { enabled: true, auto_sync_enabled: true, sheets: [] },
  website: { enabled: true, capture_utm: true, default_branch: '' },
  api_sources: [],
};

export default function LeadSourcesSettingsTab({ notify }: { notify: NotifyFn }) {
  const [config, setConfig] = useState<LeadSourceConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingProvider, setTestingProvider] = useState<string>('');

  useEffect(() => {
    fetch('/api/admin/sys-config?section=lead_source_connectors', { credentials: 'include', headers: adminAuthHeaders() })
      .then(res => res.ok ? res.json() : DEFAULT_CONFIG)
      .then(data => setConfig({
        ...DEFAULT_CONFIG,
        ...data,
        facebook: { ...DEFAULT_CONFIG.facebook, ...(data.facebook || {}) },
        google_sheets: { ...DEFAULT_CONFIG.google_sheets, ...(data.google_sheets || {}) },
        website: { ...DEFAULT_CONFIG.website, ...(data.website || {}) },
        api_sources: data.api_sources || [],
      }))
      .catch(() => notify('error', 'فشل تحميل مصادر الليد'));
  }, [notify]);

  const update = (path: string, value: unknown) => {
    setConfig(prev => setNested(prev, path, value));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/sys-config/lead_source_connectors', {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(await res.text());
      setDirty(false);
      notify('success', 'تم حفظ مصادر الليد');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل حفظ مصادر الليد');
    } finally {
      setSaving(false);
    }
  };

  const updateApiSource = (index: number, patch: Partial<ApiSource>) => {
    update('api_sources', config.api_sources.map((src, i) => i === index ? { ...src, ...patch } : src));
  };

  const testProvider = async (provider: 'facebook' | 'google_sheets') => {
    setTestingProvider(provider);
    try {
      const res = await fetch('/api/admin/lead-sources/test', {
        method: 'POST',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ provider }),
      });
      const body = await res.json();
      notify(body.ok ? 'success' : 'info', body.message || (body.ok ? 'اختبار المصدر نجح' : 'اختبار المصدر لم يكتمل'));
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل اختبار مصدر الليد');
    } finally {
      setTestingProvider('');
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <SectionHeader
        title="مصادر الداتا والليد"
        subtitle="تجميع Facebook Lead Ads وGoogle Sheets ونماذج الموقع والـ API في شاشة تشغيل موحدة."
        icon={<UserPlus size={22} />}
        tone="blue"
      />

      <Card title="Facebook Lead Ads">
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => testProvider('facebook')} disabled={testingProvider === 'facebook'} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50">
            {testingProvider === 'facebook' ? 'جاري الاختبار...' : 'اختبار Facebook'}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-600">ربط Facebook</span>
            <Toggle checked={!!config.facebook.enabled} onChange={value => update('facebook.enabled', value)} />
          </div>
          <Field label="معرّف الصفحة (Page ID)"><Input value={String(config.facebook.page_id || '')} onChange={value => update('facebook.page_id', value)} /></Field>
          <Field label="معرّف التطبيق (App ID)"><Input value={String(config.facebook.app_id || '')} onChange={value => update('facebook.app_id', value)} /></Field>
          <Field label="رمز تحقق الـ Webhook"><Input value={String(config.facebook.webhook_verify_token || '')} onChange={value => update('facebook.webhook_verify_token', value)} /></Field>
          <Field label="رمز وصول الصفحة"><Input type="password" value={String(config.facebook.page_access_token || '')} onChange={value => update('facebook.page_access_token', value)} /></Field>
          <Field label="سر التطبيق (App Secret)"><Input type="password" value={String(config.facebook.app_secret || '')} onChange={value => update('facebook.app_secret', value)} /></Field>
          <Field label="الفرع الافتراضي"><Input value={String(config.facebook.default_branch || '')} onChange={value => update('facebook.default_branch', value)} /></Field>
          <Field label="مسؤول السيلز الافتراضي"><Input value={String(config.facebook.default_sales_id || '')} onChange={value => update('facebook.default_sales_id', value)} /></Field>
        </div>
      </Card>

      <Card title="Google Sheets">
        <div className="mb-4 flex justify-end">
          <button type="button" onClick={() => testProvider('google_sheets')} disabled={testingProvider === 'google_sheets'} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50">
            {testingProvider === 'google_sheets' ? 'جاري الاختبار...' : 'اختبار Google Sheets'}
          </button>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-600">ربط Google Sheets</span>
            <Toggle checked={!!config.google_sheets.enabled} onChange={value => update('google_sheets.enabled', value)} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
            <span className="text-sm font-semibold text-gray-600">المزامنة التلقائية</span>
            <Toggle checked={!!config.google_sheets.auto_sync_enabled} onChange={value => update('google_sheets.auto_sync_enabled', value)} />
          </div>
        </div>
        <p className="text-xs text-gray-400">الربط الحالي يستخدم إعدادات CRM المحفوظة، وهذه الشاشة توحد مصادر الليدز ومزامنة الشيتات في مكان واحد.</p>
      </Card>

      <Card title="مصادر الموقع والـ API">
        <div className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
          <span className="text-sm font-semibold text-gray-600">نماذج الموقع وتتبع UTM</span>
          <Toggle checked={!!config.website.capture_utm} onChange={value => update('website.capture_utm', value)} />
        </div>
        <div className="space-y-2">
          {config.api_sources.map((source, index) => (
            <div key={source.id || index} className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 md:grid-cols-5">
              <Input value={source.name} onChange={value => updateApiSource(index, { name: value })} placeholder="اسم المصدر" />
              <Input value={source.default_branch} onChange={value => updateApiSource(index, { default_branch: value })} placeholder="الفرع الافتراضي" />
              <Input type="password" value={source.secret} onChange={value => updateApiSource(index, { secret: value })} placeholder="السر" />
              <div className="flex items-center justify-center"><Toggle checked={!!source.enabled} onChange={value => updateApiSource(index, { enabled: value })} /></div>
              <button className="inline-flex items-center justify-center rounded-xl border border-red-200 text-red-600" onClick={() => update('api_sources', config.api_sources.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
            </div>
          ))}
          <button className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700" onClick={() => update('api_sources', [...config.api_sources, { id: `api_${Date.now()}`, name: '', enabled: true, secret: '', default_branch: '' }])}>
            <Plus size={15} /> إضافة مصدر API
          </button>
        </div>
      </Card>

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        <Link2 size={16} className="ml-1 inline" /> Webhook العام المقترح للربط الخارجي: <code dir="ltr">/api/leads-public</code>
      </div>
      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}
