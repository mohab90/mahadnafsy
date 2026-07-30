import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Edit2, Globe, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;
type EventType = 'new_lead' | 'lead_converted' | 'new_subscriber' | 'new_payment' | 'new_order' | 'refund_requested' | 'new_consultation' | 'new_contact' | 'new_join_us';

interface WebhookConfig {
  id: string;
  name: string;
  url: string;
  events: EventType[];
  is_active: number | boolean;
  last_triggered_at?: string | null;
  last_status?: number | null;
  created_at: string;
}

interface Draft {
  name: string;
  url: string;
  secret: string;
  events: EventType[];
  is_active: boolean;
}

const EMPTY_DRAFT: Draft = { name: '', url: '', secret: '', events: [], is_active: true };
const EVENT_LABELS: Record<EventType, string> = {
  new_lead: 'ليد جديد',
  lead_converted: 'تحويل ليد',
  new_subscriber: 'مشترك جديد',
  new_payment: 'دفعة جديدة',
  new_order: 'طلب جديد',
  refund_requested: 'طلب استرداد',
  new_consultation: 'استشارة جديدة',
  new_contact: 'رسالة تواصل',
  new_join_us: 'طلب انضمام',
};

const WebhooksTab: React.FC<{ notify: NotifyFn }> = ({ notify }) => {
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWebhooks(await mysqlAdmin.adminGet<WebhookConfig[]>('/admin/webhooks'));
    } catch {
      notify('error', 'تعذر تحميل Webhooks من السيرفر');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => ({
    total: webhooks.length,
    active: webhooks.filter((item) => Boolean(item.is_active)).length,
    healthy: webhooks.filter((item) => Number(item.last_status) >= 200 && Number(item.last_status) < 300).length,
    failed: webhooks.filter((item) => item.last_status !== null && item.last_status !== undefined &&
      (Number(item.last_status) < 200 || Number(item.last_status) >= 300)).length,
  }), [webhooks]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormOpen(true);
  };

  const openEdit = (item: WebhookConfig) => {
    setEditingId(item.id);
    setDraft({
      name: item.name,
      url: item.url,
      secret: '',
      events: item.events || [],
      is_active: Boolean(item.is_active),
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!draft.name.trim() || !draft.url.trim()) {
      notify('error', 'أدخل الاسم والرابط');
      return;
    }
    if (!draft.url.startsWith('https://') || draft.events.length === 0) {
      notify('error', 'الرابط يجب أن يبدأ بـ https:// ويجب اختيار حدث واحد على الأقل');
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await mysqlAdmin.adminPut(`/admin/webhooks/${encodeURIComponent(editingId)}`, draft);
      } else {
        await mysqlAdmin.adminPost('/admin/webhooks', { ...draft });
      }
      await load();
      setFormOpen(false);
      notify('success', 'تم حفظ Webhook في قاعدة البيانات');
    } catch {
      notify('error', 'فشل حفظ Webhook');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: WebhookConfig) => {
    if (!window.confirm(`حذف Webhook "${item.name}"؟`)) return;
    try {
      await mysqlAdmin.adminDelete(`/admin/webhooks/${encodeURIComponent(item.id)}`);
      setWebhooks((prev) => prev.filter((row) => row.id !== item.id));
      notify('success', 'تم حذف Webhook');
    } catch {
      notify('error', 'فشل حذف Webhook');
    }
  };

  const test = async (item: WebhookConfig) => {
    setTestingId(item.id);
    try {
      const result = await mysqlAdmin.adminPost<{ ok: boolean; status: number }>(
        `/admin/webhooks/${encodeURIComponent(item.id)}/test`, {},
      );
      await load();
      notify(result.status >= 200 && result.status < 300 ? 'success' : 'error',
        `استجاب الطرف الآخر بالحالة HTTP ${result.status}`);
    } catch {
      await load();
      notify('error', 'فشل اختبار Webhook أو انتهت المهلة');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="bg-gradient-to-l from-purple-700 to-violet-600 rounded-2xl p-5 text-white flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2"><Globe size={22} />إدارة Webhooks</h2>
          <p className="text-purple-200 text-sm mt-1">إعدادات واختبارات فعلية محفوظة لكل مؤسسة</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading} className="p-2.5 bg-white/15 rounded-xl disabled:opacity-50" aria-label="تحديث">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={openCreate} className="flex items-center gap-2 bg-white text-purple-700 font-bold px-4 py-2 rounded-xl">
            <Plus size={16} />Webhook جديد
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['الإجمالي', stats.total],
          ['النشط', stats.active],
          ['آخر اختبار ناجح', stats.healthy],
          ['آخر اختبار فاشل', stats.failed],
        ].map(([label, value]) => (
          <div key={String(label)} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
            <div className="text-2xl font-extrabold">{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {formOpen && (
        <div className="bg-white border border-purple-200 rounded-2xl p-5 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <input value={draft.name} onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="اسم Webhook" className="border rounded-xl px-3 py-2" />
            <input value={draft.url} onChange={(e) => setDraft((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="https://example.com/webhook" dir="ltr" className="border rounded-xl px-3 py-2" />
            <input value={draft.secret} onChange={(e) => setDraft((prev) => ({ ...prev, secret: e.target.value }))}
              placeholder={editingId ? 'Secret جديد (اتركه فارغاً للاحتفاظ بالحالي)' : 'Secret اختياري'}
              type="password" dir="ltr" className="border rounded-xl px-3 py-2 md:col-span-2" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(EVENT_LABELS) as EventType[]).map((event) => (
              <button key={event} onClick={() => setDraft((prev) => ({
                ...prev,
                events: prev.events.includes(event) ? prev.events.filter((item) => item !== event) : [...prev.events, event],
              }))} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${draft.events.includes(event) ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-600'}`}>
                {EVENT_LABELS[event]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft((prev) => ({ ...prev, is_active: e.target.checked }))} />
            نشط
          </label>
          <div className="flex gap-2">
            <button onClick={() => void save()} disabled={saving} className="bg-purple-600 text-white px-5 py-2 rounded-xl font-bold disabled:opacity-50">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
            <button onClick={() => setFormOpen(false)} className="bg-gray-100 px-5 py-2 rounded-xl">إلغاء</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {!loading && webhooks.length === 0 && <div className="bg-white border rounded-2xl p-10 text-center text-gray-400">لا توجد Webhooks.</div>}
        {webhooks.map((item) => {
          const healthy = Number(item.last_status) >= 200 && Number(item.last_status) < 300;
          return (
            <div key={item.id} className="bg-white border border-gray-200 rounded-2xl p-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[240px]">
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${item.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  <h3 className="font-bold">{item.name}</h3>
                </div>
                <p className="text-xs text-gray-500 mt-1 break-all" dir="ltr">{item.url}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {(item.events || []).map((event) => EVENT_LABELS[event] || event).join('، ')}
                </p>
              </div>
              <div className="text-xs min-w-[120px]">
                {item.last_status === null || item.last_status === undefined ? (
                  <span className="text-gray-400">لم يُختبر بعد</span>
                ) : healthy ? (
                  <span className="text-green-700 flex items-center gap-1"><CheckCircle size={14} />HTTP {item.last_status}</span>
                ) : (
                  <span className="text-red-700 flex items-center gap-1"><XCircle size={14} />HTTP {item.last_status || 0}</span>
                )}
                {item.last_triggered_at && <div className="text-gray-400 mt-1">{new Date(item.last_triggered_at).toLocaleString('ar-EG')}</div>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => void test(item)} disabled={testingId === item.id} className="p-2 bg-green-50 text-green-700 rounded-lg disabled:opacity-50" aria-label="اختبار">
                  <Send size={15} />
                </button>
                <button onClick={() => openEdit(item)} className="p-2 bg-blue-50 text-blue-700 rounded-lg" aria-label="تعديل"><Edit2 size={15} /></button>
                <button onClick={() => void remove(item)} className="p-2 bg-red-50 text-red-700 rounded-lg" aria-label="حذف"><Trash2 size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WebhooksTab;
