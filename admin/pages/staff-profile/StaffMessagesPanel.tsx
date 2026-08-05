import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, RefreshCw } from 'lucide-react';
import { mysqlAdmin } from '../../lib/mysqlapi';
import type { StaffMessage } from './types';

/**
 * Management side of the two-way thread with an employee. The employee reads and
 * replies to the same thread from their own "بياناتي في HR" page, so this is a
 * real conversation rather than a one-way note field. Sending also raises the
 * employee's normal notification bell (see api/routes/hr/staffprofile.js), so a
 * message doesn't sit unseen until they happen to open their HR page.
 */
export default function StaffMessagesPanel({
  staffId, staffName, notify,
}: {
  staffId: string;
  staffName: string;
  notify: (type: 'success' | 'error' | 'info', text: string) => void;
}) {
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (scroll = false) => {
    setLoading(true);
    try {
      const rows = await mysqlAdmin.listStaffMessages(staffId);
      setMessages(rows as unknown as StaffMessage[]);
      if (scroll) setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر تحميل الرسائل');
    } finally {
      setLoading(false);
    }
  }, [staffId, notify]);

  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      await mysqlAdmin.sendStaffMessage(staffId, text);
      setBody('');
      await load(true);
      notify('success', 'تم إرسال الرسالة ووصلها إشعار');
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'تعذر إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <h3 className="flex items-center gap-2 text-base font-bold text-gray-800">
          <MessageSquare size={17} className="text-indigo-600" /> المراسلات مع {staffName}
        </h3>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-200 disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      <div className="max-h-[420px] space-y-3 overflow-y-auto bg-gray-50/60 p-5">
        {loading && messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-400">جاري تحميل المحادثة...</p>
        ) : messages.length === 0 ? (
          <div className="py-10 text-center">
            <MessageSquare size={30} className="mx-auto mb-2 text-gray-300" />
            <p className="text-sm text-gray-400">لا توجد رسائل بعد. ابدأ المحادثة من الأسفل.</p>
          </div>
        ) : (
          messages.map(message => {
            const fromManagement = message.direction === 'to_staff';
            return (
              <div key={message.id} className={`flex ${fromManagement ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    fromManagement ? 'bg-indigo-600 text-white' : 'border border-gray-200 bg-white text-gray-800'
                  }`}
                >
                  <p className={`mb-1 text-[10px] font-bold ${fromManagement ? 'text-indigo-200' : 'text-gray-400'}`}>
                    {fromManagement ? `الإدارة · ${message.author_name}` : message.author_name || staffName}
                    {' · '}
                    {new Date(message.created_at).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' })}
                    {fromManagement && (message.read_at ? ' · تم الاطلاع' : ' · لم يُقرأ')}
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed">{message.body}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-gray-100 p-4">
        <textarea
          value={body}
          onChange={event => setBody(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); }
          }}
          rows={2}
          placeholder={`اكتب رسالة لـ${staffName}... (Ctrl+Enter للإرسال)`}
          className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <button
          onClick={() => void send()}
          disabled={sending || !body.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <Send size={15} /> {sending ? 'جارٍ...' : 'إرسال'}
        </button>
      </div>
    </div>
  );
}
