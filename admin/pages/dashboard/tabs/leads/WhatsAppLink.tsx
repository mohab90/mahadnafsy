import React, { useState } from 'react';
import { toDialable } from '../../../../lib/whatsappLink';
import { mysqlAdmin } from '../../../../lib/mysqlapi';

/**
 * The WhatsApp button, which now records that the rep opened the chat.
 *
 * Every one of these was a plain <a href="https://wa.me/…">. It opened the
 * conversation and told the system nothing, which is why 332 leads had been
 * converted while only 19 carried any communication at all: the reps were
 * working, and the CRM could not see it. Everything built on contact — the lead
 * score, the neglected-lead reports, the follow-up reminders, the rep's own
 * numbers — was reading from an empty table.
 *
 * What it records is deliberately narrow: the chat was opened. It does not
 * claim a message was sent, because that is not something this side can know.
 * Sending from inside the app, through the inbox reply, still records the
 * message itself.
 *
 * The logging never blocks the link. It is fired and left, and a failure is
 * swallowed on purpose — a rep clicking through to a customer must not be
 * stopped by a bookkeeping call, and there is nothing useful they could do
 * about it mid-click.
 */
export default function WhatsAppLink({
  leadId,
  phone,
  title = 'واتساب',
  className,
  children,
  onLogged,
}: {
  leadId: string;
  phone: string;
  title?: string;
  className?: string;
  children: React.ReactNode;
  /** Lets the caller refresh once the entry has landed. */
  onLogged?: () => void;
}) {
  const [logging, setLogging] = useState(false);
  const dialable = toDialable(phone);

  // An undialable number has no chat to open. Rendering the control anyway
  // would send the rep to a broken wa.me page.
  if (!dialable) {
    return (
      <span title="رقم غير صالح للاتصال" className={className} aria-disabled="true" style={{ opacity: 0.4 }}>
        {children}
      </span>
    );
  }

  const record = () => {
    if (logging) return;
    setLogging(true);
    mysqlAdmin
      .addLeadInteraction(leadId, {
        type: 'whatsapp',
        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
        notes: 'فتح محادثة واتساب من كارت العميل',
      })
      .then(() => onLogged?.())
      .catch(() => { /* the rep is already in WhatsApp; nothing to tell them here */ })
      .finally(() => setLogging(false));
  };

  return (
    <a
      href={`https://wa.me/${dialable}`}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={className}
      onClick={(e) => { e.stopPropagation(); record(); }}
    >
      {children}
    </a>
  );
}
