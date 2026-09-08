import React from 'react';
import { MessageSquare } from 'lucide-react';

const API_SUPPORT = import.meta.env.VITE_API_URL || '/api';

type SupportTicket = {
  id: string;
  subject: string;
  status: string;
  created_at: string;
  reply_count?: number;
};

type TicketReply = {
  author_type: string;
  author_name: string;
  body: string;
  created_at: string;
};

type TicketThread = SupportTicket & { body: string; replies: TicketReply[] };

// The reply the POST echoes back says CLIENT, the stored rows say CLIENT, and
// older rows said 'subscriber'. All three mean the person reading this page.
const isFromCustomer = (authorType: string) =>
  ['client', 'subscriber'].includes(String(authorType || '').toLowerCase());

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة',
  in_progress: 'قيد المعالجة',
  resolved: 'محلولة',
  closed: 'مغلقة',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};

export function StudentSupportTab() {
  const [tickets, setTickets] = React.useState<SupportTicket[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState({ subject: '', body: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [openId, setOpenId] = React.useState('');
  const [thread, setThread] = React.useState<TicketThread | null>(null);
  const [threadLoading, setThreadLoading] = React.useState(false);
  const [reply, setReply] = React.useState('');
  const [replying, setReplying] = React.useState(false);

  const headers = React.useMemo(() => ({ 'Content-Type': 'application/json' }), []);

  const showToast = React.useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  const loadTickets = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_SUPPORT}/me/tickets`, { headers, credentials: 'include' });
      if (response.ok) setTickets(await response.json());
    } finally {
      setLoading(false);
    }
  }, [headers]);

  React.useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // The server has always served the thread and accepted a reply on it, both
  // ownership-checked. Nothing here ever called either, so a customer was shown
  // "3 ردود من الإدارة" on a card that did not open, and support was answering
  // into a page the customer could not read.
  const openThread = React.useCallback(async (id: string) => {
    setOpenId(id);
    setReply('');
    setThreadLoading(true);
    setThread(null);
    try {
      const response = await fetch(`${API_SUPPORT}/me/tickets/${encodeURIComponent(id)}`, {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`Ticket fetch failed (${response.status})`);
      setThread(await response.json());
    } catch {
      showToast('تعذّر فتح المحادثة، يرجى المحاولة مرة أخرى');
    } finally {
      setThreadLoading(false);
    }
  }, [headers, showToast]);

  const sendReply = async () => {
    const body = reply.trim();
    if (!body || !thread) return;
    setReplying(true);
    try {
      const response = await fetch(`${API_SUPPORT}/me/tickets/${encodeURIComponent(thread.id)}/reply`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ body }),
      });
      if (!response.ok) throw new Error(`Reply failed (${response.status})`);
      const data = await response.json();
      setThread((current) => (current
        ? { ...current, status: 'open', replies: [...current.replies, data.reply] }
        : current));
      setReply('');
      await loadTickets();
    } catch {
      showToast('تعذّر إرسال الرد، يرجى المحاولة مرة أخرى');
    } finally {
      setReplying(false);
    }
  };

  const submit = async () => {
    if (!form.subject.trim() || !form.body.trim()) {
      showToast('يرجى ملء العنوان والرسالة');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_SUPPORT}/me/tickets`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(`Support request failed (${response.status})`);
      showToast('تم إرسال تذكرتك بنجاح');
      setForm({ subject: '', body: '' });
      await loadTickets();
    } catch {
      showToast('حدث خطأ، يرجى المحاولة مرة أخرى');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      {toast && (
        <div className="fixed top-4 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-medium shadow-lg">
          {toast}
        </div>
      )}

      <div className="glass-card-premium space-y-4 rounded-2xl border border-white/50 bg-white/70 p-5 shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20">
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-900">
          <MessageSquare size={18} className="text-purple-600" />
          فتح تذكرة دعم جديدة
        </h3>
        <div>
          <label className="mb-1 block text-xs text-gray-500">موضوع المشكلة</label>
          <input
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-300"
            value={form.subject}
            onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
            placeholder="مثال: مشكلة في تشغيل الفيديو"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-500">تفاصيل المشكلة</label>
          <textarea
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-300"
            rows={4}
            value={form.body}
            onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
            placeholder="اشرح المشكلة بالتفصيل..."
          />
        </div>
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full rounded-xl bg-purple-600 py-2.5 text-sm font-bold text-white transition hover:bg-purple-700 disabled:opacity-50"
        >
          {submitting ? 'جاري الإرسال...' : 'إرسال التذكرة'}
        </button>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-bold text-gray-700">تذاكرك السابقة</h3>
        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">جاري التحميل...</div>
        ) : tickets.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center text-sm text-gray-400">
            لا توجد تذاكر سابقة
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((ticket) => {
              const open = openId === ticket.id;
              return (
                <div
                  key={ticket.id}
                  className="glass-card-premium rounded-xl border border-white/50 bg-white/70 p-4 shadow-xl shadow-gray-200/50 backdrop-blur-xl"
                >
                  <button
                    type="button"
                    onClick={() => { if (open) { setOpenId(''); setThread(null); } else { openThread(ticket.id); } }}
                    className="flex w-full items-start justify-between gap-3 text-right"
                    aria-expanded={open}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800">{ticket.subject}</p>
                      <p className="mt-0.5 text-xs text-gray-400">
                        {new Date(ticket.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
                      </p>
                      <p className="mt-0.5 text-xs text-purple-600">
                        {(ticket.reply_count || 0) > 0
                          ? `${ticket.reply_count} رد من الإدارة — ${open ? 'إخفاء' : 'اضغط للقراءة والرد'}`
                          : (open ? 'إخفاء المحادثة' : 'اضغط لعرض المحادثة والرد')}
                      </p>
                    </div>
                    <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[ticket.status] || 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABELS[ticket.status] || ticket.status}
                    </span>
                  </button>

                  {open && thread?.id === ticket.id && (
                    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                      <div className="rounded-xl bg-gray-50 p-3">
                        <p className="mb-1 text-xs font-medium text-gray-500">رسالتك</p>
                        <p className="whitespace-pre-wrap text-sm text-gray-700">{thread.body}</p>
                      </div>

                      {thread.replies.map((item, index) => (
                        <div
                          key={`${thread.id}-${index}`}
                          className={`rounded-xl p-3 ${isFromCustomer(item.author_type) ? 'bg-gray-50' : 'bg-purple-50'}`}
                        >
                          <p className="mb-1 text-xs font-medium text-gray-500">
                            {isFromCustomer(item.author_type) ? 'أنت' : (item.author_name || 'الإدارة')}
                          </p>
                          <p className="whitespace-pre-wrap text-sm text-gray-700">{item.body}</p>
                        </div>
                      ))}

                      <textarea
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-purple-300"
                        rows={3}
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder="اكتب ردك هنا..."
                      />
                      <button
                        type="button"
                        onClick={sendReply}
                        disabled={replying || !reply.trim()}
                        className="w-full rounded-xl bg-purple-600 py-2.5 text-sm font-bold text-white transition hover:bg-purple-700 disabled:opacity-50"
                      >
                        {replying ? 'جاري الإرسال...' : 'إرسال الرد'}
                      </button>
                    </div>
                  )}

                  {open && !thread && threadLoading && (
                    <p className="mt-3 text-center text-xs text-gray-400">جاري تحميل المحادثة...</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
