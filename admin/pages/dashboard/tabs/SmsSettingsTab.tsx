import { useEffect, useState } from 'react';
import { MessageSquare, Save, RefreshCw, Send, TestTube, Globe, Key, Phone } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

const RAW_API_BASE = import.meta.env.VITE_API_URL || '';
const API_ORIGIN = RAW_API_BASE.replace(/\/api\/?$/, '');
const apiPath = (path: string) => `${API_ORIGIN}/api${path}`;

interface SmsConfig {
  provider: string;
  apiKey: string;
  senderId: string;
  enabled: boolean;
}

// Only vonage/infobip are actually implemented server-side (routes/misc/messaging.js's
// POST /admin/sms/send) — the list used to also offer twilio/unifonic/msegat/custom,
// which an admin could pick and save without error, only to hit "Unknown provider"
// the first time they tried to actually send an SMS (CFG-01). The per-provider API
// URL is hardcoded server-side too (no custom-URL support), so the "API URL" field
// that used to sit here was never read or written by the backend either (CFG-02) —
// removed rather than wired up to a capability that doesn't exist.
const PROVIDERS = [
  { value: 'vonage', label: 'Vonage (Nexmo)' },
  { value: 'infobip', label: 'Infobip' },
];

const DEFAULT_CONFIG: SmsConfig = {
  provider: 'vonage', apiKey: '', senderId: '', enabled: false,
};

export default function SmsSettingsTab({ notify }: { notify: NotifyFn }) {
  const [config, setConfig] = useState<SmsConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('هذه رسالة اختبار من منصة محاد نفسي');
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await fetch(apiPath('/admin/sms-settings'), { credentials: 'include', headers: adminAuthHeaders() });
      if (res.ok) {
        const d = await res.json();
        setConfig({
          ...DEFAULT_CONFIG,
          provider: d.provider || DEFAULT_CONFIG.provider,
          senderId: d.sender_id || DEFAULT_CONFIG.senderId,
          enabled: Boolean(d.is_active),
        });
      }
    } catch {}
    finally { setLoading(false); }
  }

  useEffect(() => { loadSettings(); }, []);

  function handleProviderChange(provider: string) {
    setConfig(c => ({ ...c, provider }));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const res = await fetch(apiPath('/admin/sms-settings'), {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({
          provider: config.provider,
          sender_id: config.senderId,
          is_active: config.enabled,
          ...(config.apiKey.trim() ? { api_key: config.apiKey.trim() } : {}),
        }),
      });
      if (res.ok) notify('success', 'تم حفظ إعدادات SMS');
      else notify('error', 'فشل الحفظ');
    } catch {
      notify('error', 'خطأ في الاتصال بالسيرفر');
    } finally { setSaving(false); }
  }

  async function testSms() {
    if (!testPhone.trim()) { notify('error', 'أدخل رقم الهاتف'); return; }
    setTesting(true);
    try {
      const res = await fetch(apiPath('/admin/sms/send'), {
        method: 'POST',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({ to: testPhone, message: testMessage }),
      });
      const d = await res.json();
      if (res.ok) notify('success', 'تم إرسال رسالة الاختبار بنجاح!');
      else notify('error', d.message || 'فشل إرسال الرسالة');
    } catch {
      notify('error', 'خطأ في الاتصال بالسيرفر');
    } finally { setTesting(false); }
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-green-600 to-emerald-600 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold flex items-center gap-2"><MessageSquare size={22} />إعدادات SMS</h2>
        <p className="text-green-100 text-sm mt-1">ضبط مزود SMS لإرسال الرسائل النصية للعملاء</p>
      </div>

      {/* Config form */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Globe size={16} className="text-green-500" />إعدادات المزود</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-sm text-gray-600">تفعيل SMS</span>
            <div className={`w-12 h-6 rounded-full transition-colors cursor-pointer ${config.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
              onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}>
              <div className={`w-5 h-5 bg-white rounded-full shadow mt-0.5 transition-all ${config.enabled ? 'mr-6.5 translate-x-6' : 'mr-0.5 translate-x-0.5'}`} />
            </div>
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">المزود</label>
            <select value={config.provider} onChange={e => handleProviderChange(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-300">
              {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">معرف المرسل (Sender ID)</label>
            <div className="relative">
              <Phone size={14} className="absolute right-3 top-2.5 text-gray-400" />
              <input value={config.senderId} onChange={e => setConfig(c => ({ ...c, senderId: e.target.value }))}
                placeholder="MahadNafsy"
                className="w-full border border-gray-300 rounded-xl pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-gray-700 mb-1">API Key</label>
            <div className="relative">
              <Key size={14} className="absolute right-3 top-2.5 text-gray-400" />
              <input value={config.apiKey} onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
                type={showKey ? 'text' : 'password'}
                placeholder="أدخل مفتاح API"
                className="w-full border border-gray-300 rounded-xl pr-8 pl-16 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
              <button onClick={() => setShowKey(!showKey)}
                className="absolute left-3 top-1.5 text-xs text-gray-400 hover:text-gray-700 bg-gray-50 px-2 py-1 rounded-lg">
                {showKey ? 'إخفاء' : 'إظهار'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={saveSettings} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-bold hover:bg-emerald-700 transition disabled:opacity-50">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
          </button>
        </div>
      </div>

      {/* Test SMS */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h3 className="font-bold text-gray-800 flex items-center gap-2"><TestTube size={16} className="text-green-500" />اختبار الإرسال</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">رقم الهاتف للاختبار</label>
            <input value={testPhone} onChange={e => setTestPhone(e.target.value)}
              placeholder="+201234567890"
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">نص الرسالة</label>
            <input value={testMessage} onChange={e => setTestMessage(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
          </div>
        </div>
        <button onClick={testSms} disabled={testing || !config.enabled}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition disabled:opacity-50">
          {testing ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
          {testing ? 'جاري الإرسال...' : 'إرسال رسالة اختبار'}
        </button>
        {!config.enabled && <p className="text-xs text-amber-600">⚠ فعّل الـ SMS أولاً لاختبار الإرسال</p>}
      </div>
    </div>
  );
}
