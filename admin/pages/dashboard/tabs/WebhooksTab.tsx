import React, { useMemo, useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, CheckCircle, XCircle, Clock, RefreshCw, Send, Globe } from 'lucide-react';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
interface Props { notify: NotifyFn; }

type EventType = 'new_lead' | 'lead_converted' | 'new_subscriber' | 'new_payment' | 'new_order' | 'refund_requested' | 'new_consultation' | 'new_contact' | 'new_join_us';
type DeliveryStatus = 'success' | 'failed' | 'pending';

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: EventType[];
  active: boolean;
  secret?: string;
  createdAt: string;
  lastTriggeredAt?: string;
  successCount: number;
  failCount: number;
}

interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: EventType;
  status: DeliveryStatus;
  statusCode?: number;
  responseTime?: number;
  at: string;
  payload?: string;
  error?: string;
}

const LS_WH_KEY = 'mahad_webhooks_v1';
const LS_DEL_KEY = 'mahad_webhook_deliveries_v1';
function loadWH(): WebhookConfig[] { try { return JSON.parse(localStorage.getItem(LS_WH_KEY) || '[]'); } catch { return []; } }
function saveWH(items: WebhookConfig[]) { localStorage.setItem(LS_WH_KEY, JSON.stringify(items)); }
function loadDel(): WebhookDelivery[] { try { return JSON.parse(localStorage.getItem(LS_DEL_KEY) || '[]'); } catch { return []; } }
function saveDel(items: WebhookDelivery[]) { localStorage.setItem(LS_DEL_KEY, JSON.stringify(items)); }

const EVENT_LABELS: Record<EventType, string> = {
  new_lead: '🟢 ليد جديد', lead_converted: '🔄 ليد محوَّل', new_subscriber: '👤 مشترك جديد',
  new_payment: '💳 دفعة جديدة', new_order: '📦 طلب جديد', refund_requested: '🔙 طلب استرداد',
  new_consultation: '🩺 استشارة جديدة', new_contact: '✉️ رسالة تواصل', new_join_us: '👔 طلب انضمام',
};

const ALL_EVENTS = Object.keys(EVENT_LABELS) as EventType[];

function seedDeliveries(): WebhookDelivery[] {
  const statuses: DeliveryStatus[] = ['success', 'success', 'success', 'failed', 'success', 'pending'];
  return Array.from({ length: 12 }, (_, i) => ({
    id: String(i + 1), webhookId: '1', event: ALL_EVENTS[i % ALL_EVENTS.length],
    status: statuses[i % statuses.length],
    statusCode: statuses[i % statuses.length] === 'success' ? 200 : statuses[i % statuses.length] === 'failed' ? 500 : undefined,
    responseTime: statuses[i % statuses.length] !== 'pending' ? Math.round(Math.random() * 400 + 100) : undefined,
    at: new Date(Date.now() - i * 3600000 * 2).toISOString(),
    payload: JSON.stringify({ event: ALL_EVENTS[i % ALL_EVENTS.length], timestamp: Date.now(), data: { id: `${1000 + i}` } }),
  }));
}

