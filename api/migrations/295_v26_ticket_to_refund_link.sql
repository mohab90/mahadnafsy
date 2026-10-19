-- A problem that could not be solved is handed to the refunds desk with everything that happened on it (19 Oct 2026).
--
-- «لازم يكون في زر تحويل لاسترداد لو العميل مشكلته متحلتش … بيتشال خالص بيروح قسم الاسترداد ولكن بيروح معاه كل
-- التفاصيل اللي حصلت قبل كدا في المشكلة»: the refund request keeps the ticket it came from and the ticket's whole history
-- as it stood when it was handed over (subject, what the client wrote, every reply, every event), and the ticket keeps
-- the refund it became, so each can be opened from the other. Nothing is deleted: the ticket is closed and sits in the
-- customer-service archive.
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS ticket_id VARCHAR(36) NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS ticket_code VARCHAR(20) NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS ticket_history MEDIUMTEXT NULL;
ALTER TABLE refund_requests ADD INDEX IF NOT EXISTS idx_refund_tenant_ticket (tenant_id, ticket_id);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS refund_request_id VARCHAR(36) NULL;
