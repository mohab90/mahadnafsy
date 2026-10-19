'use strict';

// A problem's whole history as one readable text, to travel with it.
//
// «لازم يكون في زر تحويل لاسترداد لو العميل مشكلته متحلتش … بيروح معاه كل التفاصيل اللي حصلت قبل كدا في المشكلة»:
// when a problem that was not solved becomes a refund request, the refunds desk must see what the customer
// wrote, what the team answered and every step taken, without opening the ticket. It is written once, at the
// moment of the hand-over, so it stays as it stood then whatever happens to the ticket afterwards.

const STATUS_LABEL = { open: 'مفتوحة', in_progress: 'تحت المتابعة', resolved: 'اتحلت', closed: 'مقفولة' };
const EVENT_LABEL = {
  created: 'اتفتحت', routed: 'اتوجهت', assigned: 'اتسلمت', replied: 'رد', status_changed: 'الحالة اتغيرت',
  escalated: 'اتصعّدت', contact: 'تواصل مع العميل', note: 'ملاحظة', priority_changed: 'الأولوية اتغيرت',
};

const text = value => String(value ?? '').replace(/\r\n/g, '\n').trim();
const day = value => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  // Cairo's clock, as the screens show it.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce((out, part) => ({ ...out, [part.type]: part.value }), {});
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
};

/**
 * @param {{ ticket: object, replies?: object[], timeline?: object[] }} input
 * @returns {string} the history, oldest first, in Arabic.
 */
function buildTicketHistory({ ticket, replies = [], timeline = [] }) {
  const lines = [];
  lines.push(`المشكلة ${ticket.ticket_code ? `#${ticket.ticket_code} ` : ''}— ${text(ticket.subject) || 'بدون عنوان'}`);
  const meta = [
    ticket.created_at ? `اتفتحت ${day(ticket.created_at)}` : '',
    ticket.channel ? `القناة: ${ticket.channel}` : '',
    ticket.category ? `النوع: ${ticket.category}` : '',
    STATUS_LABEL[ticket.status] ? `الحالة وقت التحويل: ${STATUS_LABEL[ticket.status]}` : '',
    ticket.assigned_to_name ? `المسئول: ${ticket.assigned_to_name}` : '',
  ].filter(Boolean);
  if (meta.length) lines.push(meta.join(' · '));
  const body = text(ticket.body || ticket.description);
  if (body) lines.push('', 'اللي كتبه العميل:', body);
  if (text(ticket.root_cause)) lines.push('', `السبب الحقيقي: ${text(ticket.root_cause)}`);

  if (replies.length) {
    lines.push('', 'المحادثة:');
    for (const reply of replies) {
      const who = reply.author_type === 'staff' || reply.isStaff ? `الفريق${reply.author_name ? ` (${reply.author_name})` : ''}` : (reply.author_name || 'العميل');
      lines.push(`- ${day(reply.created_at)} · ${who}: ${text(reply.body)}`);
    }
  }
  if (timeline.length) {
    lines.push('', 'سجل الخطوات:');
    for (const event of timeline) {
      const parts = [
        day(event.created_at),
        EVENT_LABEL[event.event_type] || event.event_type,
        event.to_value ? `→ ${event.to_value}` : '',
        event.actor_name ? `(${event.actor_name})` : '',
        text(event.detail) ? `— ${text(event.detail)}` : '',
      ].filter(Boolean);
      lines.push(`- ${parts.join(' ')}`);
    }
  }
  return lines.join('\n').slice(0, 60000);
}

module.exports = { buildTicketHistory };
