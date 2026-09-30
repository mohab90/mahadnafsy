import { useEffect, useState } from 'react';
import { MessageCircle, Save, Send } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

type Settings = { enabled: boolean; phones: string[]; hour: number; preview?: string };
type Notify = (type: 'success' | 'error' | 'info', text: string) => void;

/**
 * «يبعتي تقرير يومي علي الواتس اب بتاعي باداء الفريق كله»: the numbers the
 * day's report goes to and the hour it leaves (api/lib/ownerDailyReport.js).
 * Nothing is sent until a number is saved and the report switched on.
 */
export function OwnerWhatsappReportCard({ notify }: { notify: Notify }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [phones, setPhones] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    let cancelled = false;
    mysqlAdmin.adminGet<Settings>('/admin/reports/whatsapp')
      .then(data => { if (!cancelled) { setSettings(data); setPhones(data.phones.join('، ')); } })
      .catch(error => notify('error', error instanceof Error ? error.message : 'تعذر تحميل إعدادات التقرير'));
    return () => { cancelled = true; };
  }, [notify]);

  if (!settings) return null;

  const save = async () => {
    setBusy(true);
    try {
      const saved = await mysqlAdmin.adminPut<Settings & { ok: boolean }>('/admin/reports/whatsapp', { enabled: settings.enabled, hour: settings.hour, phones });
      setSettings(prev => ({ ...saved, preview: prev?.preview }));
      notify('success', saved.enabled ? `اتحفظ — التقرير هيوصل كل يوم الساعة ${saved.hour}:00` : 'اتحفظ — التقرير اليومي مقفول');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الحفظ');
    } finally { setBusy(false); }
  };

  const sendNow = async () => {
    setBusy(true);
    try {
      const result = await mysqlAdmin.adminPost<{ sent: number; results?: { phone: string; ok: boolean; reason?: string }[] }>('/admin/reports/whatsapp/send-now', {});
      const failed = (result.results || []).filter(item => !item.ok);
      notify(result.sent ? 'success' : 'error', result.sent
        ? `اتبعت لـ ${result.sent} رقم`
        : `ماوصلش: ${failed.map(item => `${item.phone} (${item.reason || 'فشل'})`).join('، ') || 'مفيش أرقام'}`);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر الإرسال');
    } finally { setBusy(false); }
  };

  return (
    <section className="space-y-3 rounded-2xl border border-emerald-200 bg-white p-4">
      <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-800"><MessageCircle size={15} className="text-emerald-600" /> التقرير اليومي على واتساب</h4>
      <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-600">الأرقام (لحد 5، بينهم فاصلة)</span>
          <input value={phones} dir="ltr" onChange={event => setPhones(event.target.value)} placeholder="01xxxxxxxxx"
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-gray-600">الساعة (القاهرة)</span>
          <select value={settings.hour} onChange={event => setSettings({ ...settings, hour: Number(event.target.value) })}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm font-bold text-gray-700">
          <input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} className="h-4 w-4" />
          يتبعت كل يوم
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void save()}
          className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"><Save size={14} /> حفظ</button>
        <button type="button" disabled={busy || !settings.phones.length} onClick={() => void sendNow()}
          className="flex items-center gap-1.5 rounded-xl border border-emerald-300 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><Send size={14} /> ابعت تقرير النهارده دلوقتي</button>
        {settings.preview && (
          <button type="button" onClick={() => setShowPreview(open => !open)} className="rounded-xl px-3 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50">
            {showPreview ? 'اخفي شكل الرسالة' : 'شوف شكل الرسالة'}
          </button>
        )}
      </div>
      {showPreview && settings.preview && (
        <pre className="whitespace-pre-wrap rounded-xl bg-emerald-50 p-3 text-xs leading-6 text-gray-800" dir="rtl">{settings.preview}</pre>
      )}
    </section>
  );
}
