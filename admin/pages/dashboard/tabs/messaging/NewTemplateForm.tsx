import { useMemo, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

/**
 * «قالب جديد»: a template written here and sent to Meta for approval, instead of in WhatsApp Manager. Meta answers within minutes to a day;
 * the template appears in the list above once it is approved. The server (api/lib/metaTemplates.js) checks what Meta refuses most often
 * and says what to change, so the form only asks.
 */
const variableCount = (body: string) => new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1]))).size;

export function NewTemplateForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [body, setBody] = useState('');
  const [examples, setExamples] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const count = useMemo(() => variableCount(body), [body]);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await mysqlAdmin.adminPost('/admin/whatsapp-campaigns/templates', { name, language: 'ar', category, body, examples: examples.slice(0, count) });
      setMessage({ ok: true, text: 'اتبعت لميتا للموافقة. هيظهر في القايمة فوق لما يتوافق عليه (دقايق لحد يوم).' });
      setName(''); setBody(''); setExamples([]);
      onSubmitted?.();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'تعذر إرسال القالب' });
    } finally { setBusy(false); }
  };

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs font-bold text-indigo-700 hover:underline">+ قالب جديد وإرساله لميتا للموافقة</button>;
  }
  return (
    <div className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3" dir="rtl">
      <div className="flex flex-wrap gap-2">
        <label className="min-w-[160px] flex-1 text-xs font-bold text-gray-600">اسم القالب (إنجليزي صغير)
          <input value={name} onChange={event => setName(event.target.value.toLowerCase())} dir="ltr" placeholder="course_reminder"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-1.5 font-mono text-sm" />
        </label>
        <label className="text-xs font-bold text-gray-600">النوع
          <select value={category} onChange={event => setCategory(event.target.value as 'MARKETING' | 'UTILITY')} className="mt-1 block rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
            <option value="MARKETING">تسويقي (عروض وحملات)</option>
            <option value="UTILITY">خدمي (تذكير، إيصال، تأكيد)</option>
          </select>
        </label>
      </div>
      <label className="block text-xs font-bold text-gray-600">نص القالب — المتغيرات {'{{1}} {{2}}'} (مش في أول النص ولا آخره)
        <textarea value={body} onChange={event => setBody(event.target.value)} rows={4} placeholder="أهلاً {{1}}، عرض خاص على {{2}} لحد آخر الأسبوع."
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      </label>
      {Array.from({ length: count }, (_, index) => (
        <label key={index} className="flex items-center gap-2 text-xs text-gray-600">
          <span className="w-24 font-mono">مثال {`{{${index + 1}}}`}</span>
          <input value={examples[index] || ''} onChange={event => setExamples(list => Object.assign([...list], { [index]: event.target.value }))}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        </label>
      ))}
      {category === 'MARKETING' && <p className="text-[11px] text-gray-500">القالب التسويقي بيتضاف له تلقائياً «لإيقاف الرسائل ارسل: ستوب».</p>}
      {message && <p className={`rounded-lg px-3 py-2 text-xs ${message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{message.text}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !name || !body.trim()} onClick={() => void submit()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} ابعت لميتا
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600">إغلاق</button>
      </div>
    </div>
  );
}
