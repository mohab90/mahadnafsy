import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquare, Plus, Send, Trash2, CheckCircle, Clock, RefreshCw, Phone } from 'lucide-react';
import { adminAuthHeaders } from '../../../lib/adminAuthHeaders';
import { useSiteData } from '../../../context/SiteDataContext';

type NotifyFn = (type: 'success' | 'error' | 'info', text: string) => void;

interface SmsCampaign {
  id: string;
  title: string;
  message: string;
  status: 'draft' | 'sending' | 'sent' | 'failed';
  sent_count: number;
  fail_count: number;
  audience: string;
  created_at: string;
  sent_at?: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'مسودة', sending: 'يُرسل...', sent: 'مُرسلة', failed: 'فشل',
};
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sending: 'bg-blue-100 text-blue-700',
  sent: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-600',
};

export default function SmsCampaignsTab({ notify }: { notify: NotifyFn }) {
  const { leads, subscribers } = useSiteData();
  const [campaigns, setCampaigns] = useState<SmsCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'new'>('list');
  const [newC, setNewC] = useState({ title: '', message: '', audience: 'all' });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sms-campaigns`, { credentials: 'include', headers: adminAuthHeaders() });
      if (res.ok) setCampaigns(await res.json());
    } catch { notify('error', 'تعذّر تحميل الحملات'); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => ({
    total: campaigns.length,
    sent: campaigns.filter(c => c.status === 'sent').length,
    totalSent: campaigns.reduce((a, c) => a + (c.sent_count || 0), 0),
    failed: campaigns.reduce((a, c) => a + (c.fail_count || 0), 0),
  }), [campaigns]);

  const MAX_SMS_LENGTH = 160;

  const audienceOptions = [
    { value: 'all', label: `كل المشتركين والليدات (${subscribers.length + leads.length})` },
    { value: 'subscribers', label: `المشتركون (${subscribers.length})` },
    { value: 'leads', label: `الليدات (${leads.length})` },
  ];

  async function saveDraft() {
    if (!newC.title.trim()) { notify('error', 'أدخل اسم الحملة'); return; }
    if (!newC.message.trim()) { notify('error', 'اكتب نص الرسالة'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/sms-campaigns`, {
        method: 'POST', credentials: 'include',
        headers: adminAuthHeaders(true),
        body: JSON.stringify(newC),
      });
      if (res.ok) {
        notify('success', 'تم حفظ الحملة كمسودة');
        setNewC({ title: '', message: '', audience: 'all' });
        setView('list');
        load();
      } else notify('error', 'فشل الحفظ');
    } catch { notify('error', 'خطأ في الاتصال'); }
    setSaving(false);
  }

  async function sendCampaign(id: string) {
    setSending(id);
    try {
      const res = await fetch(`/api/admin/sms-campaigns/${id}/send`, {
        method: 'POST', credentials: 'include', headers: adminAuthHeaders(),
      });
      const data = await res.json();
      if (res.ok) { notify('success', `تم الإرسال: ${data.totalCount} رسالة`); load(); }
      else notify('error', data.error || 'فشل الإرسال');
    } catch { notify('error', 'خطأ في الاتصال'); }
    setSending(null);
  }

  async function deleteCampaign(id: string) {
    try {
      const res = await fetch(`/api/admin/sms-campaigns/${id}`, { method: 'DELETE', credentials: 'include', headers: adminAuthHeaders() });
      if (res.ok) { notify('success', 'تم الحذف'); load(); }
    } catch { notify('error', 'خطأ في الحذف'); }
  }

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-green-600 to-teal-600 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><MessageSquare size={22} />حملات SMS</h2>
            <p className="text-green-100 text-sm mt-1">إنشاء وإرسال حملات الرسائل النصية</p>
          </div>
          <button onClick={() => { setView(v => v === 'list' ? 'new' : 'list'); if (view === 'new') load(); }}
            className="flex items-center gap-2 px-4 py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-bold transition">
            {view === 'list' ? <><Plus size={16} />حملة جديدة</> : <><MessageSquare size={16} />عرض الحملات</>}
          </button>
        </div>
      </div>

      {view === 'list' ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'إجمالي الحملات', val: stats.total, color: 'green' },
              { label: 'تم إرسالها', val: stats.sent, color: 'emerald' },
              { label: 'إجمالي المُرسَل', val: stats.totalSent.toLocaleString(), color: 'blue' },
              { label: 'فشل الإرسال', val: stats.failed, color: 'red' },
            ].map(k => (
              <div key={k.label} className={`bg-${k.color}-50 border border-${k.color}-100 rounded-2xl p-4 text-center`}>
                <div className="text-xl font-extrabold text-gray-900">{k.val}</div>
                <div className="text-xs text-gray-500 mt-1">{k.label}</div>
              </div>
            ))}
          </div>

          {/* Campaigns */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-gray-100"><h3 className="font-bold text-gray-800">الحملات</h3></div>
            <div className="divide-y divide-gray-50">
              {loading && <div className="p-10 text-center text-gray-400"><RefreshCw size={20} className="animate-spin mx-auto mb-2" />جاري التحميل...</div>}
              {!loading && campaigns.map(c => (
                <div key={c.id} className="flex items-start gap-4 px-4 py-4 hover:bg-gray-50 transition">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${STATUS_COLOR[c.status]}`}>
                    <MessageSquare size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-800">{c.title}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLOR[c.status]}`}>{STATUS_LABEL[c.status]}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{c.message}</div>
                    <div className="flex items-center gap-3 mt-2 flex-wrap text-[10px] text-gray-400">
                      {c.sent_count > 0 && <span className="text-emerald-600">✓ {c.sent_count.toLocaleString()} مُرسَل</span>}
                      {c.fail_count > 0 && <span className="text-red-500">✗ {c.fail_count} فشل</span>}
                      <span><Clock size={9} className="inline ml-1" />{(c.sent_at || c.created_at || '').slice(0, 10)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                    {c.status === 'draft' && (
                      <button onClick={() => sendCampaign(c.id)} disabled={sending === c.id}
                        className="p-1.5 text-green-500 hover:bg-green-50 rounded-lg transition disabled:opacity-40" title="إرسال">
                        {sending === c.id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                      </button>
                    )}
                    <button onClick={() => deleteCampaign(c.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg transition"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
              {campaigns.length === 0 && (
                <div className="p-10 text-center text-gray-400"><MessageSquare size={32} className="mx-auto mb-3 text-gray-200" /><p>لا توجد حملات</p></div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* New campaign form */
        <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><Plus size={16} className="text-green-500" />حملة SMS جديدة</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">اسم الحملة</label>
              <input value={newC.title} onChange={e => setNewC(c => ({ ...c, title: e.target.value }))}
                placeholder="رسالة ترحيب"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">الجمهور المستهدف</label>
              <select value={newC.audience} onChange={e => setNewC(c => ({ ...c, audience: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-300">
                {audienceOptions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1 flex items-center justify-between">
                <span>نص الرسالة</span>
                <span className={`text-xs ${newC.message.length > MAX_SMS_LENGTH ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                  {newC.message.length}/{MAX_SMS_LENGTH}
                </span>
              </label>
              <textarea value={newC.message} onChange={e => setNewC(c => ({ ...c, message: e.target.value }))}
                rows={4} placeholder="اكتب نص الرسالة النصية هنا..."
                className={`w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 resize-none ${newC.message.length > MAX_SMS_LENGTH ? 'border-red-300 focus:ring-red-300' : 'border-gray-300 focus:ring-green-300'}`} />
              {newC.message.length > MAX_SMS_LENGTH && (
                <p className="text-red-500 text-xs mt-1">الرسالة تتجاوز {MAX_SMS_LENGTH} حرف (ستُرسل على جزأين)</p>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={saveDraft} disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition disabled:opacity-50">
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              حفظ كمسودة
            </button>
            <button onClick={() => { setView('list'); load(); }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl text-sm hover:bg-gray-200 transition">إلغاء</button>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-green-700 text-xs">
            <strong>ملاحظة:</strong> الإرسال الفعلي يتطلب ضبط إعدادات SMS أولاً من صفحة "إعدادات SMS".
          </div>
        </div>
      )}
    </div>
  );
}
