import React from 'react';
import { Save } from 'lucide-react';
import { useSiteData } from '../../../context/SiteDataContext';
type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

export default function MessagingAgentTab({ notify }: { notify: NotifyFn }) {
  const { messagingChannels, setMessagingChannels, aiAgentConfig, setAiAgentConfig } = useSiteData();

  // Local state for channel config editing
  const [channelTab, setChannelTab] = React.useState<'whatsapp' | 'messenger' | 'instagram' | 'webchat' | 'ai_agent'>('whatsapp');
  const [chDraft, setChDraft] = React.useState<import('../../../types').MessagingChannelsConfig>(() => messagingChannels || {
    whatsapp: { enabled: false, phoneNumberId: '', whatsappBusinessAccountId: '', accessToken: '', webhookVerifyToken: '', businessName: '', welcomeMessage: '', awayMessage: '', aiEnabled: false, aiReplyMode: 'disabled' },
    messenger: { enabled: false, pageId: '', pageAccessToken: '', appSecret: '', webhookVerifyToken: '', welcomeMessage: '', aiEnabled: false, aiReplyMode: 'disabled' },
    instagram: { enabled: false, instagramAccountId: '', accessToken: '', appSecret: '', webhookVerifyToken: '', welcomeMessage: '', aiEnabled: false, aiReplyMode: 'disabled' },
    webchat: { enabled: false, widgetTitle: '', widgetSubtitle: '', widgetColor: '#6366f1', primaryColor: '#6366f1', widgetPosition: 'bottom-right', welcomeMessage: '', awayMessage: '', agentName: '', agentAvatar: '', aiEnabled: false, aiReplyMode: 'disabled', showOnPages: [] },
    updatedAt: '',
  });
  const [chSaved, setChSaved] = React.useState(false);

  const handleSaveChannels = () => {
    setMessagingChannels({ ...chDraft, updatedAt: new Date().toISOString() });
    setChSaved(true);
    notify('success', 'تم حفظ إعدادات قنوات الرسائل');
    setTimeout(() => setChSaved(false), 3000);
  };

  const channelCards = [
    { key: 'whatsapp' as const, label: 'واتساب', color: 'bg-green-500', icon: '📱', enabled: chDraft.whatsapp.enabled },
    { key: 'messenger' as const, label: 'ماسنجر', color: 'bg-blue-600', icon: '💬', enabled: chDraft.messenger.enabled },
    { key: 'instagram' as const, label: 'إنستجرام', color: 'bg-gradient-to-br from-purple-600 to-pink-600', icon: '📸', enabled: chDraft.instagram.enabled },
    { key: 'webchat' as const, label: 'شات الموقع', color: 'bg-indigo-600', icon: '🌐', enabled: chDraft.webchat.enabled },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-gradient-to-l from-sky-700 to-blue-700 rounded-2xl p-5 text-white flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-2xl">💬</div>
          <div>
            <h2 className="text-xl font-extrabold">وكيل المراسلة 💬</h2>
            <p className="text-sky-200 text-sm mt-0.5">ربط وإدارة قنوات الرسائل + إعدادات AI الرد التلقائي</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {channelCards.map(c => (
            <div key={c.key} className={`text-xs font-bold px-3 py-1.5 rounded-full ${c.enabled ? 'bg-green-400/30 text-green-100' : 'bg-white/10 text-white/60'}`}>
              {c.icon} {c.label}: {c.enabled ? 'مفعّل' : 'معطّل'}
            </div>
          ))}
        </div>
      </div>

      {/* Channel tabs */}
      <div className="flex gap-2 flex-wrap">
        {[...channelCards.map(c => ({ key: c.key as string, label: c.icon + ' ' + c.label })), { key: 'ai_agent', label: '🤖 إعدادات AI' }].map(tab => (
          <button key={tab.key} onClick={() => setChannelTab(tab.key as typeof channelTab)}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition ${channelTab === tab.key ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* WhatsApp */}
      {channelTab === 'whatsapp' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">📱 واتساب بيزنس API</h3>
            <button onClick={() => setChDraft(p => ({ ...p, whatsapp: { ...p.whatsapp, enabled: !p.whatsapp.enabled } }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${chDraft.whatsapp.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${chDraft.whatsapp.enabled ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700">
            <strong>كيفية الإعداد:</strong> احصل على Phone Number ID و Business Account ID من Meta Business Manager → WhatsApp → API Setup
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'businessName', label: 'اسم الحساب التجاري', ph: 'معهد الدراسات النفسية', type: 'text' },
              { key: 'phoneNumberId', label: 'Phone Number ID', ph: '123456789...', type: 'text' },
              { key: 'whatsappBusinessAccountId', label: 'Business Account ID', ph: '987654321...', type: 'text' },
              { key: 'accessToken', label: 'Access Token', ph: 'EAAxxxxxx...', type: 'password' },
              { key: 'webhookVerifyToken', label: 'Webhook Verify Token', ph: 'mahad-webhook-token', type: 'text' },
            ].map(f => (
              <div key={f.key} className={f.key === 'accessToken' ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-bold text-gray-600 mb-1">{f.label}</label>
                <input type={f.type} value={(chDraft.whatsapp as unknown as Record<string, string>)[f.key] || ''} placeholder={f.ph}
                  onChange={e => setChDraft(p => ({ ...p, whatsapp: { ...p.whatsapp, [f.key]: e.target.value } as typeof p.whatsapp }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400" dir="ltr" />
              </div>
            ))}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">رسالة الترحيب</label>
              <textarea value={chDraft.whatsapp.welcomeMessage} rows={2}
                onChange={e => setChDraft(p => ({ ...p, whatsapp: { ...p.whatsapp, welcomeMessage: e.target.value } }))}
                placeholder="مرحباً! أنت الآن تتواصل مع معهد الدراسات النفسية..."
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 resize-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">رسالة الغياب</label>
              <textarea value={chDraft.whatsapp.awayMessage} rows={2}
                onChange={e => setChDraft(p => ({ ...p, whatsapp: { ...p.whatsapp, awayMessage: e.target.value } }))}
                placeholder="شكراً لتواصلك، سيرد عليك فريقنا في أقرب وقت..."
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 resize-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">رد AI التلقائي</label>
              <select value={chDraft.whatsapp.aiReplyMode}
                onChange={e => setChDraft(p => ({ ...p, whatsapp: { ...p.whatsapp, aiReplyMode: e.target.value as 'always' | 'away_only' | 'disabled' } }))}
                className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400">
                <option value="disabled">معطّل</option>
                <option value="away_only">فقط عند الغياب</option>
                <option value="always">دائماً (نشط 24/7)</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Messenger */}
      {channelTab === 'messenger' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">💬 فيسبوك ماسنجر</h3>
            <button onClick={() => setChDraft(p => ({ ...p, messenger: { ...p.messenger, enabled: !p.messenger.enabled } }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${chDraft.messenger.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${chDraft.messenger.enabled ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700">
            <strong>كيفية الإعداد:</strong> من Meta for Developers → أنشئ تطبيق → الصفحة API → احصل على Page ID و Page Access Token
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'pageId', label: 'Page ID', ph: '123456789...' },
              { key: 'pageAccessToken', label: 'Page Access Token', ph: 'EAAxxxxxx...' },
              { key: 'appSecret', label: 'App Secret', ph: 'abc123...' },
              { key: 'webhookVerifyToken', label: 'Webhook Verify Token', ph: 'mahad-token' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-bold text-gray-600 mb-1">{f.label}</label>
                <input type="text" value={(chDraft.messenger as unknown as Record<string, string>)[f.key] || ''} placeholder={f.ph}
                  onChange={e => setChDraft(p => ({ ...p, messenger: { ...p.messenger, [f.key]: e.target.value } as typeof p.messenger }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400" dir="ltr" />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">رسالة الترحيب</label>
              <textarea value={chDraft.messenger.welcomeMessage} rows={2}
                onChange={e => setChDraft(p => ({ ...p, messenger: { ...p.messenger, welcomeMessage: e.target.value } }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400 resize-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">رد AI التلقائي</label>
              <select value={chDraft.messenger.aiReplyMode}
                onChange={e => setChDraft(p => ({ ...p, messenger: { ...p.messenger, aiReplyMode: e.target.value as 'always' | 'away_only' | 'disabled' } }))}
                className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-blue-400">
                <option value="disabled">معطّل</option>
                <option value="away_only">فقط عند الغياب</option>
                <option value="always">دائماً</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Instagram */}
      {channelTab === 'instagram' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">📸 إنستجرام DM</h3>
            <button onClick={() => setChDraft(p => ({ ...p, instagram: { ...p.instagram, enabled: !p.instagram.enabled } }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${chDraft.instagram.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${chDraft.instagram.enabled ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          <div className="bg-pink-50 border border-pink-200 rounded-xl p-3 text-xs text-pink-700">
            <strong>كيفية الإعداد:</strong> من Meta for Developers → Instagram Basic Display API أو Instagram Messaging API → احصل على Instagram Account ID
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { key: 'instagramAccountId', label: 'Instagram Account ID', ph: '1234567890' },
              { key: 'accessToken', label: 'Access Token', ph: 'IGQxxxxx...' },
              { key: 'webhookVerifyToken', label: 'Webhook Verify Token', ph: 'mahad-ig-token' },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-xs font-bold text-gray-600 mb-1">{f.label}</label>
                <input type="text" value={(chDraft.instagram as unknown as Record<string, string>)[f.key] || ''} placeholder={f.ph}
                  onChange={e => setChDraft(p => ({ ...p, instagram: { ...p.instagram, [f.key]: e.target.value } as typeof p.instagram }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-pink-400" dir="ltr" />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">رسالة الترحيب</label>
              <textarea value={chDraft.instagram.welcomeMessage} rows={2}
                onChange={e => setChDraft(p => ({ ...p, instagram: { ...p.instagram, welcomeMessage: e.target.value } }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-pink-400 resize-none" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-600 mb-1">رد AI التلقائي</label>
              <select value={chDraft.instagram.aiReplyMode}
                onChange={e => setChDraft(p => ({ ...p, instagram: { ...p.instagram, aiReplyMode: e.target.value as 'always' | 'away_only' | 'disabled' } }))}
                className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-pink-400">
                <option value="disabled">معطّل</option>
                <option value="away_only">فقط عند الغياب</option>
                <option value="always">دائماً</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* WebChat */}
      {channelTab === 'webchat' && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">🌐 شات الموقع (WebChat)</h3>
            <button onClick={() => setChDraft(p => ({ ...p, webchat: { ...p.webchat, enabled: !p.webchat.enabled } }))}
              className={`relative w-12 h-6 rounded-full transition-colors ${chDraft.webchat.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${chDraft.webchat.enabled ? 'translate-x-6' : ''}`} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">عنوان الويدجت</label>
              <input type="text" value={chDraft.webchat.widgetTitle || ''}
                onChange={e => setChDraft(p => ({ ...p, webchat: { ...p.webchat, widgetTitle: e.target.value } }))}
                placeholder="تحدث معنا"
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">وصف فرعي</label>
              <input type="text" value={chDraft.webchat.widgetSubtitle || ''}
                onChange={e => setChDraft(p => ({ ...p, webchat: { ...p.webchat, widgetSubtitle: e.target.value } }))}
                placeholder="فريق الدعم جاهز لمساعدتك"
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">لون الويدجت</label>
              <div className="flex gap-2">
                <input type="color" value={chDraft.webchat.primaryColor || '#6366f1'}
                  onChange={e => setChDraft(p => ({ ...p, webchat: { ...p.webchat, primaryColor: e.target.value } }))}
                  className="w-12 h-10 rounded-lg border border-gray-300 cursor-pointer" />
                <input type="text" value={chDraft.webchat.primaryColor || '#6366f1'}
                  onChange={e => setChDraft(p => ({ ...p, webchat: { ...p.webchat, primaryColor: e.target.value } }))}
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400" dir="ltr" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">رد AI التلقائي</label>
              <select value={chDraft.webchat.aiReplyMode}
                onChange={e => setChDraft(p => ({ ...p, webchat: { ...p.webchat, aiReplyMode: e.target.value as 'always' | 'away_only' | 'disabled' } }))}
                className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400">
                <option value="disabled">معطّل</option>
                <option value="away_only">فقط عند الغياب</option>
                <option value="always">دائماً</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">رسالة الترحيب</label>
              <textarea value={chDraft.webchat.welcomeMessage} rows={2}
                onChange={e => setChDraft(p => ({ ...p, webchat: { ...p.webchat, welcomeMessage: e.target.value } }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400 resize-none" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">رسالة الغياب</label>
              <textarea value={chDraft.webchat.awayMessage || ''} rows={2}
                onChange={e => setChDraft(p => ({ ...p, webchat: { ...p.webchat, awayMessage: e.target.value } }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-400 resize-none" />
            </div>
          </div>
        </div>
      )}

      {/* AI Agent config */}
      {channelTab === 'ai_agent' && (() => {
        const [agentDraft, setAgentDraft] = React.useState<Partial<import('../../../types').AiAgentConfig>>(aiAgentConfig || {
          name: 'وكيل المعهد', enabled: false, provider: 'gemini', model: 'gemini-2.0-flash-lite',
          systemPrompt: '', temperature: 0.7, maxTokens: 800, knowledgeBase: [], enabledPages: [],
        });
        return (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-gray-900 flex items-center gap-2">🤖 وكيل AI للرد التلقائي</h3>
              <button onClick={() => setAgentDraft(p => ({ ...p, enabled: !p.enabled }))}
                className={`relative w-12 h-6 rounded-full transition-colors ${agentDraft.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${agentDraft.enabled ? 'translate-x-6' : ''}`} />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">اسم الوكيل</label>
                <input type="text" value={agentDraft.name || ''} onChange={e => setAgentDraft(p => ({ ...p, name: e.target.value }))}
                  placeholder="وكيل معهد الدراسات النفسية"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">المزود</label>
                <select value={agentDraft.provider || 'gemini'} onChange={e => setAgentDraft(p => ({ ...p, provider: e.target.value as import('../../../types').AiProvider }))}
                  className="w-full border border-gray-300 bg-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400">
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI (GPT)</option>
                  <option value="claude">Anthropic Claude</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">النموذج</label>
                <input type="text" value={agentDraft.model || ''} onChange={e => setAgentDraft(p => ({ ...p, model: e.target.value }))}
                  placeholder="gemini-2.0-flash-lite"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">مفتاح API</label>
                <input type="password" value={agentDraft.apiKey || ''} onChange={e => setAgentDraft(p => ({ ...p, apiKey: e.target.value }))}
                  placeholder="AIza... / sk-... / sk-ant-..."
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400" dir="ltr" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-gray-600 mb-1">System Prompt (تعليمات الوكيل)</label>
                <textarea value={agentDraft.systemPrompt || ''} rows={5}
                  onChange={e => setAgentDraft(p => ({ ...p, systemPrompt: e.target.value }))}
                  placeholder={'أنت وكيل ذكاء اصطناعي لمعهد الدراسات النفسية. مهمتك الرد على استفسارات العملاء بالعربية...'}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">درجة الإبداعية (Temperature) — من 0.1 إلى 1.0</label>
                <input type="number" min={0.1} max={1.0} step={0.1} value={agentDraft.temperature ?? 0.7}
                  onChange={e => setAgentDraft(p => ({ ...p, temperature: parseFloat(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">أقصى عدد رموز (Max Tokens)</label>
                <input type="number" min={100} max={4000} value={agentDraft.maxTokens ?? 800}
                  onChange={e => setAgentDraft(p => ({ ...p, maxTokens: parseInt(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400" dir="ltr" />
              </div>
            </div>
            <button
              onClick={() => {
                setAiAgentConfig({
                  id: aiAgentConfig?.id || `agent-${Date.now()}`,
                  name: agentDraft.name || 'وكيل المعهد',
                  provider: (agentDraft.provider || 'gemini') as import('../../../types').AiProvider,
                  apiKey: agentDraft.apiKey || '',
                  model: agentDraft.model || 'gemini-2.0-flash-lite',
                  systemPrompt: agentDraft.systemPrompt || '',
                  temperature: agentDraft.temperature ?? 0.7,
                  maxTokens: agentDraft.maxTokens ?? 800,
                  enabled: agentDraft.enabled ?? false,
                  enabledPages: agentDraft.enabledPages || [],
                  knowledgeBase: agentDraft.knowledgeBase || [],
                  updatedAt: new Date().toISOString(),
                });
                notify('success', 'تم حفظ إعدادات وكيل AI');
              }}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white font-bold px-5 py-2.5 rounded-xl transition text-sm"
            >
              <Save size={15} /> حفظ إعدادات الوكيل
            </button>
          </div>
        );
      })()}

      {/* Save main channels button */}
      {channelTab !== 'ai_agent' && (
        <div className="flex items-center gap-3">
          <button onClick={handleSaveChannels}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-3 rounded-xl transition">
            <Save size={16} /> {chSaved ? '✅ تم الحفظ' : 'حفظ الإعدادات'}
          </button>
          <p className="text-xs text-gray-400">التغييرات تُحفظ في MySQL وتظهر فوراً</p>
        </div>
      )}
    </div>
  );
}
