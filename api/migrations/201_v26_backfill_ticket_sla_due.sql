-- Tickets that predate the SLA feature carry no sla_due_at, and the breach
-- sweep requires `sla_due_at IS NOT NULL AND sla_due_at < NOW()`. A NULL is
-- not less than anything, so those tickets are invisible to it permanently:
-- production has one open since 2026-06-21 that no sweep will ever mention.
--
-- Backfill from created_at using the same first-response windows the router
-- applies to new tickets (api/lib/ticketRouting.js, SLA_HOURS): urgent 2h,
-- high 4h, medium 24h, low 72h. Deadlines land in the past for old tickets,
-- which is correct — they *are* overdue, and the sweep announces each ticket
-- once and then marks sla_breach_notified_at, so this cannot become a flood.
--
-- Only untouched rows: a ticket already answered or closed needs no deadline.
UPDATE support_tickets
   SET sla_due_at = created_at + INTERVAL CASE LOWER(COALESCE(priority, 'medium'))
                                            WHEN 'urgent' THEN 2
                                            WHEN 'high'   THEN 4
                                            WHEN 'low'    THEN 72
                                            ELSE 24
                                          END HOUR
 WHERE sla_due_at IS NULL
   AND deleted_at IS NULL
   AND first_response_at IS NULL
   AND status IN ('open', 'in_progress');
