import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Send, Target } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { confirmDialog } from '../../../../shared/ui/confirmDialog';
import { Card, Field, Input, NotifyFn, SECRET_MASK, SaveBar, SectionHeader, Toggle } from './saasConnectorUi';

/**
 * Meta's Conversions API (api/lib/metaCapi.js): the Lead and Purchase the
 * browser pixel sends, sent again from the server so an ad blocker does not
 * lose them. It could only be set from the server's environment or by hand in
 * the settings blob, with no way to tell which one was in effect or whether
 * Meta was accepting anything.
 *
 * Saved through PUT /api/admin/settings as `metaCapi`. The token comes back
 * blank from every read, so the screen is told only whether one exists and
 * where it came from (GET /api/admin/meta-capi), and an empty token field on
 * save keeps the stored one (lib/configSecrets.js preserveStoredSecrets).
 */

type Source = 'settings' | 'env' | 'site' | 'none';

type MetaCapiStatus = {
  saved: { enabled: boolean; pixelId: string; hasToken: boolean; testEventCode: string };
  effective: {
    configured: boolean;
    enabled: boolean;
    pixelId: string;
    pixelValid: boolean;
    pixelSource: Source;
    hasToken: boolean;
    tokenSource: Source;
    testEventCode: string;
    testEventCodeSource: Source;
  };
};

type TestOutcome = { ok: boolean; status?: number; message?: string; usedTestCode?: boolean; eventsReceived?: number; reason?: string };

const SOURCE_LABEL: Record<Source, string> = {
  settings: 'من الإعدادات هنا',
  env: 'من متغيرات السيرفر (env)',
  site: 'بكسل الموقع الافتراضي',
  none: 'مش متضبط',
};

const SOURCE_TONE: Record<Source, string> = {
  settings: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  env: 'bg-amber-50 text-amber-800 border-amber-200',
  site: 'bg-gray-50 text-gray-600 border-gray-200',
  none: 'bg-rose-50 text-rose-700 border-rose-200',
};

