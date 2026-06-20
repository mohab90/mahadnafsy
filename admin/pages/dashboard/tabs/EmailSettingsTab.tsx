import React, { useState, useEffect, useCallback } from 'react';
import { Mail, Save, Send, Loader2 } from 'lucide-react';

interface EmailCfg {
  senderName: string; senderAddress: string;
  smtpHost: string; smtpPort: number; smtpUser: string; smtpPass: string;
  brandColor: string; headerTitle: string; headerSubtitle: string; logoUrl: string; footerText: string;
}
const BLANK: EmailCfg = {
  senderName: '', senderAddress: '', smtpHost: '', smtpPort: 465, smtpUser: '', smtpPass: '',
  brandColor: '#c0392b', headerTitle: '', headerSubtitle: '', logoUrl: '', footerText: '',
};

const FIELDS: { key: keyof EmailCfg; label: string; hint?: string; type?: string }[] = [
  { key: 'senderName',     label: 'اسم المُرسِل (يظهر للعميل)', hint: 'مثال: معهد الدراسات النفسية' },
  { key: 'senderAddress',  label: 'بريد المُرسِل', hint: 'مثال: otp@mahadnafsy.com' },
  { key: 'smtpHost',       label: 'SMTP Host', hint: 'smtp.hostinger.com' },
  { key: 'smtpPort',       label: 'SMTP Port', hint: '465', type: 'number' },
  { key: 'smtpUser',       label: 'SMTP User (حساب البريد)', hint: 'otp@mahadnafsy.com' },
  { key: 'smtpPass',       label: 'SMTP Password', hint: 'سيبه فاضي لو مش عايز تغيّره', type: 'password' },
];
const TEMPLATE_FIELDS: { key: keyof EmailCfg; label: string; type?: string }[] = [
  { key: 'headerTitle',    label: 'عنوان الترويسة' },
  { key: 'headerSubtitle', label: 'سطر تحت العنوان' },
  { key: 'brandColor',     label: 'لون الهوية', type: 'color' },
  { key: 'logoUrl',        label: 'رابط الشعار' },
  { key: 'footerText',     label: 'نص التذييل' },
];

export default function EmailSettingsTab({ notify }: { notify?: (type: 'success' | 'error' | 'info', text: string) => void }) {
  const [cfg, setCfg] = useState<EmailCfg>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);

  const toast = useCallback((m: string, k: 'success' | 'error' = 'success') => { if (notify) notify(k, m); else alert(m); }, [notify]);

  useEffect(() => {
    fetch('/api/admin/settings/email', { credentials: 'include' })
      .then(r => r.json()).then(d => setCfg({ ...BLANK, ...d })).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const set = (k: keyof EmailCfg, v: string | number) => setCfg(c => ({ ...c, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings/email', {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'فشل الحفظ');
      toast('تم حفظ إعدادات البريد ✅');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'فشل الحفظ', 'error'); }
    finally { setSaving(false); }
  };

  const sendTest = async () => {
    if (!testTo) return toast('اكتب بريد لإرسال الاختبار', 'error');
    setTesting(true);
    try {
      const res = await fetch('/api/admin/settings/email/test', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'فشل الإرسال');
      toast('تم إرسال رسالة الاختبار ✅ — راجع البريد');
    } catch (e: unknown) { toast(e instanceof Error ? e.message : 'فشل الإرسال', 'error'); }
    finally { setTesting(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-48"><Loader2 className="animate-spin text-indigo-500" size={26} /></div>;

  const input = (k: keyof EmailCfg, type = 'text') => (
    <input type={type} value={String(cfg[k] ?? '')} onChange={e => set(k, type === 'number' ? Number(e.target.value) : e.target.value)}
      placeholder={k === 'smtpPass' ? '••••••••' : ''}
      className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-400 outline-none" />
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-2 text-gray-800"><Mail size={18} className="text-indigo-600" /><h3 className="font-bold text-base">إعدادات البريد الإلكتروني</h3></div>
      <p className="text-xs text-gray-500 -mt-3">البريد اللي بيوصل للعملاء (نسيت كلمة المرور، الإيصالات، التأكيدات). غيّر المُرسِل والإعدادات وشكل الرسالة من هنا.</p>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h4 className="font-semibold text-sm text-gray-700">المُرسِل و SMTP</h4>
        <div className="grid md:grid-cols-2 gap-4">
          {FIELDS.map(f => (
            <label key={f.key} className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</span>
              {input(f.key, f.type)}
              {f.hint && <span className="block text-[11px] text-gray-400 mt-1">{f.hint}</span>}
            </label>
          ))}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <h4 className="font-semibold text-sm text-gray-700">شكل الرسالة (القالب)</h4>
        <div className="grid md:grid-cols-2 gap-4">
          {TEMPLATE_FIELDS.map(f => (
            <label key={f.key} className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">{f.label}</span>
              {input(f.key, f.type)}
            </label>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={save} disabled={saving}
          className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} حفظ
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <input value={testTo} onChange={e => setTestTo(e.target.value)} placeholder="بريد لاختبار الإرسال"
            className="border border-gray-300 rounded-xl px-4 py-2.5 text-sm w-56" />
          <button onClick={sendTest} disabled={testing}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60">
            {testing ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} اختبار
          </button>
        </div>
      </div>
    </div>
  );
}
