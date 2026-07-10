import React, { useState, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';

const API_SUPPORT = import.meta.env.VITE_API_URL || 'https://mahadnafsy.com/api';

const TICKET_CATEGORIES: [string, string][] = [
  ['general', 'استفسار عام'], ['technical', 'مشكلة تقنية'], ['course_access', 'الوصول للدورة'],
  ['billing', 'مدفوعات وفواتير'], ['certificate', 'شهادات'], ['consultation', 'استشارة'], ['complaint', 'شكوى'],
];
const STATUS_LABELS: Record<string, string> = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'محلولة', closed: 'مغلقة' };
const STATUS_COLORS: Record<string, string> = { open: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700', resolved: 'bg-green-100 text-green-700', closed: 'bg-gray-100 text-gray-600' };
const fmtDate = (s: string) => { try { return new Date(String(s).replace(' ', 'T')).toLocaleDateString('ar-EG-u-nu-latn'); } catch { return ''; } };

export function SupportTab({ token }: { token: string }) {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ subject: '', body: '', category: 'general' });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busy, setBusy] = useState(false);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = async () => {
    setLoading(true);
    try { const r = await fetch(`${API_SUPPORT}/me/tickets`, { headers }); if (r.ok) setTickets(await r.json()); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openTicket = async (id: string) => {
    try { const r = await fetch(`${API_SUPPORT}/me/tickets/${id}`, { headers }); if (r.ok) setDetail(await r.json()); } catch { /* ignore */ }
  };

  const submit = async () => {
    if (!form.subject.trim() || !form.body.trim()) { showToast('يرجى ملء العنوان والرسالة'); return; }
    setSubmitting(true);
    const r = await fetch(`${API_SUPPORT}/me/tickets`, { method: 'POST', headers, body: JSON.stringify(form) });
    setSubmitting(false);
    if (r.ok) { showToast('تم إرسال تذكرتك بنجاح ✅'); setForm({ subject: '', body: '', category: 'general' }); load(); }
    else showToast('حدث خطأ، يرجى المحاولة مرة أخرى');
  };

  const sendReply = async () => {
    if (!detail || !replyText.trim()) return;
    setBusy(true);
    const r = await fetch(`${API_SUPPORT}/me/tickets/${detail.id}/reply`, { method: 'POST', headers, body: JSON.stringify({ body: replyText }) });
    setBusy(false);
    if (r.ok) { setReplyText(''); openTicket(detail.id); load(); showToast('تم إرسال ردك ✅'); }
    else showToast('حدث خطأ، حاول مرة أخرى');
  };

  return (
    <div className="max-w-2xl space-y-5">
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 shadow-lg rounded-xl px-6 py-3 text-sm font-medium">{toast}</div>}

      {/* New ticket */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
        <h3 className="font-bold text-gray-900 text-base flex items-center gap-2"><MessageSquare size={18} className="text-purple-600" /> فتح تذكرة دعم جديدة</h3>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">نوع المشكلة</label>
          <select className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none bg-white"
            value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {TICKET_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">موضوع المشكلة</label>
          <input className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none"
            value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="مثال: مشكلة في تشغيل الفيديو" />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">تفاصيل المشكلة</label>
          <textarea className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-300 outline-none" rows={4}
            value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="اشرح المشكلة بالتفصيل..." />
        </div>
        <button onClick={submit} disabled={submitting} className="w-full bg-purple-600 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-purple-700 disabled:opacity-50 transition">
          {submitting ? 'جاري الإرسال...' : 'إرسال التذكرة'}
        </button>
      </div>

      {/* Ticket list */}
      <div>
        <h3 className="font-bold text-gray-700 text-sm mb-3">تذاكرك السابقة</h3>
        {loading ? (
          <div className="text-center py-8 text-gray-400 text-sm">جاري التحميل...</div>
        ) : tickets.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm bg-gray-50 rounded-2xl border border-dashed border-gray-200">لا توجد تذاكر سابقة</div>
        ) : (
          <div className="space-y-3">
            {tickets.map((t: any) => (
              <button key={t.id} onClick={() => openTicket(t.id)}
                className="w-full text-right bg-white rounded-xl border border-gray-200 p-4 shadow-sm hover:border-purple-300 hover:bg-purple-50/30 transition">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{t.subject}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{fmtDate(t.created_at)}</p>
                    {t.reply_count > 0 && <p className="text-xs text-purple-600 mt-0.5">💬 {t.reply_count} رد</p>}
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium flex-shrink-0 ${STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[t.status] || t.status}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Ticket conversation drawer */}
      {detail && (
        <div className="fixed inset-0 z-50 flex justify-center items-end sm:items-center" dir="rtl">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-2xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-bold text-gray-900">{detail.subject}</h4>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[detail.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[detail.status] || detail.status}</span>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
            </div>
            {/* Original message */}
            <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-700 whitespace-pre-wrap">{detail.body}</div>
            {/* Conversation */}
            {(detail.replies || []).map((rp: any, i: number) => (
              <div key={i} className={`rounded-xl p-3 text-sm ${rp.author_type === 'subscriber' ? 'bg-purple-50 mr-6' : 'bg-indigo-50 ml-6'}`}>
                <div className="text-[10px] text-gray-400 mb-0.5">{rp.author_type === 'subscriber' ? 'أنت' : rp.author_name || 'الدعم'} · {fmtDate(rp.created_at)}</div>
                <div className="text-gray-700 whitespace-pre-wrap">{rp.body}</div>
              </div>
            ))}
            {/* Reply box */}
            {detail.status !== 'closed' && (
              <div className="flex items-end gap-2 pt-1 sticky bottom-0 bg-white">
                <textarea value={replyText} onChange={e => setReplyText(e.target.value)} rows={2} placeholder="اكتب رداً..." className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-purple-300 outline-none" />
                <button disabled={busy || !replyText.trim()} onClick={sendReply} className="bg-purple-600 text-white rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-40">إرسال</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
