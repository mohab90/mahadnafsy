/**
 * MessageTemplatesPanel — edit the automated WhatsApp templates from Settings.
 * Saves to content['msg.templates'] (JSON) via setContentValue; the API reloads
 * them immediately and renders {{var}} placeholders in its cron messages.
 */
import React, { useState } from 'react';
import { MessageSquareText, Save, Check, RotateCcw, Variable } from 'lucide-react';
import { useSiteData } from '../../context/SiteDataContext';
import { TEMPLATE_DEFS, parseTemplates, renderPreview } from './messageTemplates';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function MessageTemplatesPanel({ notify }: { notify: NotifyFn }) {
  const { content, setContentValue } = useSiteData();
  const [custom, setCustom] = useState<Record<string, string>>(() => parseTemplates(content));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState('');

  const valueOf = (key: string, def: string) => drafts[key] ?? custom[key] ?? def;
  const flash = (k: string) => { setSavedKey(k); setTimeout(() => setSavedKey(''), 1500); };

  const save = (key: string, def: string) => {
    const text = (drafts[key] ?? custom[key] ?? def).trim();
    const next = { ...custom };
    if (!text || text === def) delete next[key]; // store only real overrides
    else next[key] = text;
    setCustom(next);
    setDrafts(d => { const n = { ...d }; delete n[key]; return n; });
    try {
      setContentValue('msg.templates', JSON.stringify(next));
      notify('success', 'تم حفظ القالب — سيُطبَّق على الرسائل التلقائية فوراً');
      flash(key);
    } catch (e) {
      notify('error', 'فشل الحفظ: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const resetToDefault = (key: string) => {
    const next = { ...custom }; delete next[key];
    setCustom(next);
    setDrafts(d => { const n = { ...d }; delete n[key]; return n; });
    setContentValue('msg.templates', JSON.stringify(next));
    notify('info', 'تمت إعادة القالب للنص الافتراضي');
  };

  const insertVar = (key: string, def: string, varName: string) => {
    const cur = valueOf(key, def);
    setDrafts(d => ({ ...d, [key]: `${cur}{{${varName}}}` }));
  };

  return (
    <div className="space-y-4" dir="rtl">
      <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
        تُستخدم هذه القوالب في الرسائل التلقائية عبر واتساب. استخدم المتغيّرات بين <code dir="ltr">{'{{ }}'}</code> — تُستبدل بالقيم الحقيقية عند الإرسال.
      </p>

      {TEMPLATE_DEFS.map(t => {
        const text = valueOf(t.key, t.default);
        const isCustom = t.key in custom;
        const dirty = drafts[t.key] !== undefined && (drafts[t.key] ?? '') !== (custom[t.key] ?? t.default);
        const sampleVars = Object.fromEntries(t.vars.map(v => [v.name, v.sample]));
        return (
          <div key={t.key} className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-brand-50 grid place-items-center flex-shrink-0">
                  <MessageSquareText size={17} className="text-brand-600" />
                </div>
                <div>
                  <p className="font-bold text-gray-800 text-sm flex items-center gap-2">
                    {t.label}
                    {isCustom && <span className="text-[10px] bg-brand-100 text-brand-700 rounded-full px-2 py-0.5">مُخصّص</span>}
                  </p>
                  <p className="text-[11px] text-gray-400">{t.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => resetToDefault(t.key)} className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
                  <RotateCcw size={12} /> افتراضي
                </button>
                <button onClick={() => save(t.key, t.default)} disabled={!dirty}
                  className={`flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-lg transition ${dirty ? 'bg-brand-600 hover:bg-brand-700 text-brand-fg' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                  {savedKey === t.key ? <Check size={13} /> : <Save size={13} />} حفظ
                </button>
              </div>
            </div>

            {/* Variable chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Variable size={13} className="text-gray-400" />
              {t.vars.map(v => (
                <button key={v.name} onClick={() => insertVar(t.key, t.default, v.name)}
                  title={`إدراج {{${v.name}}}`}
                  className="font-mono text-[11px] bg-gray-100 hover:bg-brand-50 hover:text-brand-700 text-gray-600 rounded-md px-2 py-1 transition" dir="ltr">
                  {`{{${v.name}}}`}
                </button>
              ))}
            </div>

            <textarea
              value={text}
              onChange={e => setDrafts(d => ({ ...d, [t.key]: e.target.value }))}
              rows={Math.max(3, text.split('\n').length)}
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:border-brand-400 focus:outline-none leading-relaxed"
            />

            {/* Live WhatsApp-style preview */}
            <div className="bg-[#e5ddd5] rounded-xl p-3">
              <div className="bg-[#dcf8c6] rounded-lg rounded-tr-none px-3 py-2 text-sm text-gray-800 whitespace-pre-wrap shadow-sm max-w-md mr-auto leading-relaxed">
                {renderPreview(text, sampleVars)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