const WebhooksTab: React.FC<Props> = ({ notify }) => {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>(() => loadWH());
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>(() => {
    const d = loadDel();
    return d.length > 0 ? d : seedDeliveries();
  });
  const [view, setView] = useState<'list' | 'log'>('list');
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<WebhookConfig>>({});
  const [draftEvents, setDraftEvents] = useState<EventType[]>([]);
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);

  useEffect(() => { saveWH(webhooks); }, [webhooks]);
  useEffect(() => { saveDel(deliveries); }, [deliveries]);

  const stats = useMemo(() => ({
    total: deliveries.length,
    success: deliveries.filter(d => d.status === 'success').length,
    failed: deliveries.filter(d => d.status === 'failed').length,
    pending: deliveries.filter(d => d.status === 'pending').length,
    successRate: deliveries.length > 0 ? Math.round(deliveries.filter(d => d.status === 'success').length / deliveries.length * 100) : 0,
    avgResponseTime: deliveries.filter(d => d.responseTime).length > 0
      ? Math.round(deliveries.filter(d => d.responseTime).reduce((s, d) => s + (d.responseTime || 0), 0) / deliveries.filter(d => d.responseTime).length)
      : 0,
  }), [deliveries]);

  const saveWebhook = () => {
    if (!draft.name?.trim() || !draft.url?.trim()) { notify('error', 'أدخل الاسم والرابط'); return; }
    if (!draft.url.startsWith('https://')) { notify('error', 'يجب أن يبدأ الرابط بـ https://'); return; }
    if (draftEvents.length === 0) { notify('error', 'اختر حدثاً واحداً على الأقل'); return; }
    if (editId) {
      setWebhooks(prev => prev.map(w => w.id === editId ? { ...w, ...draft, events: draftEvents } : w));
      setEditId(null);
    } else {
      const wh: WebhookConfig = {
        id: Date.now().toString(), name: draft.name!, url: draft.url!, events: draftEvents,
        active: true, secret: draft.secret, createdAt: new Date().toISOString(), successCount: 0, failCount: 0,
      };
      setWebhooks(prev => [wh, ...prev]);
    }
    setDraft({}); setDraftEvents([]); setShowAdd(false);
    notify('success', 'تم حفظ الـ Webhook');
  };

  const simulateTrigger = (wh: WebhookConfig) => {
    const event = wh.events[0];
    const success = Math.random() > 0.2;
    const delivery: WebhookDelivery = {
      id: Date.now().toString(), webhookId: wh.id, event,
      status: success ? 'success' : 'failed',
      statusCode: success ? 200 : 500,
      responseTime: Math.round(Math.random() * 500 + 100),
      at: new Date().toISOString(),
      payload: JSON.stringify({ event, timestamp: Date.now(), data: { test: true } }),
      error: success ? undefined : 'Internal Server Error',
    };
    setDeliveries(prev => [delivery, ...prev]);
    setWebhooks(prev => prev.map(w => w.id === wh.id ? {
      ...w, lastTriggeredAt: new Date().toISOString(),
      successCount: success ? w.successCount + 1 : w.successCount,
      failCount: success ? w.failCount : w.failCount + 1,
    } : w));
    notify(success ? 'success' : 'error', success ? 'تم اختبار الـ Webhook بنجاح' : 'فشل الاختبار - تحقق من الرابط');
  };

  const toggleEvent = (e: EventType) => {
    setDraftEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  };

  const statusCfg = {
    success: { icon: <CheckCircle size={13} />, color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
    failed: { icon: <XCircle size={13} />, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
    pending: { icon: <Clock size={13} />, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-purple-700 to-violet-600 rounded-2xl p-5 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><Globe size={22} /> إدارة Webhooks</h2>
            <p className="text-purple-200 text-sm mt-0.5">ربط أحداث النظام بخدمات خارجية</p>
          </div>
          <button onClick={() => { setShowAdd(true); setDraft({}); setDraftEvents([]); setEditId(null); }}
            className="flex items-center gap-2 bg-white text-purple-700 font-bold px-4 py-2 rounded-xl hover:bg-purple-50 text-sm">
            <Plus size={16} /> Webhook جديد
          </button>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mt-4">
          {[
            { label: 'Webhooks', value: webhooks.length },
            { label: 'إجمالي الإرسال', value: stats.total, bg: 'bg-white/15' },
            { label: 'ناجح', value: stats.success, bg: 'bg-green-500/25' },
            { label: 'فاشل', value: stats.failed, bg: stats.failed > 0 ? 'bg-red-500/25' : 'bg-white/10' },
            { label: 'نسبة النجاح', value: `${stats.successRate}%`, bg: stats.successRate >= 90 ? 'bg-green-500/25' : 'bg-amber-500/25' },
          ].map(s => (
            <div key={s.label} className={`${s.bg || 'bg-white/15'} rounded-xl p-2 text-center`}>
              <div className="text-xl font-black">{s.value}</div>
              <div className="text-xs text-purple-200">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit form */}
      {(showAdd || editId) && (
        <div className="bg-white border border-purple-200 rounded-2xl p-4 shadow-sm space-y-3">
          <h3 className="font-bold text-gray-800">{editId ? 'تعديل Webhook' : 'Webhook جديد'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input value={draft.name || ''} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
              placeholder="اسم الـ Webhook *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            <input value={draft.url || ''} onChange={e => setDraft(p => ({ ...p, url: e.target.value }))}
              placeholder="https://yourapp.com/webhook *" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" dir="ltr" />
            <input value={draft.secret || ''} onChange={e => setDraft(p => ({ ...p, secret: e.target.value }))}
              placeholder="Secret Key (اختياري)" className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" dir="ltr" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">الأحداث المُرسَلة:</p>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map(e => (
                <button key={e} onClick={() => toggleEvent(e)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${draftEvents.includes(e) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:border-purple-400'}`}>
                  {EVENT_LABELS[e]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveWebhook} className="bg-purple-600 text-white px-5 py-2 rounded-xl font-bold text-sm hover:bg-purple-700">حفظ</button>
            <button onClick={() => { setShowAdd(false); setEditId(null); setDraft({}); setDraftEvents([]); }} className="bg-gray-100 text-gray-600 px-5 py-2 rounded-xl font-bold text-sm hover:bg-gray-200">إلغاء</button>
          </div>
        </div>
      )}

      {/* View toggle */}
      <div className="flex gap-2">
        {([['list', '⚙️ Webhooks مضبوطة'], ['log', '📋 سجل الإرسال']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setView(k)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${view === k ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {view === 'list' && (
        webhooks.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Globe size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">لا Webhooks مضبوطة</p>
            <p className="text-sm mt-1">أضف Webhook لربط النظام بخدمات خارجية مثل Zapier أو n8n أو تطبيقاتك</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(wh => (
              <div key={wh.id} className={`bg-white border rounded-2xl p-4 shadow-sm ${wh.active ? 'border-gray-200' : 'border-gray-100 opacity-60'}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-gray-800">{wh.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${wh.active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                        {wh.active ? '● نشط' : '⏸ متوقف'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 font-mono truncate" dir="ltr">{wh.url}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {wh.events.map(e => (
                        <span key={e} className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">{EVENT_LABELS[e]}</span>
                      ))}
                    </div>
                    {wh.lastTriggeredAt && (
                      <p className="text-xs text-gray-400 mt-1">آخر إرسال: {wh.lastTriggeredAt.slice(0, 16).replace('T', ' ')}</p>
                    )}
                    <div className="flex gap-3 text-xs text-gray-400 mt-1">
                      <span className="text-green-600">✓ {wh.successCount} ناجح</span>
                      <span className="text-red-500">✗ {wh.failCount} فاشل</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => simulateTrigger(wh)} title="اختبار"
                      className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1.5 rounded-lg hover:bg-indigo-100 border border-indigo-200 flex items-center gap-1">
                      <Send size={11} /> اختبار
                    </button>
                    <button onClick={() => {
                      setEditId(wh.id);
                      setDraft({ name: wh.name, url: wh.url, secret: wh.secret });
                      setDraftEvents([...wh.events]);
                      setShowAdd(false);
                    }} className="text-gray-400 hover:text-purple-500"><Edit2 size={14} /></button>
                    <button onClick={() => setWebhooks(prev => prev.map(w => w.id === wh.id ? { ...w, active: !w.active } : w))}
                      className={`text-xs px-2 py-1 rounded-lg border transition-colors ${wh.active ? 'border-amber-200 text-amber-600 hover:bg-amber-50' : 'border-green-200 text-green-600 hover:bg-green-50'}`}>
                      {wh.active ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button onClick={() => { setWebhooks(prev => prev.filter(w => w.id !== wh.id)); notify('success', 'تم الحذف'); }}
                      className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {view === 'log' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-bold text-gray-800">سجل الإرسال ({deliveries.length})</h3>
            <button onClick={() => { setDeliveries(seedDeliveries()); notify('info', 'تم تحديث السجل'); }}
              className="text-xs text-gray-500 hover:text-purple-600 flex items-center gap-1"><RefreshCw size={12} /> تحديث</button>
          </div>
          <div className="divide-y divide-gray-50">
            {deliveries.slice(0, 50).map(d => {
              const cfg = statusCfg[d.status];
              const wh = webhooks.find(w => w.id === d.webhookId);
              const isExp = expandedDelivery === d.id;
              return (
                <div key={d.id}>
                  <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-right transition-colors"
                    onClick={() => setExpandedDelivery(isExp ? null : d.id)}>
                    <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${cfg.bg} ${cfg.color} shrink-0`}>
                      {cfg.icon} {d.status === 'success' ? 'ناجح' : d.status === 'failed' ? 'فاشل' : 'جارٍ'}
                    </span>
                    <span className="text-xs text-purple-600 shrink-0">{EVENT_LABELS[d.event]}</span>
                    <span className="text-xs text-gray-400 flex-1 truncate">{wh?.name || 'webhook'}</span>
                    {d.statusCode && <span className="text-xs font-mono text-gray-500 shrink-0">{d.statusCode}</span>}
                    {d.responseTime && <span className="text-xs text-gray-400 shrink-0">{d.responseTime}ms</span>}
                    <span className="text-xs text-gray-400 shrink-0">{d.at.slice(0, 16).replace('T', ' ')}</span>
                  </button>
                  {isExp && (
                    <div className="px-4 pb-3 space-y-2 border-t border-gray-50">
                      {d.error && <div className="bg-red-50 rounded-lg p-2 text-xs text-red-700">خطأ: {d.error}</div>}
                      {d.payload && (
                        <div className="bg-gray-50 rounded-lg p-2">
                          <p className="text-xs text-gray-400 mb-1">البيانات المُرسَلة:</p>
                          <pre className="text-xs text-gray-700 overflow-x-auto" dir="ltr">{JSON.stringify(JSON.parse(d.payload), null, 2)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default WebhooksTab;
