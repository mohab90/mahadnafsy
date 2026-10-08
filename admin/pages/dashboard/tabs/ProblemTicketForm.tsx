import { useState } from 'react';
import { mysqlAdmin } from '../../../lib/mysqlapi';

// «لازم يكون في زر فتح تيكت مشكله للعميل بدون ما ننقل العميل من مكانه او نعمل
// اي اكشن عليه … يروح لخدمه العملاء نشوف مشكلته ونسمعها» (8 Oct 2026). The
// client stays where they are; the problem goes to customer service's queue,
// and the problem and its resolution are written on the client's file.
export function ProblemTicketForm({ subscriberId, onBack, onDone }: {
  subscriberId: string;
  onBack: () => void;
  onDone: (type: 'success' | 'error', text: string) => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      await mysqlAdmin.adminPost('/admin/cs/tickets', {
        subscriber_id: subscriberId,
        subject: subject.trim() || 'مشكلة عميل محتاجة خدمة العملاء',
        body: body.trim(),
        category: 'client_problem',
        channel: 'internal',
      });
      onDone('success', 'اتفتح تيكت لخدمة العملاء، واتسجل في ملف العميل');
    } catch (error) {
      onDone('error', error instanceof Error ? error.message : 'تعذر فتح التيكت');
    } finally { setSending(false); }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2">
        العميل مش هيتنقل ومفيش أي إجراء هيتعمل عليه — المشكلة بتروح لخدمة العملاء يسمعوها ويحلوها، والحل بيتسجل في ملفه.
      </p>
      <label className="block text-sm font-bold text-gray-700">عنوان المشكلة:</label>
      <input value={subject} onChange={event => setSubject(event.target.value)} maxLength={200}
        placeholder="مثلاً: مش راضي عن المحاضر"
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
      <label className="block text-sm font-bold text-gray-700">المشكلة بالتفصيل: <span className="text-red-500">*</span></label>
      <textarea value={body} onChange={event => setBody(event.target.value)} rows={4}
        placeholder="العميل اشتكى من إيه، وإيه اللي اتعمل لحد دلوقتي"
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 resize-none" />
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onBack} className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm hover:bg-gray-50">رجوع</button>
        <button disabled={sending || !body.trim()} onClick={() => void send()}
          className="flex-1 bg-sky-600 text-white rounded-xl px-3 py-2 text-sm font-bold hover:bg-sky-700 disabled:opacity-50 transition">
          {sending ? '⏳...' : '🎫 ابعت لخدمة العملاء'}
        </button>
      </div>
    </div>
  );
}
