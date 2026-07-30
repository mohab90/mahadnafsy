import { useState, useEffect, useRef } from 'react';
import { Settings2, Bot, FileText, AlertCircle, Zap, Save, CheckCircle, Code2, Video } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface Props {
  notify: NotifyFn;
}

export default function AdminAiSettingsTab({ notify }: Props) {
  const { adminAiConfig, setAdminAiConfig, content, setContentValue } = useSiteData();

  const [adminAiDraft, setAdminAiDraft] = useState<{
    provider: string; apiKey: string; model: string; temperature: number; maxTokens: number; systemPrompt: string;
  }>({ provider: 'gemini', apiKey: '', model: 'gemini-2.0-flash-lite', temperature: 0.7, maxTokens: 1500, systemPrompt: '' });
  const [adminAiSaved, setAdminAiSaved] = useState(false);
  const [aiPromptSuggestion, setAiPromptSuggestion] = useState('');
  const [aiPromptImproving, setAiPromptImproving] = useState(false);

  const [zaiDraft, setZaiDraft] = useState<{
    apiKey: string; model: string; baseUrl: string; systemPrompt: string; autoContext: boolean;
  }>({ apiKey: '', model: 'GLM-4.7', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', systemPrompt: '', autoContext: false });

  // ── Video unlock settings ──────────────────────────────────────────────────
  const [videoUnlockDraft, setVideoUnlockDraft] = useState({
    onDeposit: '',
    perPayment: '',
  });
  const [videoUnlockSaved, setVideoUnlockSaved] = useState(false);
  // Sync from content when it loads
  useEffect(() => {
    setVideoUnlockDraft({
      onDeposit: content['access.videos_on_deposit'] || '20',
      perPayment: content['access.videos_per_payment'] || '15',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content['access.videos_on_deposit'], content['access.videos_per_payment']]);

  const handleSaveVideoUnlock = async () => {
    const dep = Math.max(1, Number(videoUnlockDraft.onDeposit) || 20);
    const per = Math.max(1, Number(videoUnlockDraft.perPayment) || 15);
    const saved = await Promise.all([
      setContentValue('access.videos_on_deposit', String(dep)),
      setContentValue('access.videos_per_payment', String(per)),
    ]);
    if (!saved.every(Boolean)) {
      notify('error', 'تعذر حفظ إعدادات فتح الفيديوهات');
      return;
    }
    setVideoUnlockSaved(true);
    setTimeout(() => setVideoUnlockSaved(false), 2500);
  };

  // Sync adminAiDraft once from MySQL when adminAiConfig loads (cross-device)
  const adminAiSyncedRef = useRef(false);
  useEffect(() => {
    if (adminAiConfig && !adminAiSyncedRef.current) {
      adminAiSyncedRef.current = true;
      setAdminAiDraft({
        provider: adminAiConfig.provider || 'gemini',
        apiKey: adminAiConfig.apiKey || '',
        model: adminAiConfig.model || 'gemini-2.0-flash-lite',
        temperature: adminAiConfig.temperature ?? 0.7,
        maxTokens: adminAiConfig.maxTokens ?? 1500,
        systemPrompt: adminAiConfig.systemPrompt || '',
      });
    }
  }, [adminAiConfig]);

  const handleSaveAdminAi = async () => {
    if (!await setAdminAiConfig(adminAiDraft)) {
      notify('error', 'تعذر حفظ إعدادات الذكاء الاصطناعي على السيرفر');
      return;
    }
    setAdminAiSaved(true);
    setTimeout(() => setAdminAiSaved(false), 2500);
  };

  const handleImprovePrompt = async () => {
    const currentPrompt = adminAiDraft.systemPrompt?.trim();
    if (!currentPrompt) { setAiPromptSuggestion('⚠️ أدخل البرومبت الحالي أولاً قبل طلب التحسين.'); return; }
    setAiPromptImproving(true);
    setAiPromptSuggestion('');
    try {
      const improveInstruction = `أنت خبير في كتابة تعليمات الذكاء الاصطناعي. حسِّن البرومبت التالي ليكون أكثر وضوحاً ودقةً واختصاراً مع الحفاظ على نفس الغرض. أعطني فقط النص المحسَّن بدون مقدمة أو شرح.\n\nالبرومبت الحالي:\n---\n${currentPrompt}\n---`;
      const { text } = await mysqlAdmin.generateAdminAi({
        messages: [{ role: 'user', content: improveInstruction }],
        maxTokens: 600,
      });
      setAiPromptSuggestion(text || '');
    } catch (err) {
      setAiPromptSuggestion(`⚠️ خطأ: ${err instanceof Error ? err.message : 'حدث خطأ غير متوقع'}`);
    } finally {
      setAiPromptImproving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="bg-gradient-to-r from-slate-700 to-slate-600 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-white/20 rounded-2xl flex items-center justify-center"><Settings2 size={24} /></div>
          <div>
            <h2 className="text-xl font-extrabold">إعدادات AI — مساعد الإدارة</h2>
            <p className="text-white/75 text-sm">تبويب "اسأل AI" — المساعد الداخلي الخاص بالأدمن فقط</p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl space-y-4">
        <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Bot size={16} className="text-slate-500" />نموذج الذكاء الاصطناعي</h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">المزود</label>
                <select value={adminAiDraft.provider} onChange={e => {
                  const p = e.target.value;
                  const models: Record<string, string> = { gemini: 'gemini-2.0-flash-lite', openai: 'gpt-4o-mini', claude: 'claude-3-5-haiku-20241022' };
                  setAdminAiDraft({ ...adminAiDraft, provider: p, model: models[p] || '' });
                }} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI (ChatGPT)</option>
                  <option value="claude">Anthropic Claude</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">النموذج</label>
                <select value={adminAiDraft.model} onChange={e => setAdminAiDraft({ ...adminAiDraft, model: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  {adminAiDraft.provider === 'gemini' && <>
                    <option value="gemini-2.0-flash-lite">gemini-2.0-flash-lite (مجاني ✓)</option>
                    <option value="gemini-2.5-flash-preview-04-17">gemini-2.5-flash (أحدث)</option>
                    <option value="gemini-1.5-flash">gemini-1.5-flash (مستقر)</option>
                    <option value="gemini-1.5-pro">gemini-1.5-pro (أدق)</option>
                  </>}
                  {adminAiDraft.provider === 'openai' && <>
                    <option value="gpt-4o-mini">gpt-4o-mini (اقتصادي)</option>
                    <option value="gpt-4o">gpt-4o (أقوى)</option>
                    <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                  </>}
                  {adminAiDraft.provider === 'claude' && <>
                    <option value="claude-3-5-haiku-20241022">claude-3-5-haiku (سريع ✓)</option>
                    <option value="claude-sonnet-4-5">claude-sonnet-4-5 (متوازن)</option>
                    <option value="claude-opus-4-5">claude-opus-4-5 (أقوى)</option>
                  </>}
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">مفتاح API</label>
              <input type="password" value={adminAiDraft.apiKey}
                onChange={e => setAdminAiDraft({ ...adminAiDraft, apiKey: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
                placeholder={adminAiDraft.provider === 'gemini' ? 'AIza...' : adminAiDraft.provider === 'openai' ? 'sk-...' : 'sk-ant-...'} />
              <p className="text-xs text-gray-400 mt-1">
                {adminAiDraft.provider === 'gemini' && <span>مجانًا من: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">aistudio.google.com/apikey</a></span>}
                {adminAiDraft.provider === 'openai' && <span>من: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">platform.openai.com/api-keys</a> (يحتاج رصيد)</span>}
                {adminAiDraft.provider === 'claude' && <span>من: <a href="https://console.anthropic.com/keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">console.anthropic.com/keys</a> (يحتاج رصيد)</span>}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">درجة الإبداعية ({adminAiDraft.temperature})</label>
                <input type="range" min="0" max="1" step="0.1" value={adminAiDraft.temperature}
                  onChange={e => setAdminAiDraft({ ...adminAiDraft, temperature: parseFloat(e.target.value) })}
                  className="w-full accent-slate-600" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5"><span>دقيق</span><span>إبداعي</span></div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">الحد الأقصى للرد</label>
                <input type="number" min="500" max="4000" step="100" value={adminAiDraft.maxTokens}
                  onChange={e => setAdminAiDraft({ ...adminAiDraft, maxTokens: parseInt(e.target.value) || 1500 })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm" />
              </div>
            </div>

            {/* System Prompt */}
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1 flex items-center gap-1">
                <FileText size={12} className="text-violet-500" />
                البرومبت الأساسي — System Prompt
                <span className="text-gray-400 font-normal mr-1">(إذا تُرك فارغاً يُستخدم السياق التلقائي لبيانات المعهد)</span>
              </label>
              <textarea
                rows={5}
                value={adminAiDraft.systemPrompt}
                onChange={e => setAdminAiDraft({ ...adminAiDraft, systemPrompt: e.target.value })}
                placeholder={`اتركه فارغاً لاستخدام السياق التلقائي (بيانات المعهد كاملة).\n\nأو اكتب prompt مخصص يحل محل السياق التلقائي بالكامل.\n\nمثال:\nأنت مساعد إداري مختصر — أجب في 3 أسطر فقط.\nركّز على الإيرادات وأداء السيلز.`}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono resize-y focus:border-violet-400 focus:outline-none leading-relaxed"
              />
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <AlertCircle size={11} />
                إذا تُركت فارغة: يعمل المساعد بالسياق التلقائي الكامل (بيانات المعهد). إذا حُدِّدت: تُستبدل السياق التلقائي بما كتبته.
              </p>
              {/* Improve prompt with AI */}
              <button
                type="button"
                onClick={handleImprovePrompt}
                disabled={aiPromptImproving || !adminAiDraft.systemPrompt?.trim()}
                className="mt-2 px-4 py-2 text-sm rounded-xl border border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100 font-bold flex items-center gap-2 transition disabled:opacity-40"
              >
                {aiPromptImproving ? <><span className="animate-spin inline-block">⚙️</span> جاري التحسين...</> : <>✨ تحسين البرومبت بالذكاء الاصطناعي</>}
              </button>
              {aiPromptSuggestion && (
                <div className="mt-2 border border-violet-200 rounded-xl bg-violet-50 p-3">
                  <p className="text-xs font-bold text-violet-700 mb-2 flex items-center gap-1"><Zap size={12} />الاقتراح المُحسَّن:</p>
                  <pre className="text-xs text-violet-900 whitespace-pre-wrap font-mono leading-relaxed">{aiPromptSuggestion}</pre>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => { setAdminAiDraft({ ...adminAiDraft, systemPrompt: aiPromptSuggestion }); setAiPromptSuggestion(''); }}
                      className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg hover:bg-violet-700 font-bold"
                    >تطبيق الاقتراح</button>
                    <button
                      onClick={() => setAiPromptSuggestion('')}
                      className="px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 font-bold"
                    >تجاهل</button>
                  </div>
                </div>
              )}
            </div>

            <button onClick={handleSaveAdminAi}
              className="w-full py-2.5 bg-slate-700 text-white rounded-xl text-sm font-bold hover:bg-slate-800 transition flex items-center justify-center gap-2">
              {adminAiSaved ? <><CheckCircle size={15} />تم الحفظ! ✅</> : <><Save size={15} />حفظ الإعدادات</>}
            </button>
          </div>
        </article>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <p className="font-bold mb-1 flex items-center gap-2"><AlertCircle size={14} />الفرق بين المساعدَين</p>
          <ul className="space-y-1 text-xs list-disc list-inside">
            <li><strong>مساعد الإدارة (هذه الإعدادات)</strong> — يعمل في تبويب "اسأل AI"، يرى كل بيانات السيستم</li>
            <li><strong>AI البرمجي (Z.AI في الأسفل)</strong> — تبويب "AI برمجي 💻"، مخصص لتطوير الكود</li>
          </ul>
        </div>

        {/* ── Z.AI Dev Section ── */}
        <article className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2">
            <Code2 size={16} className="text-emerald-600" />إعدادات AI البرمجي (Z.AI)
          </h3>
          <p className="text-xs text-gray-500 mb-4">يُستخدم في تبويب "AI برمجي 💻" — مربوط بـ Z.AI API لتطوير كود الموقع</p>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">Z.AI API Key</label>
              <input type="password" value={zaiDraft.apiKey}
                onChange={e => setZaiDraft({ ...zaiDraft, apiKey: e.target.value })}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
                placeholder="أدخل مفتاح Z.AI API هنا..." />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">رابط الخادم (Base URL)</label>
                <input type="text" value={zaiDraft.baseUrl}
                  onChange={e => setZaiDraft({ ...zaiDraft, baseUrl: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono"
                  placeholder="https://open.bigmodel.cn/api/paas/v4" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-600 block mb-1">النموذج</label>
                <select value={zaiDraft.model} onChange={e => setZaiDraft({ ...zaiDraft, model: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm">
                  <option value="GLM-4.7">GLM-4.7 (متوازن ✓)</option>
                  <option value="GLM-4.6">GLM-4.6 (سريع)</option>
                  <option value="GLM-4.6V-FlashX">GLM-4.6V-FlashX (سريع جداً)</option>
                  <option value="GLM-5-Turbo">GLM-5-Turbo (أقوى)</option>
                  <option value="GLM-5V-Turbo">GLM-5V-Turbo (أقوى + صور)</option>
                  <option value="gpt-4o-mini">gpt-4o-mini (OpenAI)</option>
                  <option value="gpt-4o">gpt-4o (OpenAI)</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-600 block mb-1">System Prompt للبرمجة (اختياري)</label>
              <textarea rows={4} value={zaiDraft.systemPrompt}
                onChange={e => setZaiDraft({ ...zaiDraft, systemPrompt: e.target.value })}
                placeholder={`الافتراضي: أنت مساعد برمجي خبير في React 19 + TypeScript + Tailwind + Firebase + Vite...`}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono resize-y" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={zaiDraft.autoContext}
                onChange={e => setZaiDraft({ ...zaiDraft, autoContext: e.target.checked })}
                className="w-4 h-4 accent-emerald-600" />
              <span className="text-xs text-gray-700">أضف معلومات بنية الموقع تلقائياً (Tech Stack Context)</span>
            </label>
            <button onClick={() => notify('info', 'إعدادات Z.AI مؤقتة داخل الجلسة ولا تُحفظ حتى ربطها بخادم أسرار آمن')}
              className="w-full py-2.5 bg-gray-600 text-white rounded-xl text-sm font-bold hover:bg-gray-700 transition flex items-center justify-center gap-2">
              <AlertCircle size={15} />إعدادات جلسة فقط — الحفظ معطّل
            </button>
          </div>
        </article>

        {/* ── Video Auto-Unlock Settings ── */}
        <article className="bg-white border border-blue-200 rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 mb-1 flex items-center gap-2"><Video size={16} className="text-blue-500" />إعدادات فتح الفيديوهات التلقائي</h3>
          <p className="text-xs text-gray-400 mb-4">عند تسجيل دفعة كورس، يتم فتح عدد من الفيديوهات تلقائياً حسب الإعدادات أدناه.</p>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1.5">عند المقدم (أول دفعة) 🎬</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} max={9999}
                    value={videoUnlockDraft.onDeposit}
                    onChange={e => setVideoUnlockDraft(p => ({ ...p, onDeposit: e.target.value }))}
                    className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <span className="text-xs text-gray-500">فيديو</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">افتراضي: 20</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-700 block mb-1.5">مع كل قسط إضافي ➕</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={1} max={9999}
                    value={videoUnlockDraft.perPayment}
                    onChange={e => setVideoUnlockDraft(p => ({ ...p, perPayment: e.target.value }))}
                    className="w-24 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-center focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  <span className="text-xs text-gray-500">فيديو</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">افتراضي: 15</p>
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-800">
              <p className="font-bold mb-1">كيف يعمل؟</p>
              <ul className="list-disc list-inside space-y-0.5 text-blue-700">
                <li>أول دفعة (مقدم): يُفتح <strong>{Math.max(1, Number(videoUnlockDraft.onDeposit) || 20)}</strong> فيديو</li>
                <li>كل قسط بعده: تُضاف <strong>{Math.max(1, Number(videoUnlockDraft.perPayment) || 15)}</strong> فيديو</li>
                <li>عند سداد كامل المبلغ: يُفتح الكورس بالكامل تلقائياً</li>
              </ul>
            </div>
            <button onClick={handleSaveVideoUnlock}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition flex items-center justify-center gap-2">
              {videoUnlockSaved ? <><CheckCircle size={15} />تم الحفظ! ✅</> : <><Save size={15} />حفظ إعدادات الفيديوهات</>}
            </button>
          </div>
        </article>
      </div>
    </div>
  );
}
