import React from 'react';
import { MessageSquare } from 'lucide-react';

const API_SUPPORT = import.meta.env.VITE_API_URL || 'https://mahadnafsy.com/api';

type SupportTicket = {
  id: string;
  subject: string;
  status: string;
  created_at: string;
  reply_count?: number;
};

type StudentSupportTabProps = {
  token: string;
};

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

export function StudentSupportTab({ token }: StudentSupportTabProps) {
  const [tickets, setTickets] = React.useState<SupportTicket[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState({ subject: '', body: '' });
  const [submitting, setSubmitting] = React.useState(false);
  const [toast, setToast] = React.useState('');

  const headers = React.useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const showToast = React.useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  const loadTickets = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_SUPPORT}/me/tickets`, { headers });
      if (response.ok) setTickets(await response.json());
    } finally {
      setLoading(false);
    }
  }, [headers]);

  React.useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  const submit = async () => {
    if (!form.subject.trim() || !form.body.trim()) {
      showToast('يرجى ملء العنوان والرسالة');
      return;
    }

    setSubmitting(true);
    const response = await fetch(`${API_SUPPORT}/me/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify(form),
    });
    setSubmitting(false);

    if (response.ok) {
      showToast('تم إرسال تذكرتك بنجاح');
      setForm({ subject: '', body: '' });
      loadTickets();
    } else {
      showToast('حدث خطأ، يرجى المحاولة مرة أخرى');
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
            {tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="glass-card-premium rounded-xl border border-white/50 bg-white/70 p-4 shadow-xl shadow-gray-200/50 backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-primary-500/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{ticket.subject}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {new Date(ticket.created_at).toLocaleDateString('ar-EG-u-nu-latn')}
                    </p>
                    {(ticket.reply_count || 0) > 0 && (
                      <p className="mt-0.5 text-xs text-purple-600">
                        {ticket.reply_count} رد من الإدارة
                      </p>
                    )}
                  </div>
                  <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[ticket.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABELS[ticket.status] || ticket.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
