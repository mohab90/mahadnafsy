import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

/**
 * The approved Meta template a promotional campaign sends. Outside a
 * conversation the official WhatsApp API delivers templates only, so a
 * campaign from the company number is built on one: pick it, then say what
 * fills each {{1}}, {{2}}… — a fixed text, or {{name}} / {{clientCode}} for
 * each person's own.
 */
export type MetaTemplate = { name: string; language: string; body: string; params: number; category: string; usable: boolean };
export type TemplateChoice = { name: string; language: string; params: string[]; body: string } | null;

const FILLERS = [
  { value: '{{name}}', label: 'اسم العميل' },
  { value: '{{clientCode}}', label: 'كود العميل' },
];

/** The text a template sends, with each {{n}} shown as what fills it. */
export const templatePreview = (choice: NonNullable<TemplateChoice>) =>
  choice.body.replace(/\{\{(\d+)\}\}/g, (_, n) => choice.params[Number(n) - 1] || `{{${n}}}`);

export function CampaignTemplatePicker({ value, onChange }: { value: TemplateChoice; onChange: (next: TemplateChoice) => void }) {
  const [state, setState] = useState<{ templates: MetaTemplate[]; error?: string } | null>(null);
  useEffect(() => {
    mysqlAdmin.adminGet<{ templates: MetaTemplate[]; error?: string }>('/admin/whatsapp-campaigns/templates')
      .then(setState, error => setState({ templates: [], error: error instanceof Error ? error.message : 'تعذر تحميل القوالب' }));
  }, []);

  if (!state) return <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> بيحمّل القوالب من ميتا…</div>;
  const marketing = state.templates.filter(t => t.usable);

  const pick = (key: string) => {
    const t = marketing.find(item => `${item.name}|${item.language}` === key);
    onChange(t ? { name: t.name, language: t.language, body: t.body, params: Array.from({ length: t.params }, (_, i) => (i === 0 ? '{{name}}' : '')) } : null);
  };

  return (
    <div className="space-y-2">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>}
      <select value={value ? `${value.name}|${value.language}` : ''} onChange={e => pick(e.target.value)}
        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
        <option value="">{marketing.length ? 'اختار قالب متوافق عليه' : 'مفيش قوالب متوافق عليها'}</option>
        {marketing.map(t => (
          <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} ({t.language}) — {t.category === 'MARKETING' ? 'تسويقي' : t.category}</option>
        ))}
      </select>
      {value && value.params.map((param, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <span className="w-12 font-mono text-xs text-gray-500">{`{{${index + 1}}}`}</span>
          <input value={param} onChange={e => onChange({ ...value, params: value.params.map((p, i) => (i === index ? e.target.value : p)) })}
            placeholder="نص ثابت أو {{name}}" className="min-w-[160px] flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          {FILLERS.map(filler => (
            <button key={filler.value} type="button" onClick={() => onChange({ ...value, params: value.params.map((p, i) => (i === index ? filler.value : p)) })}
              className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50">{filler.label}</button>
          ))}
        </div>
      ))}
      {value && <div className="whitespace-pre-wrap rounded-xl bg-emerald-50 px-3 py-2 text-sm text-gray-700">{templatePreview(value)}</div>}
      <p className="text-[11px] text-gray-500">
        القوالب بتتعمل وتتوافق عليها من WhatsApp Manager عند ميتا. القالب التسويقي بيبقى فيه زرار «إيقاف الرسائل»، وأي حد يدوس عليه أو يكتب «إلغاء» بيتشال من الحملات الجاية تلقائياً.
      </p>
    </div>
  );
}
