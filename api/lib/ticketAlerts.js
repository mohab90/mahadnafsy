'use strict';

// «لازم يوصل اشعار مهم بان عميل بعت رساله دلوقتي بمشكله» (16 Oct 2026).
//
// A client writing to customer service is the one moment the team must not miss, and it used to be
// the same grey «ticket» line as an assignment — one that reached only the ticket's owner, and
// nobody at all when the ticket had none. It is now its own kind, read as important in the bell
// (red, in «مهم»), delivered to the owner and, when there is no owner, to every customer-service
// employee — and, in production, pushed to their phones like every notification.
const { createNotification } = require('./notification');

const TYPE = 'ticket_client_message';

/**
 * A client has just written: a new problem (isNew) or a message on an open one.
 * Several messages from the same person within two minutes fold into one line with a count,
 * so a client who sends five lines does not ring five times.
 */
function notifyClientMessage({ tenantId, ticketId, subject, who, text, isNew, assigneeId }) {
  const name = String(who || 'عميل').trim().slice(0, 60) || 'عميل';
  const title = isNew ? `🚨 ${name} بعت مشكلة جديدة دلوقتي` : `🚨 ${name} بعت رسالة دلوقتي`;
  const preview = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  const line = `${subject ? `${subject}: ` : ''}${preview}`;
  return createNotification(
    TYPE, title, line, { ticketId, kind: 'client_message', isNew: Boolean(isNew) }, tenantId, assigneeId || null,
    {
      coalesceMinutes: 2,
      summarize: count => `${count} رسائل جديدة من ${name} — آخرها: ${line}`.slice(0, 400),
    },
  );
}

module.exports = { notifyClientMessage, CLIENT_MESSAGE_TYPE: TYPE };
