import { useCallback, useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { Card, Field, Input, NotifyFn, SaveBar, SECRET_MASK, SectionHeader } from './saasConnectorUi';

/**
 * The mail credentials, and what the mail server says about them.
 *
 * The API for this has existed for a while — GET/PUT /api/admin/settings/email,
 * a /health endpoint recording the last send, and a /test that sends a real
 * message. Nothing in the admin ever called any of it, so the settings were
 * reachable only by editing the server's .env over SSH.
 *
 * That is why 1,431 emails failed with "535 authentication failed" and nobody
 * could act on it: the record of the failure was a column in message_outbox,
 * and the fix needed a shell.
 */

type EmailConfig = {
  smtpHost?: string;
  smtpPort?: number | string;
  smtpUser?: string;
  smtpPass?: string;
  senderName?: string;
  senderAddress?: string;
};

type Health = {
  healthy?: boolean;
  unknown?: boolean;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  lastFailureReason?: string | null;
  failuresSinceSuccess?: number;
};

export default function EmailSettingsTab({ notify }: { notify: NotifyFn }) {
  const [config, setConfig] = useState<EmailConfig>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [testTo, setTestTo] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');

  const loadHealth = useCallback(() => {
    fetch('/api/admin/settings/email/health', { credentials: 'include', headers: adminAuthHeaders() })
      .then(res => (res.ok ? res.json() : null))
      .then(data => data && setHealth(data))
      .catch(() => { /* the form is still usable without it */ });
  }, []);

  useEffect(() => {
    fetch('/api/admin/settings/email', { credentials: 'include', headers: adminAuthHeaders() })
      .then(res => (res.ok ? res.json() : null))
      .then(data => data && setConfig(data))
      .catch(() => notify('error', 'تعذّر تحميل إعدادات البريد'));
    loadHealth();
  }, [notify, loadHealth]);

  const set = (key: keyof EmailConfig, value: string) => {
    setConfig(previous => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/settings/email', {
        method: 'PUT',
        credentials: 'include',
        headers: { ...adminAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'فشل الحفظ');
      setDirty(false);
      notify('success', 'اتحفظت — ابعت رسالة اختبار دلوقتي');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'فشل الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testTo.trim()) { notify('info', 'اكتب بريداً يستقبل رسالة الاختبار'); return; }
    setTesting(true);
    setTestError('');
    try {
      const response = await fetch('/api/admin/settings/email/test', {
        method: 'POST',
        credentials: 'include',
        headers: { ...adminAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The server's own words. "authentication failed" is not actionable;
        // the code it came with is.
        setTestError(data.error || 'فشل الإرسال');
        notify('error', 'الإرسال فشل — التفاصيل تحت');
      } else {
        notify('success', 'اتبعتت — شوف صندوق الوارد');
      }
    } catch {
      setTestError('تعذّر الاتصال بالخادم');
    } finally {
      setTesting(false);
      loadHealth();
    }
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Mail size={18} />}
        title="إعدادات البريد"
        subtitle="خادم البريد اللي النظام بيبعت منه — تأكيدات الدفع ولينكات المحاضرات واستعادة كلمة السر."
      />

      {health && !health.unknown && (
        <div
          className={`rounded-2xl border p-4 text-sm ${
            health.healthy
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
        >
          <p className="font-bold">
            {health.healthy ? '✓ آخر إرسال نجح' : `✗ فشل ${health.failuresSinceSuccess ?? 0} إرسال من آخر نجاح`}
          </p>
          {health.lastFailureReason && (
            <p className="mt-2 rounded-lg bg-white/60 px-2 py-1 font-mono text-[11px]" dir="ltr">
              {health.lastFailureReason}
            </p>
          )}
        </div>
      )}

      <Card title="خادم البريد (SMTP)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="المضيف">
            <Input value={config.smtpHost} onChange={value => set('smtpHost', value)} placeholder="smtp.hostinger.com" />
          </Field>
          <Field label="المنفذ — 465 لـSSL · 587 لـSTARTTLS">
            <Input type="number" value={config.smtpPort} onChange={value => set('smtpPort', value)} placeholder="465" />
          </Field>
          <Field label="اسم المستخدم — عنوان البريد كاملاً">
            <Input value={config.smtpUser} onChange={value => set('smtpUser', value)} placeholder="otp@mahadnafsy.com" />
          </Field>
          <Field label="كلمة السر">
            <Input
              type="password"
              value={config.smtpPass}
              onChange={value => set('smtpPass', value)}
              placeholder={SECRET_MASK}
            />
          </Field>
          <Field label="اسم المرسِل الظاهر">
            <Input value={config.senderName} onChange={value => set('senderName', value)} placeholder="معهد الدراسات النفسية" />
          </Field>
          <Field label="عنوان المرسِل — لازم يكون على نفس نطاق المستخدم">
            <Input value={config.senderAddress} onChange={value => set('senderAddress', value)} placeholder="otp@mahadnafsy.com" />
          </Field>
        </div>
        <p className="mt-3 text-[12px] text-gray-500">
          كلمة السر بتفضل زي ما هي لو سبتها بعلامات النجوم — فتقدر تعدّل المنفذ من
          غير ما تدخّلها تاني.
        </p>
      </Card>

      <Card title="رسالة اختبار" hint="بتتبعت فعلاً من نفس الإعدادات — لو وصلت يبقى كل حاجة شغّالة.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[16rem] flex-1">
            <Field label="ابعتها لأي بريد">
              <Input value={testTo} onChange={setTestTo} placeholder="you@example.com" />
            </Field>
          </div>
          <button
            type="button"
            onClick={sendTest}
            disabled={testing}
            className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            {testing ? 'جاري الإرسال…' : 'ابعت اختبار'}
          </button>
        </div>
        {testError && (
          <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 font-mono text-[11px] text-rose-900" dir="ltr">
            {testError}
          </p>
        )}
      </Card>

      <SaveBar dirty={dirty} saving={saving} onSave={save} />

      <Card title="لو الرد فيه 535" hint="الرقم ده معناه إن الخادم ردّ وفهم الطلب — ورفض الاعتماد نفسه.">
        <ol className="list-decimal space-y-1 pr-5 text-[13px] text-gray-600">
          <li>افتح لوحة الاستضافة ← البريد الإلكتروني ← النطاق بتاعك.</li>
          <li>اتأكد إن صندوق البريد اللي في «اسم المستخدم» فوق موجود فعلاً.</li>
          <li>غيّر كلمة سره من هناك وانسخ الجديدة.</li>
          <li>الصقها هنا، احفظ، وابعت اختبار تاني.</li>
        </ol>
      </Card>
    </div>
  );
}