const SourceBadge = ({ source }: { source: Source }) => (
  <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${SOURCE_TONE[source]}`}>{SOURCE_LABEL[source]}</span>
);

const PIXEL_ID = /^\d{5,20}$/;

function describeOutcome(outcome: TestOutcome): string {
  if (outcome.ok) return `ميتا استلمت الحدث (HTTP ${outcome.status}${outcome.usedTestCode ? '، بكود التجربة' : ''}).`;
  if (outcome.reason === 'not_configured') return outcome.message || 'الربط مش مكتمل.';
  const message = outcome.message === 'timeout' ? 'ميتا ما ردّتش في الوقت' : outcome.message;
  return `ميتا ما قبلتش الحدث${outcome.status ? ` (HTTP ${outcome.status})` : ''}${message ? `: ${message}` : ''}`;
}

export default function MetaCapiSettingsTab({ notify }: { notify: NotifyFn }) {
  const [status, setStatus] = useState<MetaCapiStatus | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [pixelId, setPixelId] = useState('');
  const [testEventCode, setTestEventCode] = useState('');
  // Write-only: '' keeps whatever is stored. Opened by «تغيير».
  const [newToken, setNewToken] = useState('');
  const [replacingToken, setReplacingToken] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/meta-capi', { credentials: 'include', headers: adminAuthHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as MetaCapiStatus;
      setStatus(data);
      setEnabled(data.saved.enabled);
      setPixelId(data.saved.pixelId);
      setTestEventCode(data.saved.testEventCode);
      setNewToken('');
      setReplacingToken(false);
      setDirty(false);
    } catch {
      notify('error', 'فشل تحميل إعدادات تتبّع إعلانات ميتا');
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const touch = () => setDirty(true);

  const save = async () => {
    const pixel = pixelId.trim();
    if (pixel && !PIXEL_ID.test(pixel)) {
      notify('error', 'الـ Pixel ID أرقام بس (من 5 لـ 20 رقم)');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify({
          metaCapi: { enabled, pixelId: pixel, testEventCode: testEventCode.trim(), accessToken: newToken.trim() },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      notify('success', 'تم حفظ إعدادات تتبّع إعلانات ميتا');
      await load();
    } catch {
      notify('error', 'فشل حفظ إعدادات تتبّع إعلانات ميتا');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    // Without a test event code Meta has no way to tell this one apart: it is
    // counted as a real Lead and the ads are optimised on it.
    if (!status?.effective.testEventCode && !await confirmDialog({
      title: 'مفيش كود حدث تجريبي',
      message: 'من غير الكود، ميتا هتحسب الحدث ده Lead حقيقي في إعلاناتك. تكمل؟',
      confirmLabel: 'إرسال',
      tone: 'normal',
    })) return;
    setTesting(true);
    setOutcome(null);
    try {
      const res = await fetch('/api/admin/meta-capi/test', { method: 'POST', credentials: 'include', headers: adminAuthHeaders() });
      const body = await res.json().catch(() => ({ ok: false, message: `HTTP ${res.status}` })) as TestOutcome;
      setOutcome(body);
    } catch {
      setOutcome({ ok: false, message: 'خطأ في الاتصال بالسيرفر' });
    } finally {
      setTesting(false);
    }
  };

  const effective = status?.effective;
  const tokenStored = Boolean(status?.saved.hasToken || effective?.hasToken);

  return (
    <div className="space-y-5" dir="rtl">
      <SectionHeader
        title="تتبّع إعلانات ميتا (Conversions API)"
        subtitle="الليد والدفع بيوصلوا لفيسبوك من السيرفر كمان، فمانع الإعلانات أو قفل الصفحة مش بيضيّعهم."
        icon={<Target size={22} />}
        tone="blue"
      />

      {effective && (
        <div className={`rounded-2xl border p-4 text-sm ${effective.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <p className="font-bold">{effective.configured ? 'الإرسال من السيرفر شغّال' : !effective.enabled ? 'الإرسال من السيرفر متوقف' : 'الإرسال من السيرفر مش شغّال — ناقصه Pixel ID صحيح أو توكن'}</p>
          <ul className="mt-2 space-y-1 text-xs">
            <li className="flex flex-wrap items-center gap-2">Pixel ID: <span className="font-mono" dir="ltr">{effective.pixelId || '—'}</span> <SourceBadge source={effective.pixelSource} /></li>
            <li className="flex flex-wrap items-center gap-2">التوكن: <span className="font-mono">{effective.hasToken ? SECRET_MASK : '—'}</span> <SourceBadge source={effective.tokenSource} /></li>
            <li className="flex flex-wrap items-center gap-2">كود الحدث التجريبي: <span className="font-mono" dir="ltr">{effective.testEventCode || '—'}</span> <SourceBadge source={effective.testEventCodeSource} /></li>
          </ul>
        </div>
      )}

      <Card title="بيانات الربط" hint="اللي تحفظه هنا بيكسب على متغيرات السيرفر. سيب الخانة فاضية علشان يفضل اللي في السيرفر شغّال.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3 md:col-span-2">
            <span className="text-sm font-semibold text-gray-600">إرسال الأحداث من السيرفر</span>
            <Toggle checked={enabled} onChange={value => { setEnabled(value); touch(); }} />
          </div>
          <Field label="Pixel ID">
            <Input value={pixelId} onChange={value => { setPixelId(value.replace(/\D/g, '')); touch(); }} placeholder={effective?.pixelSource !== 'settings' ? effective?.pixelId || '' : ''} />
          </Field>
          <Field label="كود الحدث التجريبي (اختياري)">
            <Input value={testEventCode} onChange={value => { setTestEventCode(value.trim()); touch(); }} placeholder="TEST12345" />
          </Field>
          <div className="md:col-span-2">
            <span className="mb-1 block text-xs font-semibold text-gray-500">Access Token</span>
            {tokenStored && !replacingToken ? (
              <div className="flex items-center gap-2">
                <input value={SECRET_MASK} readOnly disabled className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm text-gray-500" />
                <button
                  type="button"
                  onClick={() => setReplacingToken(true)}
                  className="shrink-0 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100"
                >
                  تغيير
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input type="password" value={newToken} onChange={value => { setNewToken(value); touch(); }} placeholder="الصق التوكن من Events Manager" />
                {tokenStored && (
                  <button
                    type="button"
                    onClick={() => { setReplacingToken(false); setNewToken(''); }}
                    className="shrink-0 rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
                  >
                    إلغاء
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-xs text-gray-400">التوكن مش بيظهر تاني بعد الحفظ.</p>
          </div>
        </div>
      </Card>

      <Card title="إرسال حدث تجريبي" hint="بيبعت Lead واحد بكود الحدث التجريبي لو موجود، فيظهر في «Test events» في Events Manager. احفظ الأول لو غيّرت حاجة.">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={testing || dirty}
            className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
          >
            {testing ? <RefreshCw size={15} className="animate-spin" /> : <Send size={15} />}
            إرسال حدث تجريبي
          </button>
          {outcome && (
            <p className={`text-sm ${outcome.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {describeOutcome(outcome)}
            </p>
          )}
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />
    </div>
  );
}
